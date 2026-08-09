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

-- 建列 + 回填放在同一个「首次执行」守卫里。
--
-- 注意:scripts/db-migrate.ts 没有 schema_migrations 记账表,每次 `pnpm db:migrate`
-- 都会把 supabase/migrations/*.sql **全部重跑一遍**。DDL 靠 `if not exists` 幂等即可,
-- 但本迁移的回填是一次性数据搬运:重复执行会把历史快照里已经正确的 stars
-- 再次覆盖成 repositories 的当前总量(甚至把管道刚写好的增量搬错位)。
-- 所以用「stars_delta 列是否已存在」作为一次性标记 —— 列已在就整段跳过。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trending_snapshots'
      and column_name = 'stars_delta'
  ) then
    raise notice '0014: stars_delta 已存在,跳过建列与回填';
  else
    execute 'alter table trending_snapshots add column stars_delta integer';
    execute 'alter table trending_snapshots add column forks_delta integer';

    -- 1. 旧的 stars/forks 实际是周期增量,平移到 delta 列,并把总量列清空待填。
    execute $sql$
      update trending_snapshots
      set stars_delta = stars,
          forks_delta = forks,
          stars = null,
          forks = null
      where stars is not null or forks is not null
    $sql$;

    -- 2. 总量从 repositories 取当前值(历史行只能近似,追溯不到当时的快照总量);
    --    关联不上 repository_id 的行保持 null —— 宁可显示「-」也不要继续展示语义错误的数字。
    execute $sql$
      update trending_snapshots ts
      set stars = r.stars,
          forks = r.forks
      from repositories r
      where ts.repository_id = r.id
    $sql$;
  end if;
end $$;

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
