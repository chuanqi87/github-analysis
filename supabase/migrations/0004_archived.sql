-- ============================================================================
-- 归档仓库标记:is_archived + archived_reason
-- 检测来源:1) GitHub API archived 字段  2) README 关键词
-- 归档仓库不参与 LLM 分析,优先级评分自动沉底。
-- ============================================================================

-- ---- repositories 表增加归档字段(幂等) --------------------------------
alter table repositories add column if not exists is_archived boolean not null default false;
alter table repositories add column if not exists archived_reason text;  -- 'github_archived' | 'readme_archived' | null

-- 索引:快速过滤归档仓库
create index if not exists idx_repositories_archived on repositories (is_archived) where is_archived = true;

-- ---- 重建所有视图(合并 gitcode + archived 字段,使用 DROP 避免列名冲突) ---
drop view if exists v_category_stats;
drop view if exists v_harmony_stats;
drop view if exists repo_board;

-- 单仓看板行
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

-- 分类分布聚合(排除归档)
create view v_category_stats
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
where not r.is_archived
group by 1;

-- 鸿蒙化状态分布聚合(排除归档)
create view v_harmony_stats
with (security_invoker = on) as
select
  coalesce(o.state, hs.auto_state_hint, 'NOT_ADAPTED') as effective_state,
  count(*)                              as total,
  count(*) filter (where o.state is not null) as reviewed
from repositories r
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id
where not r.is_archived
group by 1;

grant select on repo_board, v_category_stats, v_harmony_stats to anon, authenticated;
