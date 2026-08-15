-- 修复 0014 未完整应用时仍保留的单参数 RPC，并限制为管道角色调用。
drop function if exists public.count_trending_weeks(text[]);
drop function if exists public.count_trending_weeks(text[], date);

create function public.count_trending_weeks(
  p_repo_names text[],
  p_exclude_week date default null
)
returns table(repo_name text, week_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    snapshots.repo_name,
    count(distinct date_trunc('week', snapshots.captured_date))::bigint as week_count
  from public.trending_snapshots as snapshots
  where snapshots.repo_name = any(p_repo_names)
    and (
      p_exclude_week is null
      or date_trunc('week', snapshots.captured_date) <> date_trunc('week', p_exclude_week)
    )
  group by snapshots.repo_name;
$$;

revoke all on function public.count_trending_weeks(text[], date)
  from public, anon, authenticated;
grant execute on function public.count_trending_weeks(text[], date)
  to service_role;

comment on function public.count_trending_weeks(text[], date) is
  '统计指定仓库的历史上榜周数；排除指定周，供 service_role 管道幂等计算';
