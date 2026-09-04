import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '@/lib/supabase/admin';

const REQUIRED_MIGRATION = 'supabase/migrations/20260904062704_support_and_opportunities.sql';
const SCHEMA_ERROR_CODES = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);

/** 通过管道实际使用的 Data API 校验迁移状态；不取业务数据，也不写库。 */
export async function assertAnalysisSchema(client: SupabaseClient = getAdminClient()): Promise<void> {
  const checks = [
    { table: 'analysis', columns: 'project_summary_cn,opportunity_verdict,opportunity_score,analysis_details' },
    { table: 'harmony_signals', columns: 'support_availability,support_provenance,support_coverage' },
    { table: 'repo_board', columns: 'project_summary_cn,opportunity_verdict,opportunity_score,analysis_details,support_availability' },
  ];
  for (const check of checks) {
    const { error } = await client.from(check.table).select(check.columns).limit(0);
    if (!error) continue;

    const advice = SCHEMA_ERROR_CODES.has(error.code)
      ? `请确认目标数据库已应用 ${REQUIRED_MIGRATION}；若字段已存在，请刷新 PostgREST schema cache。`
      : '请检查 Supabase 连接、凭据和权限；此错误不一定是缺少迁移。';
    throw new Error(
      `数据库结构预检查失败：${check.table}(${check.columns}) [${error.code || 'unknown'}] ${error.message}。${advice}`,
    );
  }
}
