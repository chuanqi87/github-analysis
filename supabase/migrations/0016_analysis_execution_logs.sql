-- ============================================================================
-- 可追溯分析 Session 与逐项目 AI 执行日志
--
-- pipeline_runs.session_id 把一次 daily 总控及其所有子阶段串成同一条链路。
-- analysis_execution_logs 保存实际送模 Prompt、结构化输出、耗时、Token 与失败原因，
-- 用于分层质量复盘和 Prompt/Agent 回归对比。
-- ============================================================================

alter table pipeline_runs add column if not exists session_id text;
create index if not exists idx_pipeline_runs_session
  on pipeline_runs (session_id, started_at desc);

create table if not exists analysis_execution_logs (
  id                 bigserial primary key,
  session_id         text not null,
  pipeline_run_id    bigint references pipeline_runs (id) on delete set null,
  repository_id      bigint not null references repositories (id) on delete cascade,
  tier               smallint not null check (tier in (1, 2, 3)),
  status             text not null check (status in ('success', 'failed', 'skipped')),
  model              text not null,
  prompt_version     text not null,
  input_hash         text,
  system_prompt      text,
  user_prompt        text,
  evidence           jsonb not null default '{}'::jsonb,
  output             jsonb,
  error              text,
  tokens_in          integer,
  tokens_out         integer,
  started_at         timestamptz not null,
  finished_at        timestamptz not null,
  duration_ms        integer not null check (duration_ms >= 0),
  created_at         timestamptz not null default now()
);

create index if not exists idx_analysis_execution_session_tier
  on analysis_execution_logs (session_id, tier, status);
create index if not exists idx_analysis_execution_repo
  on analysis_execution_logs (repository_id, tier, created_at desc);

alter table analysis_execution_logs enable row level security;

drop policy if exists "authenticated_read" on analysis_execution_logs;
create policy "authenticated_read" on analysis_execution_logs
  for select to authenticated using (true);

grant select on analysis_execution_logs to authenticated;

comment on table analysis_execution_logs is '逐项目 AI 调用审计：完整 Prompt、输出、耗时、Token、失败与所属 session';
comment on column pipeline_runs.session_id is '一次顶层执行及其子阶段共享的可追溯 session 标识';
