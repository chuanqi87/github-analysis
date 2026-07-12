-- ============================================================================
-- 每周热点:添加上榜周数追踪字段 + RPC 函数
-- ============================================================================

-- 添加上榜周数字段(累积该仓库出现在 trending 快照的不同周数)
alter table trending_snapshots add column if not exists weeks_on_trending smallint not null default 1;

comment on column trending_snapshots.weeks_on_trending is '该仓库累积上榜的不同周数(基于 captured_date 所在周去重统计)';
comment on table trending_snapshots is '每周热点快照(原每日热点,改为每周采集一次)';

-- 为查询周数统计创建索引
create index if not exists idx_trending_repo_name on trending_snapshots (repo_name);

-- 创建 RPC 函数:统计仓库的历史上榜周数
-- 通过 DATE_TRUNC('week', captured_date) 去重来计算不同周数
create or replace function count_trending_weeks(p_repo_names text[])
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
  group by ts.repo_name;
end;
$$;

comment on function count_trending_weeks(text[]) is '统计指定仓库列表在 trending_snapshots 中的历史上榜周数';
