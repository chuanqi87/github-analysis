-- ============================================================================
-- 归档规则调整:移除 no_recent_release,统一以最近一次 commit(pushed_at)
-- 超过 3 年作为 stale_repository 判断依据。
-- 说明:很多项目不发布 Release 却持续 commit,按 release 发布时间判断会误归档。
-- 列 archived_reason 为 text,无 check 约束,仅需更新注释;
-- 旧的 no_recent_release 数据由 mark-archived 阶段重算覆盖。
-- ============================================================================

comment on column repositories.archived_reason is 'github_archived | readme_archived | deprecated_notice | stale_repository | null';
