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
    or "qwen3.8-max"
)

# 源码下载与分析的限制
MAX_FILE_SIZE = 200 * 1024        # 单文件最大读取 200KB
MAX_LIST_FILES = 500               # list_files 最多返回文件数
MAX_SEARCH_RESULTS = 60            # search_code 最多匹配数
MAX_LINE_LENGTH = 300              # 搜索时每行输出的最大字符

# Agent 运行限制
MAX_TURNS = 45                     # 深析允许充分浏览关键子系统，避免过早收敛


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
5. **历史可复用但必须复核**：同组织或相似项目的历史分析是调查线索，不是当前仓库证据。复用结论时必须在当前源码重新验证适用边界
6. **先分析后打分**：先完成架构、平台边界、生态替代与落地路线分析，最后再给数值摘要，不得用分数替代技术论证

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
3. 检查是否使用了 Node-API / JNI / FFI 等跨语言桥接
4. 检查原生代码是否依赖特定操作系统 API（如 Win32、POSIX-only、iOS UIKit）

### 第四步：识别平台特定代码
1. 搜索平台关键词：`iOS`、`Android`、`Windows`、`macOS`、`Linux`、`UIKit`、`AppKit`、`Cocoa`、`Win32`
2. 检查条件编译指令（`#ifdef __APPLE__`、`#if defined(_WIN32)` 等）
3. 识别平台相关的 UI 渲染代码
4. 识别平台相关的系统 API 调用（文件系统、网络、权限、传感器等）

