"""
鸿蒙化代码深度分析 Agent —— 基于 OpenAI Agents SDK + DashScope。

Agent 通过工具下载 GitHub 仓库源码，自主浏览代码结构、分析依赖和原生代码，
产出基于代码事实的鸿蒙化适配评估报告。
"""

import asyncio
import json
import os
import re
import shutil
import tarfile
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

from agents import (
    Agent,
    AsyncOpenAI,
    ModelSettings,
    OpenAIChatCompletionsModel,
    Runner,
    function_tool,
    set_tracing_disabled,
)
from agents.exceptions import AgentsException

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────

load_dotenv()

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
DASHSCOPE_BASE_URL = os.environ.get(
    "DASHSCOPE_BASE_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
CODE_ANALYSIS_MODEL = (
    os.environ.get("CODE_ANALYSIS_MODEL")
    or os.environ.get("DASHSCOPE_MODEL_DEEP")
    or "qwen3-max"
)

# 源码下载与分析的限制
MAX_FILE_SIZE = 200 * 1024        # 单文件最大读取 200KB
MAX_LIST_FILES = 500               # list_files 最多返回文件数
MAX_SEARCH_RESULTS = 60            # search_code 最多匹配数
MAX_LINE_LENGTH = 300              # 搜索时每行输出的最大字符

# Agent 运行限制
MAX_TURNS = 30                     # Agent 最大轮次


# ──────────────────────────────────────────────
# Source Download (GitHub Tarball API)
# ──────────────────────────────────────────────

def _github_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def download_source(
    owner: str,
    name: str,
    dest: Path,
    ref: str = "HEAD",
) -> Path:
    """
    通过 GitHub 下载仓库源码到本地目录。
    优先使用 codeload URL（公开仓库无需认证），
    失败时回退到 API + Token 方式。
    """
    # 方式 1: codeload URL（公开仓库免认证，速度更快）
    codeload_url = f"https://codeload.github.com/{owner}/{name}/tar.gz/{ref}"
    # 方式 2: API URL（需要 Token，适用于私有仓库或 API 限流场景）
    api_url = f"https://api.github.com/repos/{owner}/{name}/tarball/{ref}"

    tar_bytes = None

    # 先尝试 codeload（公开仓库）
    try:
        resp = requests.get(codeload_url, timeout=120, stream=True)
        if resp.status_code == 200:
            tar_bytes = resp.content
    except requests.RequestException:
        pass

    # 回退到 API + Token
    if tar_bytes is None:
        headers = _github_headers()
        resp = requests.get(api_url, headers=headers, stream=True, timeout=120)
        resp.raise_for_status()
        tar_bytes = resp.content

    with tarfile.open(fileobj=BytesIO(tar_bytes), mode="r:gz") as tar:
        tar.extractall(path=dest, filter="data")

    # GitHub tarball 解压后有一个顶层目录: owner-name-sha/
    for item in dest.iterdir():
        if item.is_dir():
            return item

    raise RuntimeError(f"下载后未找到源码目录: {owner}/{name}")


# ──────────────────────────────────────────────
# Agent Tools
# ──────────────────────────────────────────────

@function_tool
def list_files(
    source_root: str,
    path: str = ".",
    recursive: bool = True,
    max_depth: int = 4,
    pattern: str = "",
    limit: int = 200,
) -> str:
    """
    列出仓库中的文件和目录。
    自动跳过 node_modules、.git、vendor、__pycache__、dist、build 等目录。

    Args:
        source_root: 源码根目录（由 download_repository 返回的路径）
        path: 相对于 source_root 的子路径
        recursive: 是否递归列出子目录
        max_depth: 最大递归深度
        pattern: 文件名 glob 过滤（如 "*.ts"、"*.gradle"）
        limit: 最多返回多少条结果
    """
    root = Path(source_root) / path
    if not root.exists():
        return f"错误: 路径不存在 {path}"
    if not root.is_dir():
        return f"错误: 不是目录 {path}"

    skip = {
        "node_modules", ".git", ".svn", ".hg", "vendor",
        "__pycache__", ".next", "dist", "build", ".gradle",
        ".idea", ".vscode", "Pods", ".dart_tool", ".pub-cache",
        "target", "out", ".cache", ".tox", "venv", ".venv",
    }
    results: list[str] = []

    def walk(current: Path, depth: int):
        if len(results) >= limit:
            return
        if depth > max_depth:
            return
        try:
            items = sorted(current.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        except PermissionError:
            return
        for item in items:
            if len(results) >= limit:
                return
            if item.is_dir() and item.name in skip:
                continue
            if item.name.startswith(".git"):
                continue
            rel = str(item.relative_to(root))
            # pattern 过滤
            if pattern and not item.is_dir():
                if not re.search(pattern.replace("*", ".*"), item.name, re.IGNORECASE):
                    continue
            prefix = "📁 " if item.is_dir() else "  "
            results.append(f"{prefix}{rel}")
            if item.is_dir() and recursive:
                walk(item, depth + 1)

    walk(root, 0)

    truncated = len(results) >= limit
    output = "\n".join(results[:limit])
    if truncated:
        output += f"\n... (已截断，共更多文件，请用 pattern 过滤或指定子目录)"
    return output or "(空目录)"


@function_tool
def read_file(
    source_root: str,
    path: str,
    max_lines: int = 500,
) -> str:
    """
    读取指定文件的内容。大文件会被截断。

    Args:
        source_root: 源码根目录
        path: 相对于 source_root 的文件路径
        max_lines: 最多读取多少行
    """
    filepath = Path(source_root) / path
    if not filepath.exists():
        return f"错误: 文件不存在 {path}"
    if not filepath.is_file():
        return f"错误: 不是文件 {path}"

    size = filepath.stat().st_size
    if size > MAX_FILE_SIZE:
        return (
            f"文件过大({size // 1024}KB > {MAX_FILE_SIZE // 1024}KB)，"
            f"请使用 search_code 搜索特定内容，或读取更小的文件。"
        )

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except UnicodeDecodeError:
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            # 如果大量替换字符，可能是二进制文件
            text = "".join(lines[:50])
            if text.count("") > len(text) * 0.1:
                return f"二进制文件，无法以文本方式读取: {path}"
        except Exception as e:
            return f"读取失败: {e}"

    truncated = len(lines) > max_lines
    output = "".join(lines[:max_lines])
    if truncated:
        output += f"\n... [截断，共 {len(lines)} 行，仅显示前 {max_lines} 行]"
    return output


@function_tool
def search_code(
    source_root: str,
    pattern: str,
    file_pattern: str = "",
    context_lines: int = 0,
    max_results: int = 30,
) -> str:
    """
    在仓库源码中搜索文本或正则表达式。

    Args:
        source_root: 源码根目录
        pattern: 搜索模式（支持正则表达式）
        file_pattern: 文件名 glob 过滤（如 "*.ts"、"*.java"）
        context_lines: 匹配行前后显示多少行上下文
        max_results: 最多返回多少条匹配结果
    """
    root = Path(source_root)
    if not root.exists():
        return f"错误: 源码目录不存在"

    skip = {
        "node_modules", ".git", "vendor", "__pycache__",
        "dist", "build", ".gradle", ".next", "target", "out",
    }
    results: list[str] = []
    total_matches = 0

    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error as e:
        return f"无效的正则表达式: {e}"

    for filepath in root.rglob("*"):
        if len(results) >= max_results:
            break
        if not filepath.is_file():
            continue
        if any(p in filepath.parts for p in skip):
            continue
        if filepath.stat().st_size > MAX_FILE_SIZE:
            continue
        if file_pattern and not re.search(
            file_pattern.replace("*", ".*"), filepath.name, re.IGNORECASE
        ):
            continue

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except Exception:
            continue

        for i, line in enumerate(lines):
            if len(results) >= max_results:
                break
            if regex.search(line):
                total_matches += 1
                rel = str(filepath.relative_to(root))
                start = max(0, i - context_lines)
                end = min(len(lines), i + context_lines + 1)
                snippet = "".join(lines[start:end]).rstrip()
                if len(snippet) > MAX_LINE_LENGTH * (1 + 2 * context_lines):
                    snippet = snippet[:MAX_LINE_LENGTH * (1 + 2 * context_lines)] + "..."
                results.append(f"{rel}:{i + 1}\n{snippet}")

    if not results:
        return f"未找到匹配 '{pattern}' 的内容"

    output = "\n---\n".join(results)
    if total_matches > max_results:
        output += f"\n\n共 {total_matches} 处匹配，仅显示前 {max_results} 条。"
    return output


@function_tool
def count_code_lines(source_root: str) -> str:
    """
    统计仓库中各语言/文件类型的代码行数，帮助快速了解项目构成。
    """
    root = Path(source_root)
    if not root.exists():
        return "错误: 源码目录不存在"

    skip = {
        "node_modules", ".git", "vendor", "__pycache__",
        "dist", "build", ".gradle", ".next", "target", "out",
    }

    lang_map: dict[str, int] = {}  # extension -> line count
    file_count: dict[str, int] = {}  # extension -> file count

    for filepath in root.rglob("*"):
        if not filepath.is_file():
            continue
        if any(p in filepath.parts for p in skip):
            continue
        if filepath.stat().st_size > 500 * 1024:  # skip files > 500KB
            continue

        ext = filepath.suffix.lower() or filepath.name
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                count = sum(1 for _ in f)
        except Exception:
            continue

        lang_map[ext] = lang_map.get(ext, 0) + count
        file_count[ext] = file_count.get(ext, 0) + 1

    if not lang_map:
        return "未找到可读的源码文件。"

    # 按行数降序排序，只显示 top 20
    sorted_langs = sorted(lang_map.items(), key=lambda x: -x[1])[:20]
    lines = ["语言/扩展     | 文件数 | 行数"]
    lines.append("─" * 42)
    for ext, total_lines in sorted_langs:
        files = file_count.get(ext, 0)
        lines.append(f"{ext:<16}| {files:>5}  | {total_lines:>8,}")

    total_files = sum(file_count.values())
    total_lines = sum(lang_map.values())
    lines.append("─" * 42)
    lines.append(f"{'合计':<14}| {total_files:>5}  | {total_lines:>8,}")
    return "\n".join(lines)


# ──────────────────────────────────────────────
# Agent Instructions
# ──────────────────────────────────────────────

AGENT_INSTRUCTIONS = """\
你是一个专业的鸿蒙 (HarmonyOS NEXT / OpenHarmony) 生态适配分析专家。
你通过实际阅读和分析 GitHub 仓库的源代码，评估该项目移植到鸿蒙生态的价值、可行性和具体路径。

## 核心原则

1. **基于代码事实**：所有结论必须来自你实际读到的代码，不要臆测
2. **系统性分析**：按照下面的步骤逐步分析，不要跳过任何步骤
3. **深度优先**：对于关键文件（构建配置、入口文件、核心模块），要完整阅读
4. **量化表达**：尽量用数据说话（如"C++ 代码占比约 40%"、"有 12 个 iOS 专属 API 调用"）

## 分析步骤

### 第一步：了解项目全貌
1. 用 `count_code_lines` 统计各语言代码量，了解项目技术栈
2. 用 `list_files(source_root)` 查看整体目录结构
3. 识别项目类型（库 / 框架 / 应用 / 工具）

### 第二步：分析构建与依赖
1. 读取构建配置文件：
   - JS/TS: `package.json`、`tsconfig.json`、`rollup.config.*`、`webpack.config.*`、`vite.config.*`
   - Java/Kotlin: `build.gradle`、`pom.xml`
   - Python: `setup.py`、`pyproject.toml`、`requirements.txt`
   - Rust: `Cargo.toml`
   - C/C++: `CMakeLists.txt`、`Makefile`
   - Swift/ObjC: `Package.swift`、`*.xcodeproj`、`Podfile`
   - Dart/Flutter: `pubspec.yaml`
2. 识别所有依赖，特别关注：
   - 操作系统相关依赖（如 `react-native-*`、`@capacitor/*`、`windows-*`）
   - 硬件/设备相关依赖
   - 图形/渲染引擎依赖

### 第三步：检查原生代码
1. 搜索 `.c`、`.cpp`、`.h`、`.hpp`、`.m`（ObjC）、`.swift`、`.java`、`.kt` 文件
2. 评估原生代码的比例和复杂度
3. 检查是否使用了 NAPI / JNI / FFI 等跨语言桥接
4. 检查原生代码是否依赖特定操作系统 API（如 Win32、POSIX-only、iOS UIKit）

### 第四步：识别平台特定代码
1. 搜索平台关键词：`iOS`、`Android`、`Windows`、`macOS`、`Linux`、`UIKit`、`AppKit`、`Cocoa`、`Win32`
2. 检查条件编译指令（`#ifdef __APPLE__`、`#if defined(_WIN32)` 等）
3. 识别平台相关的 UI 渲染代码
4. 识别平台相关的系统 API 调用（文件系统、网络、权限、传感器等）

### 第五步：分析框架依赖
1. UI 框架：React/Vue/Svelte（Web 框架可 WebView 适配）、Flutter（需要鸿蒙引擎）、Qt（需移植）
2. 移动框架：React Native（有鸿蒙方案 RN-ArkUI）、Cordova（需要插件适配）
3. 游戏引擎：Unity/Unreal/Cocos（引擎级移植，工作量极大）
4. 网络层：axios/fetch（纯 JS 易适配）、gRPC（需鸿蒙 SDK）、WebSocket（标准 API）
5. 数据存储：SQLite（有鸿蒙版本）、Realm/MMKV（需原生适配）、IndexedDB（Web API）

### 第六步：综合评估
基于以上分析，给出详细的鸿蒙化评估报告。

## 输出格式

最终输出必须是严格的 JSON（不要包含 markdown 代码块标记），包含以下字段：

```json
{
  "category": "项目分类（如 UI组件/网络/存储/工具/框架/应用 等）",
  "subcategory": "更细的子分类",
  "project_type": "library | framework | application | tool | game-engine | other",
  "tech_stack": {
    "primary_language": "主要编程语言",
    "languages": ["所有使用的语言"],
    "frameworks": ["使用的框架"],
    "total_lines": 0,
    "native_code_ratio": 0.0,
    "description": "技术栈描述"
  },
  "dependencies_analysis": {
    "total_deps": 0,
    "os_specific_deps": ["依赖特定操作系统的包"],
    "hardware_deps": ["依赖特定硬件的包"],
    "easy_to_adapt": ["容易适配的依赖"],
    "hard_to_adapt": ["难以适配的依赖"]
  },
  "harmony_suggestion": "ADAPTED | PARTIAL | NOT_ADAPTED | NOT_APPLICABLE",
  "mobile_relevance": 0.0,
  "feasibility": 0.0,
  "effort_estimate": 0.0,
  "ecosystem_gap": 0.0,
  "adaptation_points": [
    {
      "area": "适配点领域（如 UI/网络/存储/原生能力/构建系统）",
      "description": "具体需要做什么",
      "difficulty": "low | medium | high",
      "evidence": "代码中的证据（文件路径或代码片段）"
    }
  ],
  "recommended_approach": "推荐的迁移路径（如 ArkTS 重写 / NAPI 封装 / RN-ArkUI 桥接 / WebView 包装 / 不建议）",
  "reasoning": "详细的中文分析理由，引用具体代码证据",
  "key_files_analyzed": ["你分析过的关键文件路径列表"],
  "confidence": 0.0
}
```

## 字段说明

- `harmony_suggestion`:
  - `ADAPTED`: 代码中已有鸿蒙相关文件或依赖
  - `PARTIAL`: 有部分鸿蒙化工作但未完成
  - `NOT_ADAPTED`: 尚未有鸿蒙化工作
  - `NOT_APPLICABLE`: 不适用于鸿蒙（纯服务端/内核/桌面 GUI 等）

- `mobile_relevance` (0-1): 对移动/跨端场景的价值
- `feasibility` (0-1): 技术上适配到鸿蒙是否可行且有意义
- `effort_estimate` (0-1): 0=容易 1=非常困难
- `ecosystem_gap` (0-1): 该品类在鸿蒙生态中的空白程度
- `confidence` (0-1): 你对分析结论的信心程度

## 重要提醒

- 你必须通过工具调用来实际阅读代码，不要仅凭项目名称猜测
- 每个 adaptation_point 的 evidence 字段必须引用真实的文件路径或代码
- 如果项目是纯服务端/内核/桌面专属，harmony_suggestion 应为 NOT_APPLICABLE
- adaptation_points 最多 8 个，按重要性排序
"""


# ──────────────────────────────────────────────
# Model Setup
# ──────────────────────────────────────────────

def create_model() -> OpenAIChatCompletionsModel:
    """创建 DashScope 兼容的 Chat Completions 模型。"""
    if not DASHSCOPE_API_KEY:
        raise RuntimeError(
            "缺少 DASHSCOPE_API_KEY 环境变量。"
            "请在 .env 文件或 CI Secrets 中配置。"
        )

    # 清除代理环境变量（DashScope 在国内，不需要代理；本地开发环境可能设了代理）
    for key in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        os.environ.pop(key, None)

    client = AsyncOpenAI(
        api_key=DASHSCOPE_API_KEY,
        base_url=DASHSCOPE_BASE_URL,
    )

    return OpenAIChatCompletionsModel(
        model=CODE_ANALYSIS_MODEL,
        openai_client=client,
    )


# ──────────────────────────────────────────────
# Agent Creation & Execution
# ──────────────────────────────────────────────

ALL_TOOLS = [list_files, read_file, search_code, count_code_lines]


def create_agent(source_root: str) -> Agent:
    """创建代码分析 Agent。"""
    # 禁用 OpenAI 的 tracing（DashScope 不需要）
    set_tracing_disabled(True)

    model = create_model()

    agent = Agent(
        name="HarmonyOS Code Analyst",
        instructions=AGENT_INSTRUCTIONS,
        model=model,
        tools=ALL_TOOLS,
        model_settings=ModelSettings(
            temperature=0.2,
            max_tokens=8000,
            # qwen3.x 为思考模型: enable_thinking=False 让模型直出 JSON，
            # 避免思考 token 干扰 tool calling 和结构化输出。
            extra_body={"enable_thinking": False},
        ),
    )
    return agent


async def analyze_repo(
    owner: str,
    name: str,
    ref: str = "HEAD",
    verbose: bool = False,
) -> dict:
    """
    下载并分析一个 GitHub 仓库的源码。

    Returns:
        包含分析结果的字典，字段参见 AGENT_INSTRUCTIONS 中的 JSON schema。
    """
    tmpdir = Path(tempfile.mkdtemp(prefix=f"harmony-{owner}-{name}-"))

    try:
        # 1. 下载源码
        if verbose:
            print(f"📦 正在下载 {owner}/{name} 源码...")
        source_root = download_source(owner, name, tmpdir, ref=ref)
        if verbose:
            print(f"✅ 源码已下载到 {source_root}")

        # 2. 创建 Agent
        agent = create_agent(str(source_root))

        # 3. 构建用户提示
        user_prompt = (
            f"请分析 GitHub 仓库 `{owner}/{name}` 的源码，评估其鸿蒙化适配的价值和可行性。\n\n"
            f"源码已下载到本地目录: `{source_root}`\n\n"
            f"请按照分析步骤，系统性地浏览代码结构、阅读关键文件、搜索平台相关代码，"
            f"最终产出完整的 JSON 评估报告。\n\n"
            f"注意: 在所有工具调用中，source_root 参数使用 `{source_root}`。"
        )

        # 4. 运行 Agent
        if verbose:
            print(f"🤖 开始 Agent 分析（模型: {CODE_ANALYSIS_MODEL}）...")

        result = await Runner.run(
            agent,
            user_prompt,
            max_turns=MAX_TURNS,
        )

        # 5. 解析结果
        final_output = result.final_output
        if verbose:
            print(f"✅ Agent 分析完成")

        # 尝试解析 JSON
        try:
            analysis = json.loads(final_output)
        except json.JSONDecodeError:
            # 尝试从 markdown 代码块中提取 JSON
            json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", final_output, re.DOTALL)
            if json_match:
                try:
                    analysis = json.loads(json_match.group(1))
                except json.JSONDecodeError:
                    analysis = {
                        "raw_output": final_output,
                        "parse_error": "无法从输出中解析 JSON",
                    }
            else:
                analysis = {
                    "raw_output": final_output,
                    "parse_error": "输出不包含有效的 JSON",
                }

        return {
            "owner": owner,
            "name": name,
            "source_root": str(source_root),
            "analysis": analysis,
        }

    finally:
        # 清理临时目录
        shutil.rmtree(tmpdir, ignore_errors=True)


async def analyze_repos_batch(
    repos: list[dict],
    verbose: bool = False,
) -> list[dict]:
    """
    批量分析多个仓库。

    Args:
        repos: [{"owner": "...", "name": "...", "ref": "HEAD"}, ...]
    """
    results = []
    for i, repo in enumerate(repos):
        owner = repo["owner"]
        name = repo["name"]
        ref = repo.get("ref", "HEAD")

        if verbose:
            print(f"\n{'='*60}")
            print(f"[{i+1}/{len(repos)}] 分析 {owner}/{name}")
            print(f"{'='*60}")

        try:
            result = await analyze_repo(owner, name, ref=ref, verbose=verbose)
            results.append(result)
        except Exception as e:
            results.append({
                "owner": owner,
                "name": name,
                "error": str(e),
            })
            if verbose:
                print(f"❌ 分析失败: {e}")

    return results
