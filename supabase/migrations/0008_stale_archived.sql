-- ============================================================================
-- 扩展归档原因 + 新增 latest_release_at 列
-- ============================================================================

-- 1. 新增 latest_release_at 列(从 GraphQL releases 获取)
alter table repositories add column if not exists latest_release_at timestamptz;
create index if not exists idx_repos_latest_release on repositories (latest_release_at) where latest_release_at is not null;

-- 2. 更新列注释
comment on column repositories.archived_reason is 'github_archived | readme_archived | deprecated_notice | no_recent_release | stale_repository | null';
comment on column repositories.latest_release_at is '最后一次 Release 的发布时间(来自 GitHub GraphQL)';