### 第五步：验证平台集成模型
1. 从当前源码确认框架、运行时和插件机制，不按项目名或框架类别套用预设结论
2. 对每个平台后端/插件选择一个代表实现完整阅读，找出注册入口、生命周期、线程模型和错误边界
3. 区分“代码可直接运行”“构建目标可生成”和“具备完整鸿蒙平台能力”，三者不能混为一谈
4. 将需要替换的系统 API 映射到能力类别；无法从材料确认具体 HarmonyOS API 时写待验证，不猜名称
5. 检查测试矩阵、发布产物、版本兼容、上游贡献规范和维护责任，判断方案能否长期存在

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
  "project_summary_cn": "项目本身的 1-2 句中文简介",
  "opportunity_verdict": "HIGH_VALUE | PROMISING | LOW_VALUE | NO_CLEAR_OPPORTUNITY | INSUFFICIENT_EVIDENCE",
  "client_relevance": 0.0,
  "feasibility": 0.0,
  "effort_estimate": 0.0,
  "ecosystem_gap": 0.0,
  "harmony_leverage": 0.0,
  "opportunities": [
    {
      "area": "结合机会领域",
      "description": "具体交付物",
      "difficulty": "low | medium | high",
      "harmony_value": "具体鸿蒙端侧或多设备价值",
      "project_assets": "可复用的真实项目模块/接口/算法",
      "uncovered_scope": "当前支持尚未覆盖的范围",
      "implementation_outline": "从哪个平台插槽或模块入手",
      "target_devices": ["手机"],
      "target_kits": ["已核验的 Kit/API 或 需验证:能力"],
      "integration_form": "ohpm_package | arkui_component | napi_module | platform_backend | sdk_plugin | app_feature | docs_tooling",
      "ecosystem_need": 0.0,
      "project_advantage": 0.0,
      "user_reach": 0.0,
      "upstream_fit": 0.0,
      "confidence": 0.0,
      "evidence_refs": ["真实文件路径或原文"],
      "validation_questions": []
    }
  ],
  "analysis_details": {
    "architecture": {
      "core_modules": ["核心模块及真实路径"],
      "runtime_and_platform_boundary": "运行时/UI/系统API/原生层边界",
      "extension_points": ["真实的平台扩展入口"],
      "evidence_refs": ["当前仓库真实路径"]
    },
    "porting": {
      "reusable_core": ["可复用资产"],
      "required_changes": ["按模块拆解的必要改动"],
      "blocking_dependencies": ["系统API/依赖/许可证/测试阻塞"],
      "build_and_test_strategy": "可执行的构建、设备验证和回归方案"
    },
    "ecosystem": {
      "target_users_and_scenarios": ["具体用户、设备和业务场景"],
      "existing_alternatives": ["已确认替代方案；未知则写未知"],
      "differentiated_value": "相对直接复用或替代方案的增量价值",
      "adoption_and_maintenance_path": "发布、集成、上游和长期维护路径"
    },
    "decision": {
      "recommendation": "INVEST | VALIDATE_FIRST | DEFER | REJECT",
      "why_now": "支持决策的关键因果链",
      "prerequisites": ["投入前置条件"],
      "kill_criteria": ["停止投入条件"]
    },
    "historical_reuse": [{
      "source_repo": "历史来源仓库",
      "reused_insight": "复用的经验",
      "applicability": "适用与不适用边界",
      "current_repo_evidence": ["当前仓库中的复核证据"]
    }],
    "rejected_options": [{
      "idea": "被考虑的方案",
      "rejection_reason": "否决原因",
      "evidence_refs": ["当前仓库反证"]
    }]
  },
  "recommended_approach": "具体推荐路径；无可信机会时为 null",
  "reasoning": "详细的中文分析理由，引用具体代码证据",
  "key_files_analyzed": ["你分析过的关键文件路径列表"],
  "confidence": 0.0
}
```

## 字段说明

- `client_relevance` (0-1): 项目能力与鸿蒙终端/应用的直接相关度
- `feasibility` (0-1): 技术上适配到鸿蒙是否可行且有意义
- `effort_estimate` (0-1): 0=容易 1=非常困难
- `ecosystem_gap` (0-1): 该品类在鸿蒙生态中的空白程度
- `confidence` (0-1): 你对分析结论的信心程度

## 重要提醒

- 你必须通过工具调用来实际阅读代码，不要仅凭项目名称猜测
- 支持现状由独立信号层判断，不要输出 harmony_suggestion
- opportunities 最多 5 个，也可以为空；不要为了完整而凑答案。被否决方案写入 analysis_details.rejected_options
- 每个机会必须有项目特定资产、鸿蒙专属价值、未覆盖范围和真实 evidence_refs
- 平台无关代码可直接使用、纯服务端/内核/桌面专属项目通常应返回 NO_CLEAR_OPPORTUNITY
- 无可信机会时 opportunities=[] 且 recommended_approach=null
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
    model_options = {"enable_thinking": CODE_ANALYSIS_MODEL.startswith("qwen3.8")}
    reasoning_effort = os.environ.get("DASHSCOPE_REASONING_EFFORT")
    if reasoning_effort and CODE_ANALYSIS_MODEL.startswith("qwen3.8"):
        model_options["reasoning_effort"] = reasoning_effort

    agent = Agent(
        name="HarmonyOS Code Analyst",
        instructions=AGENT_INSTRUCTIONS,
        model=model,
        tools=ALL_TOOLS,
        model_settings=ModelSettings(
            max_tokens=16000,
            # qwen3.8-max 使用其原生推理能力；旧模型仍维持非思考模式兼容工具循环。
            extra_body=model_options,
        ),
    )
    return agent


async def analyze_repo(
    owner: str,
    name: str,
    ref: str = "HEAD",
    verbose: bool = False,
    historical_context: Optional[list[dict]] = None,
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

        # 3. 加载历史先验并构建用户提示
        from history_context import load_current_repository_context, load_historical_context
        current_context = load_current_repository_context(owner, name)
        if historical_context is None:
            historical_context = load_historical_context(owner, name)
        current_context_text = json.dumps(current_context, ensure_ascii=False, indent=2)
        history_text = json.dumps(historical_context, ensure_ascii=False, indent=2)
        user_prompt = (
            f"请分析 GitHub 仓库 `{owner}/{name}` 的源码，评估其鸿蒙化适配的价值和可行性。\n\n"
            f"源码已下载到本地目录: `{source_root}`\n\n"
            f"请按照分析步骤，系统性地浏览代码结构、阅读关键文件、搜索平台相关代码，"
            f"最终产出完整的 JSON 评估报告。\n\n"
            f"当前仓库的确定性支持事实与 tier-2 待验证假设如下。支持事实不得由你改写；"
            f"tier-2 结论必须通过源码独立复核，也允许依据新代码证据补充漏项。\n"
            f"{current_context_text if current_context else '(无数据库上下文，以源码为准)'}\n\n"
            f"相关项目历史分析如下。这些内容只能作为调查线索；必须用当前仓库源码重新核验，"
            f"并在 analysis_details.historical_reuse 中记录采用了什么、适用边界是什么。\n"
            f"{history_text if historical_context else '(无可用历史分析)'}\n\n"
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
