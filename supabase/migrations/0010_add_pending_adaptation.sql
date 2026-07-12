-- ============================================================================
-- 新增 harmony_state 枚举值:PENDING_ADAPTATION(待适配)
--
-- 语义:分析后确认需要鸿蒙化适配,但目前尚未适配。
-- 是 NOT_ADAPTED(未适配/信号检测默认值)的细分:
--   - NOT_ADAPTED       = 未评估/信号检测默认(事实层面)
--   - PENDING_ADAPTATION = 分析后确认需要适配(结论层面,由 LLM/人工产出)
-- 两者在评分门控中 gate 均为 1.0(高优先级)。
-- ============================================================================

-- 1. 扩展枚举(PostgreSQL 12+ 支持事务内 ADD VALUE)
alter type harmony_state add value if not exists 'PENDING_ADAPTATION';

-- 2. 重建 v_category_stats:not_adapted 统计包含 PENDING_ADAPTATION(两者均属"未适配")
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
