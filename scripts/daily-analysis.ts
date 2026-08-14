// 每日分层分析总控：广覆盖初筛 → 高价值深评 → 代码级深析。
// 候选由持久分析池选择，已完成项目不会再占住批次名额；积压清空后自然只处理热点/变更项目。
import 'dotenv/config';
import { getAdminClient } from '@/lib/supabase/admin';
import {
  refreshAnalysisQueue,
  selectPreliminaryCandidates,
  selectTier2Candidates,
  selectTier3Candidates,
  TIER3_MIN_SCORE,
} from '@/lib/pipeline/candidates';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import {
  getPipelineSessionId,
  log,
  today,
  todayStartIso,
  writeSessionEvent,
  type StageOpts,
} from '@/scripts/_common';
import { runFetchTop } from '@/scripts/01-fetch-top';
import { runEnrich } from '@/scripts/02-enrich';
import { runHarmonySignals } from '@/scripts/03-harmony-signals';
import { runFetchReadme } from '@/scripts/04-fetch-readme';
import { runLlmClassify } from '@/scripts/05-llm-classify';
import { runLlmEvaluate } from '@/scripts/06-llm-evaluate';
import { runScore } from '@/scripts/07-score';
import { runDeepwiki } from '@/scripts/09-deepwiki';
import { runDeepwikiDeep } from '@/scripts/10-deepwiki-deep';
import { runWeeklyTrending } from '@/scripts/weekly-trending';

const DEFAULT_PRELIMINARY_LIMIT = 400;
const DEFAULT_DEEP_LIMIT = 100;
const DEFAULT_TIER3_LIMIT = 20;

async function countRows(
  table: string,
  apply?: (query: any) => any,
): Promise<number> {
  const client = getAdminClient();
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(`统计 ${table} 失败:${error.message}`);
  return count ?? 0;
}

async function countAnalyzedReposToday(tier: 1 | 2 | 3, start: string): Promise<number> {
  const client = getAdminClient();
  const ids = new Set<number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('analysis')
      .select('repository_id')
      .eq('tier', tier)
      .gte('analyzed_at', start)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`统计 tier-${tier} 每日项目失败:${error.message}`);
    const rows = (data ?? []) as { repository_id: number }[];
    rows.forEach((row) => ids.add(row.repository_id));
    if (rows.length < pageSize) return ids.size;
  }
}

