// 管道运行审计:写 pipeline_runs 表。
import { getAdminClient } from '@/lib/supabase/admin';

export async function startRun(stage: string): Promise<number | null> {
  const client = getAdminClient();
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
