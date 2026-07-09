-- ============================================================================
-- 鸿蒙生态适配分析看板 — 初始 schema + RLS
-- 运行:supabase db push  (或在 Supabase SQL Editor 里执行)
-- ============================================================================

-- ---- 枚举 ----------------------------------------------------------------
do $$ begin
  create type harmony_state as enum ('ADAPTED', 'PARTIAL', 'NOT_ADAPTED', 'NOT_APPLICABLE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type repo_category as enum (
    'UI_FRAMEWORK', 'CROSS_PLATFORM', 'NETWORK_LIB', 'DATABASE', 'AI_ML',
    'DEV_TOOL', 'CLI', 'BUILD_TOOL', 'UTILITY_LIB', 'MEDIA', 'GRAPHICS_GAME',
    'SECURITY', 'MOBILE_APP', 'DESKTOP_APP', 'SERVER_BACKEND', 'LEARNING_DOCS', 'OTHER'
  );
exception when duplicate_object then null; end $$;

-- ---- 触发器:自动维护 updated_at ----------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---- repositories:GitHub 基础元数据 ------------------------------------
create table if not exists repositories (
  id                bigint primary key,            -- GitHub 数字 id(天然幂等)
  full_name         text not null unique,          -- owner/name
  owner             text not null,
  name              text not null,
  description       text,
  homepage          text,
  primary_language  text,
  stars             integer not null default 0,
  forks             integer not null default 0,
  open_issues       integer,
  topics            text[] not null default '{}',
  license           text,
  pushed_at         timestamptz,
  repo_created_at   timestamptz,
  readme_text       text,                          -- 仅候选填充(截断)
  readme_fetched_at timestamptz,
  is_archived       boolean not null default false,
  archived_reason   text,                          -- github_archived | readme_archived | null
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- 补列(幂等):对已存在的表添加新列
alter table repositories add column if not exists is_archived boolean not null default false;
alter table repositories add column if not exists archived_reason text;
create index if not exists idx_repositories_stars on repositories (stars desc);
create index if not exists idx_repositories_language on repositories (primary_language);
drop trigger if exists trg_repositories_updated on repositories;
create trigger trg_repositories_updated before update on repositories
  for each row execute function set_updated_at();

-- ---- harmony_signals:鸿蒙化自动信号(审核辅助,非最终判定)-------------
create table if not exists harmony_signals (
  repository_id     bigint primary key references repositories (id) on delete cascade,
  ohpm_matched      boolean not null default false,
  ohpm_packages     jsonb,                         -- [{pkg, repository}]
  has_oh_package    boolean not null default false, -- oh-package.json5(最关键)
  has_build_profile boolean not null default false,
  has_module_json5  boolean not null default false,
  has_hvigor        boolean not null default false,
  has_entry_dir     boolean not null default false,
  has_ets           boolean not null default false,
  in_registry       boolean not null default false,
  registry_source   text,                          -- tpc_resource | openharmony-sig | awesome
  source_repo_url   text,                          -- ohpm/registry 反查到的源码仓
  keyword_score     real not null default 0,
  auto_state_hint   harmony_state,                 -- 由信号推导的"暂定"状态(仅提示)
  signals           jsonb,                         -- 原始信号快照(审计)
  checked_at        timestamptz not null default now()
);

-- ---- analysis:LLM 分析产出(tier-1 粗分类 / tier-2 深评)---------------
create table if not exists analysis (
  id                  bigserial primary key,
  repository_id       bigint not null references repositories (id) on delete cascade,
  tier                smallint not null,           -- 1=classify 2=evaluate
  model               text not null,
  prompt_version      text not null,
  input_hash          text not null,               -- 幂等键
  category            repo_category,
  subcategory         text,                         -- LLM 给的细分类(自由文本)
  harmony_suggestion  harmony_state,               -- LLM 建议(非权威)
  mobile_relevance    real,
  feasibility         real,
  effort_estimate     real,                        -- 0 易 1 难
  ecosystem_gap       real,
  adaptation_points   jsonb,                        -- [{area, description, difficulty}]
  recommended_approach text,
  reasoning           text,
  confidence          real,
  tokens_in           integer,
  tokens_out          integer,
  created_at          timestamptz not null default now(),
  unique (repository_id, tier, prompt_version, model)
);
create index if not exists idx_analysis_repo on analysis (repository_id);
-- 兼容已存在的旧表:补列(幂等)
alter table analysis add column if not exists subcategory text;

-- ---- harmony_overrides:人工权威标记 ------------------------------------
create table if not exists harmony_overrides (
  repository_id  bigint primary key references repositories (id) on delete cascade,
  state          harmony_state not null,
  note           text,
  marked_by      text,                             -- 审核人邮箱
  marked_at      timestamptz not null default now()
);

-- ---- priority_rankings:适配优先级评分 ----------------------------------
create table if not exists priority_rankings (
  repository_id   bigint primary key references repositories (id) on delete cascade,
  priority_score  real not null default 0,          -- 0-100
  rank            integer,
  weights_version text not null,
  breakdown       jsonb,                             -- 各子分 + 权重(可解释)
  computed_at     timestamptz not null default now()
);
create index if not exists idx_priority_rank on priority_rankings (rank);

-- ---- trending_snapshots:每日热点快照 ------------------------------------
create table if not exists trending_snapshots (
  id               bigserial primary key,
  captured_date    date not null,
  source           text not null,                   -- ossinsight | github-trending
  repo_name        text not null,                   -- owner/name
  repository_id    bigint references repositories (id) on delete set null,
  primary_language text,
  description      text,
  stars            integer,
  forks            integer,
  total_score      real,
  rank             integer,
  captured_at      timestamptz not null default now(),
  unique (captured_date, source, repo_name)
);
create index if not exists idx_trending_date on trending_snapshots (captured_date desc);

-- ---- pipeline_runs:管道运行审计 + 断点续跑 -----------------------------
create table if not exists pipeline_runs (
  id          bigserial primary key,
  stage       text not null,
  status      text not null,                        -- running | success | failed
  stats       jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- ============================================================================
-- Row Level Security
--   业务表:公开只读(anon SELECT);写入仅 service_role(pipeline,自动绕过 RLS)
--   harmony_overrides:公开只读;写入仅 authenticated(请在 Supabase Auth
--     关闭公开注册,只保留你本人账户;前端另用 NEXT_PUBLIC_ADMIN_EMAIL 兜底)
-- ============================================================================

alter table repositories        enable row level security;
alter table harmony_signals     enable row level security;
alter table analysis            enable row level security;
alter table harmony_overrides   enable row level security;
alter table priority_rankings   enable row level security;
alter table trending_snapshots  enable row level security;
alter table pipeline_runs       enable row level security;

-- 公开只读
do $$
declare t text;
begin
  foreach t in array array[
    'repositories','harmony_signals','analysis','harmony_overrides',
    'priority_rankings','trending_snapshots'
  ] loop
    execute format('drop policy if exists "public_read" on %I;', t);
    execute format('create policy "public_read" on %I for select using (true);', t);
  end loop;
end $$;

-- 人工标记:仅登录用户可写(insert/update/delete)
drop policy if exists "admin_write_overrides" on harmony_overrides;
create policy "admin_write_overrides" on harmony_overrides
  for all
  to authenticated
  using (true)
  with check (true);

-- pipeline_runs 不公开(仅 service_role 读写,自动绕过 RLS);无策略即拒绝 anon。
