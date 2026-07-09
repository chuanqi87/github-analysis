#!/usr/bin/env python3
"""
鸿蒙化代码深度分析 Agent —— CLI 入口。

用法:
    # 分析单个仓库
    python run.py facebook/react

    # 分析多个仓库
    python run.py facebook/react vuejs/core sveltejs/svelte

    # 指定 ref (分支/tag)
    python run.py facebook/react --ref v19.0.0

    # 输出到文件
    python run.py facebook/react -o result.json

    # 详细模式
    python run.py facebook/react -v

    # 从 Supabase 读取待分析仓库（与 pipeline 集成）
    python run.py --from-db --limit 10

    # 分析结果写回 Supabase
    python run.py facebook/react --write-db -v

环境变量:
    DASHSCOPE_API_KEY    - 百炼 API Key（必需）
    DASHSCOPE_BASE_URL   - 百炼 API 地址（默认 dashscope.aliyuncs.com）
    CODE_ANALYSIS_MODEL  - 分析模型（默认 qwen3-max）
    GITHUB_TOKEN         - GitHub PAT（可选，提升配额）
    SUPABASE_URL         - Supabase URL（--from-db / --write-db 模式需要）
    SUPABASE_SERVICE_ROLE_KEY - Supabase Service Key（--from-db / --write-db 模式需要）
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# 确保可以导入同目录下的 agent 模块
sys.path.insert(0, str(Path(__file__).parent))

from agent import analyze_repo, analyze_repos_batch, CODE_ANALYSIS_MODEL


def parse_repo_arg(arg: str) -> dict:
    """解析 owner/name 或 owner/name@ref 格式。"""
    if "@" in arg:
        repo, ref = arg.rsplit("@", 1)
    else:
        repo, ref = arg, "HEAD"
    parts = repo.split("/")
    if len(parts) != 2:
        raise ValueError(f"无效的仓库格式: {arg}（应为 owner/name 或 owner/name@ref）")
    return {"owner": parts[0], "name": parts[1], "ref": ref}


def load_repos_from_db(limit: int = 20) -> list[dict]:
    """
    从 Supabase 读取有 tier-2 结果但尚未做 tier-3 深度分析的仓库。
    """
    try:
        import requests
    except ImportError:
        print("错误: --from-db 模式需要 requests 库", file=sys.stderr)
        sys.exit(1)

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("错误: --from-db 需要 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }

    # 查询有 tier-2 结果但无 tier-3 的仓库 ID
    # Step 1: 获取所有 tier-2 的 repository_id
    tier2_url = (
        f"{supabase_url}/rest/v1/analysis"
        f"?tier=eq.2&select=repository_id"
    )
    resp = requests.get(tier2_url, headers=headers)
    resp.raise_for_status()
    tier2_ids = {r["repository_id"] for r in resp.json()}

    # Step 2: 获取已有 tier-3 的 repository_id（排除）
    tier3_url = (
        f"{supabase_url}/rest/v1/analysis"
        f"?tier=eq.3&select=repository_id"
    )
    resp = requests.get(tier3_url, headers=headers)
    resp.raise_for_status()
    tier3_ids = {r["repository_id"] for r in resp.json()}

    candidate_ids = list(tier2_ids - tier3_ids)[:limit]
    if not candidate_ids:
        print("没有找到待分析的仓库（所有 tier-2 仓库均已有 tier-3 分析）。")
        return []

    # 查询仓库信息
    repos = []
    for i in range(0, len(candidate_ids), 50):
        chunk = candidate_ids[i:i+50]
        ids_param = ",".join(str(id) for id in chunk)
        url = (
            f"{supabase_url}/rest/v1/repositories"
            f"?id=in.({ids_param})&select=id,owner,name,full_name,stars"
            f"&order=stars.desc"
        )
        resp = requests.get(url, headers=headers)
        resp.raise_for_status()
        repos.extend(resp.json())

    # 按 star 降序排序
    repos.sort(key=lambda r: r.get("stars", 0), reverse=True)
    return [{"owner": r["owner"], "name": r["name"], "ref": "HEAD"} for r in repos[:limit]]


async def main():
    parser = argparse.ArgumentParser(
        description="鸿蒙化代码深度分析 Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "repos",
        nargs="*",
        help="要分析的仓库（格式: owner/name 或 owner/name@ref）",
    )
    parser.add_argument(
        "--from-db",
        action="store_true",
        help="从 Supabase 读取待分析仓库",
    )
    parser.add_argument(
        "--write-db",
        action="store_true",
        help="将分析结果写回 Supabase（tier=3）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="--from-db 模式下最多分析多少个仓库（默认 10）",
    )
    parser.add_argument(
        "-o", "--output",
        help="输出文件路径（默认打印到 stdout）",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="详细输出模式",
    )
    parser.add_argument(
        "--ref",
        default="HEAD",
        help="所有仓库的默认 ref（可被 owner/name@ref 覆盖）",
    )

    args = parser.parse_args()

    # 确定要分析的仓库列表
    if args.from_db:
        repos = load_repos_from_db(limit=args.limit)
        if not repos:
            print("没有找到待分析的仓库。", file=sys.stderr)
            sys.exit(1)
    elif args.repos:
        repos = []
        for arg in args.repos:
            try:
                repo = parse_repo_arg(arg)
                if repo["ref"] == "HEAD" and args.ref != "HEAD":
                    repo["ref"] = args.ref
                repos.append(repo)
            except ValueError as e:
                print(f"错误: {e}", file=sys.stderr)
                sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)

    print(f"📋 待分析仓库: {len(repos)} 个", file=sys.stderr)
    for r in repos:
        print(f"   - {r['owner']}/{r['name']}@{r['ref']}", file=sys.stderr)

    # 运行分析
    if len(repos) == 1:
        result = await analyze_repo(
            repos[0]["owner"],
            repos[0]["name"],
            ref=repos[0]["ref"],
            verbose=args.verbose,
        )
        results = [result]
    else:
        results = await analyze_repos_batch(repos, verbose=args.verbose)

    # 输出结果
    output = json.dumps(results, ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"\n✅ 结果已写入 {args.output}", file=sys.stderr)
    else:
        print(output)

    # 写入 Supabase
    if args.write_db:
        from supabase_writer import batch_write
        print(f"\n📝 写入 Supabase...", file=sys.stderr)
        statuses = batch_write(results, model=CODE_ANALYSIS_MODEL)
        for s in statuses:
            icon = "✅" if s["status"] == "success" else "❌" if s["status"] == "error" else "⏭️"
            print(f"  {icon} {s['owner']}/{s['name']}: {s['status']}", file=sys.stderr)
            if s["status"] == "error":
                print(f"     {s.get('detail', s.get('reason', ''))[:100]}", file=sys.stderr)

    # 打印摘要
    print("\n" + "=" * 60, file=sys.stderr)
    print("📊 分析摘要", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    for r in results:
        owner = r.get("owner", "?")
        name = r.get("name", "?")
        analysis = r.get("analysis", {})
        if "error" in r:
            print(f"  ❌ {owner}/{name}: {r['error']}", file=sys.stderr)
        elif "parse_error" in analysis:
            print(f"  ⚠️  {owner}/{name}: JSON 解析失败", file=sys.stderr)
        else:
            harmony = analysis.get("harmony_suggestion", "?")
            feasibility = analysis.get("feasibility", "?")
            effort = analysis.get("effort_estimate", "?")
            print(
                f"  ✅ {owner}/{name}: "
                f"harmony={harmony}, "
                f"feasibility={feasibility}, "
                f"effort={effort}",
                file=sys.stderr,
            )


if __name__ == "__main__":
    asyncio.run(main())
