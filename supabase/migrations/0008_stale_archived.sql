-- ============================================================================
-- 支持将超过 2 年未更新的仓库标记为归档
-- archived_reason 新增 'stale_repository' 值
-- ============================================================================

comment on column repositories.archived_reason is 'github_archived | readme_archived | stale_repository | null';
