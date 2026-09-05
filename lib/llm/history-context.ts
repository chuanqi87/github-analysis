import { getAdminClient } from '@/lib/supabase/admin';
import { stableHash } from '@/lib/hash';
import type { AdaptationPoint, AnalysisDetails, OpportunityVerdict } from '@/lib/types';

export interface HistoryTarget {
  id: number;
  owner: string;
  full_name: string;
  primary_language: string | null;
  topics: string[];
}

export interface HistoricalAnalysisReference {
  repository_id: number;
  full_name: string;
  owner: string;
  primary_language: string | null;
  topics: string[];
  tier: number;
  model: string;
  prompt_version: string;
  category: string | null;
  subcategory: string | null;
  project_summary_cn: string | null;
  opportunity_verdict: OpportunityVerdict | null;
  opportunity_score: number | null;
  opportunities: AdaptationPoint[];
  recommended_approach: string | null;
  reasoning_excerpt: string | null;
  decision: AnalysisDetails['decision'] | null;
  analyzed_at: string | null;
}

interface RepoMetadata {
  id: number;
  owner: string;
  full_name: string;
  primary_language: string | null;
  topics: string[] | null;
  stars: number;
}

interface AnalysisHistoryRow {
  repository_id: number;
  tier: number;
  model: string;
  prompt_version: string;
  category: string | null;
  subcategory: string | null;
  project_summary_cn: string | null;
  opportunity_verdict: OpportunityVerdict | null;
  opportunity_score: number | null;
  adaptation_points: AdaptationPoint[] | null;
  recommended_approach: string | null;
  reasoning: string | null;
  analysis_details: AnalysisDetails | null;
  analyzed_at: string | null;
  created_at: string;
}

