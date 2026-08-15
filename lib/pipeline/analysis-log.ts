import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { sanitizePostgresJson } from '@/lib/supabase/json-safety';
import { getPipelineSessionId, writeSessionEvent } from '@/lib/pipeline/session';
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { DeepwikiFacts } from '@/lib/deepwiki';

export interface ModelTrace {
  started_at: string;
  finished_at: string;
  duration_ms: number;
  system_prompt: string;
  user_prompt: string;
}

export interface AnalysisExecutionInput {
  pipelineRunId: number | null;
  repositoryId: number;
  repositoryName: string;
  tier: 1 | 2 | 3;
  status: 'success' | 'failed' | 'skipped';
  model: string;
  promptVersion: string;
  inputHash?: string | null;
  trace?: ModelTrace | null;
  evidence?: Record<string, unknown>;
  output?: unknown;
  error?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  startedAt?: string;
}

export type AnalysisExecutionRow = Record<string, unknown>;

/** 记录决定模型判断质量的证据覆盖，不复制体积很大的 DeepWiki 原文。 */
export function buildEvidenceSnapshot(
  signals: CollectedSignals,
  facts: DeepwikiFacts | null | undefined,
  readme: string | null,
): Record<string, unknown> {
  return {
    readme_chars: readme?.length ?? 0,
    harmony_signals: {
      ohpm_matched: signals.ohpm_matched,
      has_harmony_project: Boolean(
        signals.has_oh_package ||
          signals.has_build_profile ||
          signals.has_module_json5 ||
          signals.has_hvigor ||
          signals.has_entry_dir
      ),
      has_ets: signals.has_ets,
      in_registry: signals.in_registry,
      gitcode_matched: signals.gitcode_matched,
      keyword_score: signals.keyword_score,
    },
    deepwiki: {
      indexed: facts?.indexed ?? false,
      scope: facts?.harmony?.harmony_scope ?? null,
      toc_chars: facts?.wiki_toc?.length ?? 0,
      harmony_path_count: facts?.harmony?.harmony_paths.length ?? 0,
      platform_layer_count: facts?.porting?.platform_layer_paths.length ?? 0,
      blocker_count: facts?.porting?.blocking_deps.length ?? 0,
      subsystem_count: Object.keys(facts?.extra ?? {}).length,
    },
  };
}

/** 构造数据库审计行，同时实时写本地 JSONL，避免批量入库前进程退出导致完全丢失。 */
export function captureAnalysisExecution(input: AnalysisExecutionInput): AnalysisExecutionRow {
  const finishedAt = input.trace?.finished_at ?? new Date().toISOString();
  const startedAt = input.trace?.started_at ?? input.startedAt ?? finishedAt;
  const durationMs = input.trace?.duration_ms ?? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const row: AnalysisExecutionRow = {
    session_id: getPipelineSessionId(),
    pipeline_run_id: input.pipelineRunId,
    repository_id: input.repositoryId,
    tier: input.tier,
    status: input.status,
    model: input.model,
    prompt_version: input.promptVersion,
    input_hash: input.inputHash ?? null,
    system_prompt: input.trace?.system_prompt ?? null,
    user_prompt: input.trace?.user_prompt ?? null,
    evidence: input.evidence ?? {},
    output: input.output ?? null,
    error: input.error ?? null,
    tokens_in: input.tokensIn ?? null,
    tokens_out: input.tokensOut ?? null,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
  };
  writeSessionEvent({
    type: 'analysis_execution',
    repository_id: input.repositoryId,
    repository: input.repositoryName,
    tier: input.tier,
    status: input.status,
    model: input.model,
    prompt_version: input.promptVersion,
    input_hash: input.inputHash ?? null,
    duration_ms: durationMs,
    tokens_in: input.tokensIn ?? null,
    tokens_out: input.tokensOut ?? null,
    system_prompt: input.trace?.system_prompt ?? null,
    user_prompt: input.trace?.user_prompt ?? null,
    evidence: input.evidence ?? {},
    output: input.output ?? null,
    error: input.error ?? null,
  });
  return row;
}

export async function flushAnalysisExecutionLogs(rows: AnalysisExecutionRow[]): Promise<void> {
  const safeRows = rows.map((row) => sanitizePostgresJson(row));
  await upsertBatched('analysis_execution_logs', safeRows, { chunkSize: 100 });
}

export async function countSessionExecutions(sessionId = getPipelineSessionId()): Promise<number> {
  const { count, error } = await getAdminClient()
    .from('analysis_execution_logs')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw new Error(`统计 session 执行日志失败:${error.message}`);
  return count ?? 0;
}
