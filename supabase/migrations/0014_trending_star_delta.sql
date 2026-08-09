-- ============================================================================
-- 每周热点:区分「仓库总 star 数」与「本周新增 star 数」
--
-- 背景:trending_snapshots.stars 一直写的是 OSS Insight `/v1/trends/repos`
-- 返回的 stars 列,而那一列是**采集周期内(past_week)新增的 star 数**,
-- 不是仓库的总 star 数。前端「Star」列直接展示它,于是看板上出现
-- 「216 ⭐」这种明显不对的数字;只来自 github-trending 的行则完全没有 star
-- (旧解析器根本没抓 star),显示为「-」。
--
-- 本迁移把两个语义拆成两列:
--   stars        = 仓库当前总 star 数(以 GitHub GraphQL 为准)
--   stars_delta  = 该快照周期(近一周)内新增的 star 数
-- forks 同理。
-- ============================================================================

alter table trending_snapshots add column if not exists stars_delta integer;
alter table trending_snapshots add column if not exists forks_delta integer;

-- ---- 历史数据回填 ----------------------------------------------------------
-- 1. 旧的 stars/forks 实际是周期增量,平移到 delta 列。
update trending_snapshots
set stars_delta = stars
where stars_delta is null and stars is not null;

update trending_snapshots
set forks_delta = forks
where forks_delta is null and forks is not null;

-- 2. stars/forks 改存总量:能关联到 repositories 的取当前总量(历史行只能近似),
--    关联不上的置空 —— 宁可显示「-」也不要继续展示语义错误的数字。
update trending_snapshots ts
set stars = r.stars,
    forks = r.forks
from repositories r
where ts.repository_id = r.id;

update trending_snapshots
set stars = null,
    forks = null
where repository_id is null;

comment on column trending_snapshots.stars is '仓库当前总 star 数(GitHub GraphQL stargazerCount);未能解析时为 null';
comment on column trending_snapshots.stars_delta is '该快照周期(近一周)内新增的 star 数';
comment on column trending_snapshots.forks is '仓库当前总 fork 数;未能解析时为 null';
comment on column trending_snapshots.forks_delta is '该快照周期(近一周)内新增的 fork 数';

-- ---- 上榜周数:同一周重跑不应重复计数 ---------------------------------------
-- 旧实现 count_trending_weeks 统计包含本周在内的所有周,而调用方还会 +1,
-- 于是同一周内第二次跑 weekly-trending 就把 weeks_on_trending 又加了 1。
-- 新增 p_exclude_week 参数,让调用方排除正在写入的那一周。
drop function if exists count_trending_weeks(text[]);

create or replace function count_trending_weeks(
  p_repo_names text[],
  p_exclude_week date default null
)
returns table(repo_name text, week_count bigint)
language plpgsql
security definer
as $$
begin
  return query
  select
    ts.repo_name,
    count(distinct date_trunc('week', ts.captured_date))::bigint as week_count
  from trending_snapshots ts
  where ts.repo_name = any(p_repo_names)
    and (
      p_exclude_week is null
      or date_trunc('week', ts.captured_date) <> date_trunc('week', p_exclude_week)
    )
  group by ts.repo_name;
end;
$$;

comment on function count_trending_weeks(text[], date) is
  '统计指定仓库的历史上榜周数;p_exclude_week 所在周会被排除,便于本周重跑时幂等';