export async function writeDailyMetrics(failedCountOverride?: number): Promise<Record<string, number>> {
  const client = getAdminClient();
  const date = today();
  const start = todayStartIso();
  const failedCountPromise = failedCountOverride == null
    ? countRows('pipeline_runs', (query) => query.eq('status', 'failed').gte('started_at', start))
    : Promise.resolve(failedCountOverride);
  const [
    total,
    discoveredToday,
    preliminaryToday,
    deepToday,
    tier3Today,
    trendingCollected,
    trendingPromoted,
    preliminaryBacklog,
    deepBacklog,
    tier3Backlog,
    failedCount,
  ] = await Promise.all([
    countRows('repositories'),
    countRows('repositories', (query) => query.gte('first_seen_at', start)),
    countAnalyzedReposToday(1, start),
    countAnalyzedReposToday(2, start),
    countAnalyzedReposToday(3, start),
    countRows('trending_snapshots', (query) => query.eq('captured_date', date)),
    countRows('trending_snapshots', (query) => query.eq('captured_date', date).eq('promoted', true)),
    countRows('analysis_queue', (query) => query.eq('state', 'discovered')),
    countRows('analysis_queue', (query) => query.eq('state', 'preliminary')),
    countRows('analysis_queue', (query) => query.eq('state', 'deep').gte('deep_score', TIER3_MIN_SCORE)),
    failedCountPromise,
  ]);
  const metrics = {
    repositories_total: total,
    discovered_today: discoveredToday,
    preliminary_today: preliminaryToday,
    deep_today: deepToday,
    tier3_today: tier3Today,
    trending_collected: trendingCollected,
    trending_promoted: trendingPromoted,
    preliminary_backlog: preliminaryBacklog,
    deep_backlog: deepBacklog,
    tier3_backlog: tier3Backlog,
    failed_count: failedCount,
  };
  const { error } = await client.from('pipeline_daily_metrics').upsert(
    {
      metric_date: date,
      ...metrics,
      stats: { generated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'metric_date' },
  );
  if (error) throw new Error(`写入每日指标失败:${error.message}`);
  return metrics;
}

export async function runDailyAnalysis(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('daily-analysis');
  const preliminaryLimit = opts.preliminaryLimit ?? opts.limit ?? DEFAULT_PRELIMINARY_LIMIT;
  const deepLimit = opts.deepLimit ?? DEFAULT_DEEP_LIMIT;
  const tier3Limit = opts.tier3Limit ?? DEFAULT_TIER3_LIMIT;
  try {
    const sessionId = getPipelineSessionId();
    log(`每日分层分析预算:初筛 ${preliminaryLimit}、深评 ${deepLimit}、代码深析 ${tier3Limit}`);
    log(`执行 session:${sessionId}`);
    writeSessionEvent({
      type: 'daily_budget',
      preliminary_limit: preliminaryLimit,
      deep_limit: deepLimit,
      tier3_limit: tier3Limit,
    });

    // 发现层：高星基线保证覆盖，多源热点补充快速增长和新项目。
    await runFetchTop();
    await runWeeklyTrending();
    let pool = await refreshAnalysisQueue();
    log(`候选池:待初筛 ${pool.discovered}、待深评 ${pool.preliminary}、已深评待深析 ${pool.deep}、热点 ${pool.hot}`);

    // tier-1：先选择未分析项目，再做昂贵取数，避免全库重复扫描。
    const preliminaryIds = await selectPreliminaryCandidates(preliminaryLimit);
    writeSessionEvent({ type: 'candidate_batch', tier: 1, repository_ids: preliminaryIds });
    if (preliminaryIds.length) {
      log(`初筛批次 ${preliminaryIds.length} 个`);
      await runEnrich({ ids: preliminaryIds });
      await runDeepwiki({ ids: preliminaryIds, evidenceLimit: preliminaryIds.length });
      await runFetchReadme({ ids: preliminaryIds });
      await runHarmonySignals({ ids: preliminaryIds });
      await runLlmClassify({ ids: preliminaryIds });
    }

    // tier-2：用 tier-1 的端侧价值/可行性和热点证据选高价值项目。
    pool = await refreshAnalysisQueue();
    const deepIds = await selectTier2Candidates(deepLimit);
    writeSessionEvent({ type: 'candidate_batch', tier: 2, repository_ids: deepIds });
    if (deepIds.length) {
      log(`高价值深评批次 ${deepIds.length} 个`);
      await runDeepwiki({ ids: deepIds, evidenceLimit: deepIds.length });
      await runLlmEvaluate({ ids: deepIds });
    }

    // tier-3：只对综合分过线的项目逐子系统问代码，输出可执行鸿蒙契合路径。
    pool = await refreshAnalysisQueue();
    const tier3Ids = await selectTier3Candidates(tier3Limit * 2);
    writeSessionEvent({ type: 'candidate_batch', tier: 3, repository_ids: tier3Ids });
    if (tier3Ids.length) {
      log(`代码级深析目标 ${tier3Limit} 个，后备候选 ${tier3Ids.length} 个`);
      await runDeepwikiDeep({ ids: tier3Ids, limit: tier3Limit });
    }

    await refreshAnalysisQueue();
    await runScore();
    const metrics = await writeDailyMetrics(0);
    await finishRun(runId, 'success', {
      ...metrics,
      session_id: sessionId,
      preliminary_budget: preliminaryLimit,
      deep_budget: deepLimit,
      tier3_budget: tier3Limit,
    });
    log(`每日分层分析完成:${JSON.stringify(metrics)}`);
  } catch (error) {
    try {
      await writeDailyMetrics(1);
    } catch (metricError) {
      log(`失败后写每日指标也失败:${String(metricError).slice(0, 160)}`);
    }
    await finishRun(runId, 'failed', { error: String(error) });
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyAnalysis().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
