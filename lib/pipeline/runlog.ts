// 管道运行审计:写 pipeline_runs 表。
import { getAdminClient } from '@/lib/supabase/admin';

const STALE_RUN_HOURS = 12;

async function expireStaleRuns(): Promise<void> {
  const client = getAdminClient();
  const cutoff = new Date(Date.now() - STALE_RUN_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await client
    .from('pipeline_runs')
    .update({
      status: 'abandoned',
      stats: { reason: `超过 ${STALE_RUN_HOURS} 小时未结束，自动失效` },
      finished_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('started_at', cutoff);
  if (error) console.warn(`[runlog] 清理过期运行记录失败:${error.message}`);
}

export async function startRun(stage: string): Promise<number | null> {
  const client = getAdminClient();
  await expireStaleRuns();
  const { data, error } = await client
    .from('pipeline_runs')
    .insert({ stage, status: 'running' })
    .select('id')
    .single();
  if (error) {
    console.warn(`[runlog] 记录启动失败:${error.message}`);
    return null;
  }
  return (data as { id: number }).id;
}

export async function finishRun(
  id: number | null,
  status: 'success' | 'failed',
  stats?: Record<string, unknown>,
): Promise<void> {
  if (id == null) return;
  const client = getAdminClient();
  const { error } = await client
    .from('pipeline_runs')
    .update({ status, stats: stats ?? null, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.warn(`[runlog] 记录结束失败:${error.message}`);
}
