"""为 tarball 深析 Agent 提供同组织/相似项目的历史分析先验。"""

import os
from typing import Any

import requests


SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
MAX_REFERENCES = 6


def _headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }


def _get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_headers(),
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def _topic_similarity(left: list[str], right: list[str]) -> float:
    a = {item.lower() for item in left}
    b = {item.lower() for item in right}
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a), len(b))


def load_historical_context(owner: str, name: str) -> list[dict[str, Any]]:
    """历史记录只是待复核先验；数据库未配置或查询失败时安全降级为空。"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return []

    try:
        targets = _get("repositories", {
            "owner": f"eq.{owner}",
            "name": f"eq.{name}",
            "select": "id,owner,full_name,primary_language,topics",
            "limit": "1",
        })
        if not targets:
            return []
        target = targets[0]

        same_owner = _get("repositories", {
            "owner": f"eq.{owner}",
            "select": "id,owner,full_name,primary_language,topics,stars",
            "order": "stars.desc",
            "limit": "150",
        })
        similar_language: list[dict[str, Any]] = []
        if target.get("primary_language"):
            similar_language = _get("repositories", {
                "primary_language": f"eq.{target['primary_language']}",
                "select": "id,owner,full_name,primary_language,topics,stars",
                "order": "stars.desc",
                "limit": "250",
            })

        repositories = {row["id"]: row for row in same_owner + similar_language}
        repositories.pop(target["id"], None)
        if not repositories:
            return []

        ids = list(repositories)
        analysis_rows: list[dict[str, Any]] = []
        select = (
            "repository_id,tier,model,prompt_version,project_summary_cn,opportunity_verdict,"
            "opportunity_score,adaptation_points,recommended_approach,reasoning,analysis_details,analyzed_at,created_at"
        )
        for offset in range(0, len(ids), 100):
            chunk = ",".join(str(repo_id) for repo_id in ids[offset:offset + 100])
            analysis_rows.extend(_get("analysis", {
                "repository_id": f"in.({chunk})",
                "tier": "in.(2,3)",
                "select": select,
            }))

        best: dict[int, dict[str, Any]] = {}
        for row in analysis_rows:
            current = best.get(row["repository_id"])
            row_key = (row.get("tier", 0), row.get("analyzed_at") or row.get("created_at") or "")
            current_key = (
                current.get("tier", 0),
                current.get("analyzed_at") or current.get("created_at") or "",
            ) if current else (-1, "")
            if row_key > current_key:
                best[row["repository_id"]] = row

        ranked = []
        target_topics = target.get("topics") or []
        for repo_id, analysis in best.items():
            repo = repositories[repo_id]
            same_org = repo.get("owner", "").lower() == owner.lower()
            same_language = bool(
                target.get("primary_language")
                and repo.get("primary_language") == target.get("primary_language")
            )
            similarity = _topic_similarity(target_topics, repo.get("topics") or [])
            if not ((same_org and (same_language or similarity > 0)) or similarity >= 0.2):
                continue
            score = (
                (8 if same_org else 0)
                + similarity * 6
                + (1.5 if analysis.get("tier", 0) >= 3 else 0)
                + min(1, float(analysis.get("opportunity_score") or 0) / 100)
            )
            ranked.append((score, repo, analysis))

        ranked.sort(key=lambda item: (-item[0], item[1]["full_name"]))
        result = []
        for _, repo, analysis in ranked[:MAX_REFERENCES]:
            details = analysis.get("analysis_details") or {}
            result.append({
                "source_repo": repo["full_name"],
                "relation_clues": {
                    "same_organization": repo.get("owner", "").lower() == owner.lower(),
                    "language": repo.get("primary_language"),
                    "topics": repo.get("topics") or [],
                },
                "analysis_level": f"tier-{analysis.get('tier')} / {analysis.get('prompt_version')} / {analysis.get('model')}",
                "summary": analysis.get("project_summary_cn"),
                "verdict": analysis.get("opportunity_verdict"),
                "opportunities": (analysis.get("adaptation_points") or [])[:3],
                "recommended_approach": analysis.get("recommended_approach"),
                "decision": details.get("decision"),
                "reasoning_excerpt": (analysis.get("reasoning") or "")[:800],
            })
        return result
    except (requests.RequestException, KeyError, TypeError, ValueError):
        return []


def load_current_repository_context(owner: str, name: str) -> dict[str, Any]:
    """加载当前仓库的确定性支持事实和 tier-2 假设，供 tier-3 独立复核。"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return {}
    try:
        repositories = _get("repositories", {
            "owner": f"eq.{owner}",
            "name": f"eq.{name}",
            "select": "id,full_name,description,primary_language,topics,license,stars",
            "limit": "1",
        })
        if not repositories:
            return {}
        repo = repositories[0]
        signals = _get("harmony_signals", {
            "repository_id": f"eq.{repo['id']}",
            "select": "support_availability,support_provenance,support_coverage,support_confidence,support_evidence,ohpm_matched,ohpm_packages,gitcode_matched,gitcode_repo_url,deepwiki_scope",
            "limit": "1",
        })
        overrides = _get("harmony_overrides", {
            "repository_id": f"eq.{repo['id']}",
            "select": "state,note,marked_by,marked_at",
            "limit": "1",
        })
        tier2 = _get("analysis", {
            "repository_id": f"eq.{repo['id']}",
            "tier": "eq.2",
            "select": "model,prompt_version,project_summary_cn,opportunity_verdict,opportunity_score,adaptation_points,recommended_approach,reasoning,analysis_details,analyzed_at",
            "order": "analyzed_at.desc.nullslast",
            "limit": "1",
        })
        return {
            "repository": repo,
            "support_facts": signals[0] if signals else None,
            "manual_override": overrides[0] if overrides else None,
            "tier2_hypothesis": tier2[0] if tier2 else None,
        }
    except (requests.RequestException, KeyError, TypeError, ValueError):
        return {}
