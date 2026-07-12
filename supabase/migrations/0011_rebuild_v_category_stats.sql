-- ============================================================================
-- 重建 v_category_stats:not_adapted 统计包含 PENDING_ADAPTATION(两者均属"未适配")
--
-- 前置:0010 已把 'PENDING_ADAPTATION' 加入 harmony_state 枚举并提交(独立事务)。
--       本文件在新事务中重建视图,新枚举值此时已可见,不再触发 unsafe-use 限制。
-- ============================================================================
drop view if exists v_category_stats;

create view v_category_stats
with (security_invoker = on) as
select
  coalesce(pc.slug, lower(a.category::text), 'other') as category,
  coalesce(pc.name_cn, '其它')                         as category_name,
  count(*)                                             as total,
  avg(pr.priority_score)                               as avg_priority,
  count(*) filter (where coalesce(o.state, hs.auto_state_hint) = 'ADAPTED')                   as adapted,
  count(*) filter (where coalesce(o.state, hs.auto_state_hint) in ('NOT_ADAPTED', 'PENDING_ADAPTATION')) as not_adapted
from repositories r
left join lateral (
  select category_id, category from analysis a2
  where a2.repository_id = r.id
  order by a2.tier desc, a2.created_at desc
  limit 1
) a on true
left join categories pc on pc.id = a.category_id
left join priority_rankings pr on pr.repository_id = r.id
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id
where not r.is_archived
group by 1, 2;

grant select on v_category_stats to anon, authenticated;
