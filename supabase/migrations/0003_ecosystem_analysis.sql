-- ============================================================================
-- 生态端到端分析改造:新增字段
-- ============================================================================

-- analysis 表:新增已鸿蒙化代码仓地址
alter table analysis add column if not exists harmony_adapted_repo_url text;

-- harmony_signals 表:新增 GitCode 搜索相关字段
alter table harmony_signals add column if not exists gitcode_matched boolean not null default false;
alter table harmony_signals add column if not exists gitcode_repo_url text;
alter table harmony_signals add column if not exists gitcode_repo_name text;

-- 更新 repo_board 视图(合并 archived + gitcode 字段)
drop view if exists repo_board;
create view repo_board
with (security_invoker = on) as
select
  r.id,
  r.full_name,
  r.owner,
  r.name,
  r.description,
  r.homepage,
  r.primary_language,
  r.stars,
  r.forks,
  r.topics,
  r.license,
  r.pushed_at,
  r.is_archived,
  r.archived_reason,
  pr.priority_score,
  pr.rank,
  pr.breakdown,
  a.category,
  a.subcategory,
  a.tier               as analysis_tier,
  a.harmony_suggestion,
  a.harmony_adapted_repo_url,
  a.mobile_relevance,
  a.feasibility,
  a.effort_estimate,
  a.ecosystem_gap,
  a.adaptation_points,
  a.recommended_approach,
  a.reasoning,
  hs.auto_state_hint,
  hs.ohpm_matched,
  hs.ohpm_packages,
  hs.has_oh_package,
  hs.has_build_profile,
  hs.has_ets,
  hs.in_registry,
  hs.registry_source,
  hs.source_repo_url,
  hs.keyword_score,
  hs.gitcode_matched,
  hs.gitcode_repo_url,
  hs.gitcode_repo_name,
  o.state              as override_state,
  o.note               as override_note,
  o.marked_by,
  o.marked_at,
  coalesce(o.state, hs.auto_state_hint) as effective_state,
  (o.state is not null) as reviewed
from repositories r
left join priority_rankings pr on pr.repository_id = r.id
left join lateral (
  select * from analysis a2
  where a2.repository_id = r.id
  order by a2.tier desc, a2.created_at desc
  limit 1
) a on true
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id;

grant select on repo_board to anon, authenticated;
