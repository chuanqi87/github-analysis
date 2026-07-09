-- ============================================================================
-- 看板视图:把连表 + 有效鸿蒙状态 + 聚合下推到 Postgres。
-- security_invoker=on → 沿用底表的 RLS(公开只读)。
-- ============================================================================

-- 单仓看板行:元数据 + 优先级 + 最新分析 + 信号 + 人工标记 + 有效状态。
create or replace view repo_board
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
  pr.priority_score,
  pr.rank,
  pr.breakdown,
  a.category,
  a.subcategory,
  a.tier               as analysis_tier,
  a.harmony_suggestion,
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

-- 分类分布聚合
create or replace view v_category_stats
with (security_invoker = on) as
select
  coalesce(a.category::text, 'OTHER') as category,
  count(*)                            as total,
  avg(pr.priority_score)              as avg_priority,
  count(*) filter (where coalesce(o.state, hs.auto_state_hint) = 'ADAPTED')     as adapted,
  count(*) filter (where coalesce(o.state, hs.auto_state_hint) = 'NOT_ADAPTED') as not_adapted
from repositories r
left join lateral (
  select category from analysis a2
  where a2.repository_id = r.id
  order by a2.tier desc, a2.created_at desc
  limit 1
) a on true
left join priority_rankings pr on pr.repository_id = r.id
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id
group by 1;

-- 鸿蒙化状态分布聚合
create or replace view v_harmony_stats
with (security_invoker = on) as
select
  coalesce(o.state, hs.auto_state_hint, 'NOT_ADAPTED') as effective_state,
  count(*)                              as total,
  count(*) filter (where o.state is not null) as reviewed
from repositories r
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id
group by 1;

grant select on repo_board, v_category_stats, v_harmony_stats to anon, authenticated;
