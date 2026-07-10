-- ============================================================================
-- 允许管理员(authenticated)查看 pipeline_runs 运行记录
-- ============================================================================

drop policy if exists "authenticated_read" on pipeline_runs;
create policy "authenticated_read" on pipeline_runs
  for select to authenticated
  using (true);