const MAX_REFERENCES = 6;
const MAX_REPOSITORY_CANDIDATES = 1200;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function topicSimilarity(left: string[], right: string[]): number {
  const a = new Set(left.map((item) => item.toLowerCase()));
  const b = new Set(right.map((item) => item.toLowerCase()));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const topic of a) if (b.has(topic)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

function relationScore(target: HistoryTarget, candidate: HistoricalAnalysisReference): number {
  const sameOwner = target.owner.toLowerCase() === candidate.owner.toLowerCase();
  const sameLanguage = Boolean(
    target.primary_language && candidate.primary_language === target.primary_language,
  );
  const topicScore = topicSimilarity(target.topics, candidate.topics);
  return (
    (sameOwner ? 8 : 0) +
    (sameLanguage ? 1.5 : 0) +
    topicScore * 6 +
    (candidate.tier >= 3 ? 1.5 : 0) +
    Math.min(1, (candidate.opportunity_score ?? 0) / 100)
  );
}

/**
 * 历史结论只作为可验证先验。优先同组织，其次选择语言与 topics 真正相似的项目；
 * 单纯“同为 TypeScript”不构成可复用关系。
 */
export function selectHistoricalReferences(
  target: HistoryTarget,
  candidates: HistoricalAnalysisReference[],
  limit = MAX_REFERENCES,
): HistoricalAnalysisReference[] {
  return candidates
    .filter((candidate) => candidate.repository_id !== target.id)
    .map((candidate) => ({
      candidate,
      sameOwner: target.owner.toLowerCase() === candidate.owner.toLowerCase(),
      sameLanguage: Boolean(target.primary_language && candidate.primary_language === target.primary_language),
      topics: topicSimilarity(target.topics, candidate.topics),
      score: relationScore(target, candidate),
    }))
    .filter(({ sameOwner, sameLanguage, topics }) => (sameOwner && (sameLanguage || topics > 0)) || topics >= 0.2)
    .sort((a, b) => b.score - a.score || b.candidate.tier - a.candidate.tier || a.candidate.full_name.localeCompare(b.candidate.full_name))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function preferAnalysis(next: AnalysisHistoryRow, current?: AnalysisHistoryRow): boolean {
  if (!current) return true;
  if (next.tier !== current.tier) return next.tier > current.tier;
  const nextTime = next.analyzed_at ?? next.created_at;
  const currentTime = current.analyzed_at ?? current.created_at;
  return nextTime > currentTime;
}

async function loadRelatedRepositories(targets: HistoryTarget[]): Promise<RepoMetadata[]> {
  const client = getAdminClient();
  const byId = new Map<number, RepoMetadata>();
  const owners = [...new Set(targets.map((target) => target.owner).filter(Boolean))];
  const languages = [...new Set(targets.map((target) => target.primary_language).filter((v): v is string => Boolean(v)))];

  for (const ownerChunk of chunks(owners, 30)) {
    const { data, error } = await client
      .from('repositories')
      .select('id,owner,full_name,primary_language,topics,stars')
      .in('owner', ownerChunk)
      .order('stars', { ascending: false })
      .limit(MAX_REPOSITORY_CANDIDATES);
    if (error) throw new Error(`加载同组织历史仓库失败:${error.message}`);
    for (const row of (data ?? []) as RepoMetadata[]) byId.set(row.id, row);
  }

  for (const languageChunk of chunks(languages, 12)) {
    const { data, error } = await client
      .from('repositories')
      .select('id,owner,full_name,primary_language,topics,stars')
      .in('primary_language', languageChunk)
      .order('stars', { ascending: false })
      .limit(MAX_REPOSITORY_CANDIDATES);
    if (error) throw new Error(`加载相似技术栈历史仓库失败:${error.message}`);
    for (const row of (data ?? []) as RepoMetadata[]) byId.set(row.id, row);
  }

  return [...byId.values()];
}

async function loadBestAnalyses(repositoryIds: number[]): Promise<Map<number, AnalysisHistoryRow>> {
  const client = getAdminClient();
  const best = new Map<number, AnalysisHistoryRow>();
  for (const idChunk of chunks(repositoryIds, 500)) {
    const { data, error } = await client
      .from('analysis')
      .select('repository_id,tier,model,prompt_version,category,subcategory,project_summary_cn,opportunity_verdict,opportunity_score,adaptation_points,recommended_approach,reasoning,analysis_details,analyzed_at,created_at')
      .in('repository_id', idChunk)
      .in('tier', [2, 3]);
    if (error) throw new Error(`加载历史深度分析失败:${error.message}`);
    for (const row of (data ?? []) as AnalysisHistoryRow[]) {
      if (preferAnalysis(row, best.get(row.repository_id))) best.set(row.repository_id, row);
    }
  }
  return best;
}

export async function loadHistoricalAnalysisContexts(
  targets: HistoryTarget[],
): Promise<Map<number, HistoricalAnalysisReference[]>> {
  const result = new Map<number, HistoricalAnalysisReference[]>();
  if (!targets.length) return result;
  const repositories = await loadRelatedRepositories(targets);
  const analyses = await loadBestAnalyses(repositories.map((repo) => repo.id));
  const references: HistoricalAnalysisReference[] = [];

  for (const repo of repositories) {
    const analysis = analyses.get(repo.id);
    if (!analysis) continue;
    references.push({
      repository_id: repo.id,
      full_name: repo.full_name,
      owner: repo.owner,
      primary_language: repo.primary_language,
      topics: repo.topics ?? [],
      tier: analysis.tier,
      model: analysis.model,
      prompt_version: analysis.prompt_version,
      category: analysis.category,
      subcategory: analysis.subcategory,
      project_summary_cn: analysis.project_summary_cn,
      opportunity_verdict: analysis.opportunity_verdict,
      opportunity_score: analysis.opportunity_score,
      opportunities: (analysis.adaptation_points ?? []).slice(0, 3),
      recommended_approach: analysis.recommended_approach,
      reasoning_excerpt: analysis.reasoning?.slice(0, 800) ?? null,
      decision: analysis.analysis_details?.decision ?? null,
      analyzed_at: analysis.analyzed_at,
    });
  }

  for (const target of targets) result.set(target.id, selectHistoricalReferences(target, references));
  return result;
}

export function historicalContextFingerprint(context?: HistoricalAnalysisReference[] | null): string | null {
  if (!context?.length) return null;
  return stableHash(context.map((item) => ({
    repo: item.full_name,
    tier: item.tier,
    version: item.prompt_version,
    model: item.model,
    language: item.primary_language,
    topics: [...item.topics].sort(),
    summary: item.project_summary_cn,
    verdict: item.opportunity_verdict,
    opportunities: item.opportunities.map((opportunity) => ({
      area: opportunity.area,
      integration_form: opportunity.integration_form,
      harmony_value: opportunity.harmony_value,
      target_devices: opportunity.target_devices,
    })),
    approach: item.recommended_approach,
    decision: item.decision,
  })));
}

export function formatHistoricalAnalysisContext(context?: HistoricalAnalysisReference[] | null): string {
  if (!context?.length) return '(没有足够相似且已有深度分析的历史项目)';
  return context.map((item) => JSON.stringify({
    source_repo: item.full_name,
    relation_clues: { owner: item.owner, language: item.primary_language, topics: item.topics },
    analysis_level: `tier-${item.tier} / ${item.prompt_version} / ${item.model}`,
    summary: item.project_summary_cn,
    verdict: item.opportunity_verdict,
    score: item.opportunity_score,
    reusable_patterns_only: item.opportunities.map((opportunity) => ({
      source_repo: item.full_name,
      area: opportunity.area,
      integration_form: opportunity.integration_form,
      harmony_value: opportunity.harmony_value,
      target_devices: opportunity.target_devices,
      validation_lessons: opportunity.validation_questions,
    })),
    source_repo_approach: item.recommended_approach,
    decision: item.decision,
    evidence_namespace: `上述内容全部属于 ${item.full_name}；其中没有任何路径可作为当前仓库证据`,
  }, null, 2)).join('\n\n');
}
