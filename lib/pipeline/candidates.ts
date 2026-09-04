import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { PROMPT_VERSION } from '@/lib/llm/prompts';
import { DEEP_PROMPT_VERSION, TARBALL_PROMPT_VERSION } from '@/lib/llm/deep-evaluate';
import { CLASSIFY_MODEL_NAME, EVALUATE_MODEL_NAME } from '@/lib/llm/provider';

const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;
const REANALYSIS_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const TIER3_MIN_SCORE = 0.62;

interface RepoCandidate {
  id: number;
  stars: number;
  pushed_at: string | null;
  first_seen_at: string;
  is_archived: boolean;
}

interface AnalysisCandidate {
  repository_id: number;
  tier: number;
  mobile_relevance: number | null;
  feasibility: number | null;
  ecosystem_gap: number | null;
  harmony_leverage: number | null;
  confidence: number | null;
  opportunity_score: number | null;
  opportunity_verdict: string | null;
  prompt_version: string;
  model: string;
  created_at: string;
  analyzed_at: string | null;
}

interface TrendingEvidence {
  hotScore: number;
  sourceCount: number;
  weeks: number;
}

export interface CandidatePoolStats {
  total: number;
  discovered: number;
  preliminary: number;
  deep: number;
  monitoring: number;
  excluded: number;
  hot: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function popularity(stars: number): number {
  const floor = Math.log10(200);
  const ceiling = Math.log10(300_000);
  return clamp01((Math.log10(Math.max(stars, 1)) - floor) / (ceiling - floor));
}

function recency(pushedAt: string | null): number {
  if (!pushedAt) return 0;
  const ageDays = Math.max(0, (Date.now() - new Date(pushedAt).getTime()) / DAY_MS);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.8;
  if (ageDays <= 90) return 0.55;
  if (ageDays <= 365) return 0.25;
  return 0;
}

export interface CandidateScoreInput {
  stars: number;
  pushedAt: string | null;
  hotScore: number;
  sourceCount: number;
  mobileRelevance?: number | null;
  feasibility?: number | null;
  ecosystemGap?: number | null;
  harmonyLeverage?: number | null;
  confidence?: number | null;
  /** 0-100，来自项目最佳可信结合机会；tier-1 为低成本初筛分。 */
  opportunityScore?: number | null;
}

export function deriveCandidateScores(input: CandidateScoreInput): {
  discoveryScore: number;
  preliminaryScore: number;
  deepScore: number;
} {
  const pop = popularity(input.stars);
  const active = recency(input.pushedAt);
  const mobile = clamp01(input.mobileRelevance ?? 0.4);
  const feasible = clamp01(input.feasibility ?? 0.5);
  const gap = clamp01(input.ecosystemGap ?? 0.5);
  const leverage = clamp01(input.harmonyLeverage ?? 0.3);
  const confidence = clamp01(input.confidence ?? 0.5);
  const opportunity = input.opportunityScore == null
    ? clamp01(0.55 * leverage + 0.25 * mobile + 0.2 * gap)
    : clamp01(input.opportunityScore / 100);
  return {
    discoveryScore: clamp01(0.5 * input.hotScore + 0.2 * pop + 0.2 * active + 0.1 * (input.sourceCount > 1 ? 1 : 0)),
    preliminaryScore: clamp01(
      0.5 * opportunity + 0.15 * input.hotScore + 0.1 * feasible + 0.15 * pop + 0.1 * confidence,
    ),
    // tier-3 看“鸿蒙专属增量”而不是“容易适配”。纯平台无关工具即使可行性很高，
    // 没有 ArkUI / Node-API / 平台后端 / 多设备等专属交付面也不能占据深析名额。
    deepScore: clamp01(
      0.08 * input.hotScore +
        0.08 * mobile +
        0.08 * feasible +
        0.08 * gap +
        0.08 * leverage +
        0.55 * opportunity +
        0.05 * confidence,
    ),
  };
}

export type CandidateState = 'discovered' | 'preliminary' | 'deep' | 'monitoring' | 'excluded';

export function deriveCandidateState(input: {
  archived: boolean;
  tier: number;
  changedAfterAnalysis: boolean;
  hot: boolean;
}): CandidateState {
  if (input.archived) return 'excluded';
  if (input.changedAfterAnalysis && input.hot) {
    return input.tier >= 3 ? 'deep' : input.tier >= 2 ? 'preliminary' : 'discovered';
  }
  return input.tier >= 3 ? 'monitoring' : input.tier >= 2 ? 'deep' : input.tier >= 1 ? 'preliminary' : 'discovered';
}

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadTrendingEvidence(): Promise<Map<number, TrendingEvidence>> {
  const client = getAdminClient();
  const since = new Date(Date.now() - 14 * DAY_MS).toISOString().slice(0, 10);
  const rows = await pageAll<{
    repository_id: number | null;
    total_score: number | null;
    source_count: number | null;
    weeks_on_trending: number | null;
  }>((from, to) =>
    client
      .from('trending_snapshots')
      .select('repository_id,total_score,source_count,weeks_on_trending')
      .gte('captured_date', since)
      .eq('promoted', true)
      .eq('metric_version', 'multi-source-v2')
      .range(from, to),
  );

  const maxScore = Math.max(0, ...rows.map((row) => row.total_score ?? 0));
  const result = new Map<number, TrendingEvidence>();
  for (const row of rows) {
    if (row.repository_id == null) continue;
    const current = result.get(row.repository_id) ?? { hotScore: 0, sourceCount: 0, weeks: 0 };
    result.set(row.repository_id, {
      hotScore: Math.max(current.hotScore, maxScore > 0 ? (row.total_score ?? 0) / maxScore : 0),
      sourceCount: Math.max(current.sourceCount, row.source_count ?? 1),
      weeks: Math.max(current.weeks, row.weeks_on_trending ?? 1),
    });
  }
  return result;
}

/**
 * 用仓库、分析和热点事实重建候选池的派生字段。
 * first_seen_at 来自 repositories，重复运行不会重置候选年龄。
 */
export async function refreshAnalysisQueue(): Promise<CandidatePoolStats> {
  const client = getAdminClient();
  const [repos, analyses, trending] = await Promise.all([
    pageAll<RepoCandidate>((from, to) =>
      client
        .from('repositories')
        .select('id,stars,pushed_at,first_seen_at,is_archived')
        .order('id')
        .range(from, to),
    ),
    pageAll<AnalysisCandidate>((from, to) =>
      client
        .from('analysis')
        .select('repository_id,tier,model,prompt_version,mobile_relevance,feasibility,ecosystem_gap,harmony_leverage,confidence,opportunity_score,opportunity_verdict,created_at,analyzed_at')
        .order('analyzed_at', { ascending: false })
        .range(from, to),
    ),
    loadTrendingEvidence(),
  ]);

  const best = new Map<number, AnalysisCandidate>();
  const bestCurrent = new Map<number, AnalysisCandidate>();
  const tierDates = new Map<number, Partial<Record<1 | 2 | 3, string>>>();
  const currentTiers = new Map<number, Set<1 | 2 | 3>>();
  for (const row of analyses) {
    const tier = row.tier as 1 | 2 | 3;
    const dates = tierDates.get(row.repository_id) ?? {};
    if (!dates[tier]) dates[tier] = row.analyzed_at ?? row.created_at;
    tierDates.set(row.repository_id, dates);
    const current = best.get(row.repository_id);
    if (!current || row.tier > current.tier) best.set(row.repository_id, row);
    const isCurrent =
      (tier === 1 && row.prompt_version === PROMPT_VERSION && row.model === CLASSIFY_MODEL_NAME) ||
      (tier === 2 && row.prompt_version === PROMPT_VERSION && row.model === EVALUATE_MODEL_NAME) ||
      (tier === 3 &&
        ((row.prompt_version === DEEP_PROMPT_VERSION && row.model === EVALUATE_MODEL_NAME) ||
          row.prompt_version === TARBALL_PROMPT_VERSION));
    if (isCurrent) {
      const tiers = currentTiers.get(row.repository_id) ?? new Set<1 | 2 | 3>();
      tiers.add(tier);
      currentTiers.set(row.repository_id, tiers);
      const currentBest = bestCurrent.get(row.repository_id);
      if (!currentBest || row.tier > currentBest.tier) bestCurrent.set(row.repository_id, row);
    }
  }

  const stats: CandidatePoolStats = {
    total: repos.length,
    discovered: 0,
    preliminary: 0,
    deep: 0,
    monitoring: 0,
    excluded: 0,
    hot: 0,
  };
  const rows = repos.map((repo) => {
    const analysis = bestCurrent.get(repo.id) ?? best.get(repo.id);
    const trend = trending.get(repo.id) ?? { hotScore: 0, sourceCount: 0, weeks: 0 };
    const pop = popularity(repo.stars);
    const active = recency(repo.pushed_at);
    const mobile = clamp01(analysis?.mobile_relevance ?? 0.4);
    const feasible = clamp01(analysis?.feasibility ?? 0.5);
    const gap = clamp01(analysis?.ecosystem_gap ?? 0.5);
    const leverage = clamp01(analysis?.harmony_leverage ?? 0.3);
    const confidence = clamp01(analysis?.confidence ?? 0.5);
    const { discoveryScore, preliminaryScore, deepScore } = deriveCandidateScores({
      stars: repo.stars,
      pushedAt: repo.pushed_at,
      hotScore: trend.hotScore,
      sourceCount: trend.sourceCount,
      mobileRelevance: mobile,
      feasibility: feasible,
      ecosystemGap: gap,
      harmonyLeverage: leverage,
      confidence,
      opportunityScore: analysis?.opportunity_score,
    });
    const lastAnalyzedAt = analysis ? new Date(analysis.analyzed_at ?? analysis.created_at).getTime() : 0;
    const changedAfterAnalysis =
      repo.pushed_at != null &&
      new Date(repo.pushed_at).getTime() > lastAnalyzedAt &&
      Date.now() - lastAnalyzedAt >= REANALYSIS_COOLDOWN_MS;
    const validTiers = currentTiers.get(repo.id) ?? new Set<1 | 2 | 3>();
    // 旧 prompt 结果可作参考分，但不能直接跨过当前版本的质量门槛。
    const tier = validTiers.has(3) ? 3 : validTiers.has(2) ? 2 : validTiers.has(1) ? 1 : 0;
    // 积压清空后，只让“仍在热点且代码有变化”的旧项目重新进入对应分析层。
    const state = deriveCandidateState({
      archived: repo.is_archived,
      tier,
      changedAfterAnalysis,
      hot: trend.hotScore > 0,
    });
    stats[state]++;
    if (trend.hotScore > 0) stats.hot++;

    const reasons: string[] = [];
    if (trend.hotScore > 0) reasons.push(`近14天热点 ${trend.hotScore.toFixed(2)}`);
    if (trend.sourceCount > 1) reasons.push(`${trend.sourceCount} 个热点源交叉命中`);
    if (trend.weeks > 1) reasons.push(`连续/累计 ${trend.weeks} 周上榜`);
    if (mobile >= 0.7) reasons.push(`鸿蒙端侧相关度 ${mobile.toFixed(2)}`);
    if (gap >= 0.7) reasons.push(`鸿蒙生态缺口 ${gap.toFixed(2)}`);
    if (leverage >= 0.7) reasons.push(`鸿蒙专属增量 ${leverage.toFixed(2)}`);
    if ((analysis?.opportunity_score ?? 0) >= 65) reasons.push(`高价值结合机会 ${analysis?.opportunity_score?.toFixed(1)}`);
    if (active >= 0.8) reasons.push('近30天活跃');
    if (pop >= 0.75) reasons.push('高影响力项目');

    const dates = tierDates.get(repo.id) ?? {};
    return {
      repository_id: repo.id,
      sources: trend.hotScore > 0 ? ['baseline', 'trending'] : ['baseline'],
      state,
      discovery_score: discoveryScore,
      preliminary_score: analysis ? preliminaryScore : null,
      deep_score: analysis && analysis.tier >= 2 ? deepScore : null,
      hot_score: trend.hotScore,
      source_count: trend.sourceCount,
      trending_weeks: trend.weeks,
      reasons,
      first_seen_at: repo.first_seen_at,
      last_seen_at: new Date().toISOString(),
      preliminary_analyzed_at: dates[1] ?? null,
      deep_analyzed_at: dates[2] ?? null,
      tier3_analyzed_at: dates[3] ?? null,
    };
  });

  await upsertBatched('analysis_queue', rows, { onConflict: 'repository_id' });
  return stats;
}

async function selectIds(
  state: 'discovered' | 'preliminary' | 'deep',
  scoreColumn: 'discovery_score' | 'preliminary_score' | 'deep_score',
  limit: number,
  minScore?: number,
): Promise<number[]> {
  const client = getAdminClient();
  let query = client
    .from('analysis_queue')
    .select('repository_id')
    .eq('state', state)
    .or(`next_analysis_at.is.null,next_analysis_at.lte.${new Date().toISOString()}`)
    .order(scoreColumn, { ascending: false, nullsFirst: false })
    .order('hot_score', { ascending: false })
    .limit(limit);
  if (minScore != null) query = query.gte(scoreColumn, minScore);
  const { data, error } = await query;
  if (error) throw new Error(`选择 ${state} 候选失败:${error.message}`);
  return ((data ?? []) as { repository_id: number }[]).map((row) => row.repository_id);
}

export const selectPreliminaryCandidates = (limit: number): Promise<number[]> =>
  selectIds('discovered', 'discovery_score', limit);

export const selectTier2Candidates = (limit: number): Promise<number[]> =>
  selectIds('preliminary', 'preliminary_score', limit);

export const selectTier3Candidates = (limit: number): Promise<number[]> =>
  selectIds('deep', 'deep_score', limit, TIER3_MIN_SCORE);
