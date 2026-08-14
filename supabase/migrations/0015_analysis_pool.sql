-- ============================================================================
-- 分层分析池 + 每日进展
--
-- analysis_queue 是调度事实表：发现来源、热点证据、当前分析层级和下一步优先级
-- 都落在这里，避免每次都从 Star 榜首截断，导致已分析项目永久占住名额。
-- pipeline_daily_metrics 为看板提供每日可核对的增量与积压。
-- ============================================================================

create table if not exists analysis_queue (
  repository_id          bigint primary key references repositories (id) on delete cascade,
  sources                text[] not null default '{}',
  state                  text not null default 'discovered'
                         check (state in ('discovered', 'preliminary', 'deep', 'monitoring', 'excluded')),
  discovery_score        real not null default 0,
  preliminary_score      real,
  deep_score             real,
  hot_score              real not null default 0,
  source_count           smallint not null default 0,
  trending_weeks         smallint not null default 0,
  reasons                jsonb not null default '[]'::jsonb,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  preliminary_analyzed_at timestamptz,
  deep_analyzed_at       timestamptz,
  tier3_analyzed_at      timestamptz,
  next_analysis_at       timestamptz,
  updated_at             timestamptz not null default now()
);

create index if not exists idx_analysis_queue_state_score
  on analysis_queue (state, discovery_score desc);
create index if not exists idx_analysis_queue_hot
  on analysis_queue (hot_score desc) where hot_score > 0;
create index if not exists idx_analysis_queue_next
  on analysis_queue (next_analysis_at) where next_analysis_at is not null;

drop trigger if exists trg_analysis_queue_updated on analysis_queue;
create trigger trg_analysis_queue_updated before update on analysis_queue
  for each row execute function set_updated_at();

create table if not exists pipeline_daily_metrics (
  metric_date           date primary key,
  repositories_total    integer not null default 0,
  discovered_today      integer not null default 0,
  preliminary_today     integer not null default 0,
  deep_today            integer not null default 0,
  tier3_today           integer not null default 0,
  trending_collected    integer not null default 0,
  trending_promoted     integer not null default 0,
  preliminary_backlog   integer not null default 0,
  deep_backlog          integer not null default 0,
  tier3_backlog         integer not null default 0,
  failed_count          integer not null default 0,
  stats                 jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now()
);

-- analysis 的唯一行会被 upsert 更新，created_at 不能表达“最近一次重析”。
alter table analysis add column if not exists analyzed_at timestamptz;
update analysis set analyzed_at = created_at where analyzed_at is null;
alter table analysis alter column analyzed_at set default now();

-- 热点证据保留原始分量，避免只存一个不可解释的倒数排名分。
alter table trending_snapshots add column if not exists source_count smallint not null default 1;
alter table trending_snapshots add column if not exists daily_score real;
alter table trending_snapshots add column if not exists weekly_score real;
alter table trending_snapshots add column if not exists stars_delta integer;
alter table trending_snapshots add column if not exists forks_delta integer;
alter table trending_snapshots add column if not exists promoted boolean not null default false;
alter table trending_snapshots add column if not exists metric_version text;

alter table analysis_queue enable row level security;
alter table pipeline_daily_metrics enable row level security;

drop policy if exists "public_read" on analysis_queue;
create policy "public_read" on analysis_queue for select using (true);
drop policy if exists "public_read" on pipeline_daily_metrics;
create policy "public_read" on pipeline_daily_metrics for select using (true);

grant select on analysis_queue, pipeline_daily_metrics to anon, authenticated;

comment on table analysis_queue is '持久分析候选池：未分析积压优先消化，清空后自然转为热点/变化项目驱动';
comment on column analysis_queue.reasons is '可解释的入池和排序原因，如多源热点、移动相关度、生态缺口';
comment on table pipeline_daily_metrics is '每日新增、初析、深析、热点入池、失败与积压快照';
