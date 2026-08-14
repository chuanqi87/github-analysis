"""
Supabase 写入模块 —— 将 Agent 分析结果持久化到数据库。
"""

import json
import os
from datetime import datetime
from typing import Optional

import requests


SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def get_repository_id(owner: str, name: str) -> Optional[int]:
    """根据 owner/name 查询 repositories 表获取 repository_id。"""
    if not is_configured():
        return None
    
    url = f"{SUPABASE_URL}/rest/v1/repositories?owner=eq.{owner}&name=eq.{name}&select=id"
    resp = requests.get(url, headers=_headers())
    resp.raise_for_status()
    rows = resp.json()
    return rows[0]["id"] if rows else None


def write_tier3_analysis(
    owner: str,
    name: str,
    analysis: dict,
    model: str = "qwen3-max",
    prompt_version: str = "agent-v1",
) -> dict:
    """
    将 Agent 的深度分析结果写入 analysis 表（tier=3）。
    
    Args:
        owner: 仓库 owner
        name: 仓库 name
        analysis: Agent 产出的分析结果字典
        model: 使用的模型名称
        prompt_version: prompt 版本标识
    
    Returns:
        写入结果的状态信息
    """
    if not is_configured():
        return {"status": "skipped", "reason": "Supabase 未配置"}
    
    # 获取 repository_id
    repo_id = get_repository_id(owner, name)
    if not repo_id:
        return {"status": "error", "reason": f"未找到仓库 {owner}/{name}"}
    
    # 构建 adaptation_points（包含 evidence）
    adaptation_points = analysis.get("adaptation_points", [])
    ap_rows = []
    for ap in adaptation_points[:8]:  # 最多 8 个
        ap_rows.append({
            "area": ap.get("area", ""),
            "description": ap.get("description", ""),
            "difficulty": ap.get("difficulty", "medium"),
            "evidence": ap.get("evidence", ""),
        })
    
    # 映射 harmony_suggestion
    harmony_map = {
        "ADAPTED": "ADAPTED",
        "PARTIAL": "PARTIAL", 
        "NOT_ADAPTED": "NOT_ADAPTED",
        "NOT_APPLICABLE": "NOT_APPLICABLE",
    }
    harmony = harmony_map.get(analysis.get("harmony_suggestion", "NOT_ADAPTED"), "NOT_ADAPTED")
    
    # 构建写入数据
    row = {
        "repository_id": repo_id,
        "tier": 3,
        "model": model,
        "prompt_version": prompt_version,
        "input_hash": f"agent-{owner}-{name}-{datetime.utcnow().isoformat()}",
        # 基础字段
        "category": _map_category(analysis.get("category", "")),
        "subcategory": analysis.get("subcategory", ""),
        "harmony_suggestion": harmony,
        "mobile_relevance": analysis.get("mobile_relevance", 0),
        "feasibility": analysis.get("feasibility", 0),
        "effort_estimate": analysis.get("effort_estimate", 0),
        "ecosystem_gap": analysis.get("ecosystem_gap", 0),
        "adaptation_points": ap_rows,
        "recommended_approach": analysis.get("recommended_approach", ""),
        "reasoning": analysis.get("reasoning", ""),
        "confidence": analysis.get("confidence", 0),
        "analyzed_at": datetime.utcnow().isoformat(),
        # Tier-3 专有字段
        "project_type": analysis.get("project_type", ""),
        "tech_stack": analysis.get("tech_stack", {}),
        "dependencies_analysis": analysis.get("dependencies_analysis", {}),
        "key_files_analyzed": analysis.get("key_files_analyzed", []),
    }
    
    # 写入 Supabase
    conflict_columns = "repository_id,tier,prompt_version,model"
    url = f"{SUPABASE_URL}/rest/v1/analysis?on_conflict={conflict_columns}"
    resp = requests.post(
        url,
        headers=_headers(),
        json=row,
    )
    
    if resp.status_code in (200, 201):
        return {"status": "success", "repository_id": repo_id}
    else:
        return {
            "status": "error",
            "http_status": resp.status_code,
            "detail": resp.text[:500],
        }


def _map_category(cat: str) -> str:
    """将 Agent 输出的分类映射到枚举值。"""
    mapping = {
        "UI组件": "UI_FRAMEWORK",
        "UI框架": "UI_FRAMEWORK",
        "跨端框架": "CROSS_PLATFORM",
        "网络": "NETWORK_LIB",
        "网络库": "NETWORK_LIB",
        "存储": "DATABASE",
        "数据存储": "DATABASE",
        "数据库": "DATABASE",
        "AI/ML": "AI_ML",
        "机器学习": "AI_ML",
        "开发工具": "DEV_TOOL",
        "工具": "UTILITY_LIB",
        "通用工具库": "UTILITY_LIB",
        "命令行工具": "CLI",
        "构建工具": "BUILD_TOOL",
        "多媒体": "MEDIA",
        "图形/游戏": "GRAPHICS_GAME",
        "安全": "SECURITY",
        "移动应用": "MOBILE_APP",
        "桌面应用": "DESKTOP_APP",
        "服务端": "SERVER_BACKEND",
        "后端": "SERVER_BACKEND",
        "文档": "LEARNING_DOCS",
        "学习": "LEARNING_DOCS",
    }
    return mapping.get(cat, "OTHER")


def batch_write(results: list[dict], model: str = "qwen3-max") -> list[dict]:
    """批量写入分析结果。"""
    statuses = []
    for r in results:
        if "error" in r:
            statuses.append({"owner": r["owner"], "name": r["name"], "status": "skipped", "reason": r["error"]})
            continue
        
        analysis = r.get("analysis", {})
        if "parse_error" in analysis:
            statuses.append({"owner": r["owner"], "name": r["name"], "status": "skipped", "reason": "JSON 解析失败"})
            continue
        
        result = write_tier3_analysis(
            owner=r["owner"],
            name=r["name"],
            analysis=analysis,
            model=model,
        )
        result["owner"] = r["owner"]
        result["name"] = r["name"]
        statuses.append(result)
    
    return statuses
