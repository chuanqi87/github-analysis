// 浏览器端看板查询(读 repo_board / 聚合视图,写 harmony_overrides)。
import { getSupabase } from '@/lib/supabase/client';
import type {
  HarmonyState,
  HarmonyScope,
  EvidenceLevel,
  ScoreBreakdown,
  AdaptationPoint,
  AnalysisDetails,
  ArchivedReason,
  OpportunityVerdict,
  SupportAvailability,
  SupportCoverage,
  SupportEvidence,
  SupportProvenance,
} from '@/lib/types';

export interface BoardRow {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  homepage: string | null;
  primary_language: string | null;
  stars: number;
  forks: number;
  topics: string[] | null;
  license: string | null;
  pushed_at: string | null;
  is_archived: boolean;
  archived_reason: ArchivedReason | null;
  priority_score: number | null;
  rank: number | null;
  breakdown: ScoreBreakdown | null;
  // 动态分类(来自 categories 表,通过视图 join)
  category: string | null;          // slug
  subcategory: string | null;       // slug
  category_name: string | null;     // 中文名
  subcategory_name: string | null;  // 中文名
  analysis_tier: number | null;
  harmony_suggestion: HarmonyState | null;
  mobile_relevance: number | null;
  feasibility: number | null;
  effort_estimate: number | null;
  ecosystem_gap: number | null;
  harmony_leverage: number | null;
  opportunity_verdict: OpportunityVerdict | null;
  opportunity_score: number | null;
  screening_reason: string | null;
  confidence: number | null;
  adaptation_points: AdaptationPoint[] | null;
  analysis_details: AnalysisDetails | null;
  recommended_approach: string | null;
  reasoning: string | null;
  project_summary_cn: string | null;
  auto_state_hint: HarmonyState | null;
  support_availability: SupportAvailability | null;
  support_provenance: SupportProvenance | null;
  support_coverage: SupportCoverage | null;
  support_confidence: number | null;
  support_evidence: SupportEvidence[] | null;
  ohpm_matched: boolean | null;
  ohpm_packages: { pkg: string; repository: string | null }[] | null;
  has_oh_package: boolean | null;
  has_build_profile: boolean | null;
  has_ets: boolean | null;
  in_registry: boolean | null;
  registry_source: string | null;
  source_repo_url: string | null;
  keyword_score: number | null;
  // ---- DeepWiki 代码事实(见 supabase/migrations/0013_deepwiki.sql)----------
  deepwiki_indexed: boolean | null;
  deepwiki_toc: string | null;
  /** dedicated_port | build_target_only | incidental_mention | none */
  deepwiki_harmony_scope: HarmonyScope | null;
  deepwiki_harmony_paths: string[] | null;
  deepwiki_harmony_quote: string | null;
  deepwiki_project_type: string | null;
  deepwiki_languages: string[] | null;
  deepwiki_native_code_ratio: number | null;
  deepwiki_has_platform_abstraction: boolean | null;
  deepwiki_platform_layer_paths: string[] | null;
  deepwiki_platform_backends: string[] | null;
  deepwiki_portable_core_paths: string[] | null;
  deepwiki_blocking_deps: { name: string; why: string }[] | null;
  /** 这条结论的证据强度:wiki > toc > readme > none */
  evidence_level: EvidenceLevel | null;
  override_state: HarmonyState | null;
  override_note: string | null;
  marked_by: string | null;
  marked_at: string | null;
  effective_state: HarmonyState | null;
  reviewed: boolean | null;
}

export interface BoardFilters {
  keyword?: string;
  category?: string;  // slug
  effectiveState?: HarmonyState;
  supportAvailability?: SupportAvailability;
  language?: string;
  reviewed?: boolean;
  excludeAdapted?: boolean;
  /** 'analyzed' = 已分析(tier>=1), 'unanalyzed' = 未分析, undefined = 全部 */
  analysisStatus?: 'analyzed' | 'unanalyzed';
  /** 归档过滤:true=仅归档, false=排除归档, undefined=全部 */
  archived?: boolean;
  /** 是否排除已归档仓库(默认 true) */
  excludeArchived?: boolean;
}

export interface BoardPage {
  data: BoardRow[];
  total: number;
}

export async function fetchBoard(
  params: { page: number; pageSize: number; filters?: BoardFilters; orderBy?: string; orderAsc?: boolean },
): Promise<BoardPage> {
  const sb = getSupabase();
  const { page, pageSize, filters = {}, orderBy = 'stars', orderAsc = false } = params;
  let q = sb.from('repo_board').select('*', { count: 'exact' });

  if (filters.keyword) q = q.ilike('full_name', `%${filters.keyword}%`);
  if (filters.category) q = q.eq('category', filters.category);
  if (filters.effectiveState) q = q.eq('effective_state', filters.effectiveState);
  if (filters.supportAvailability) q = q.eq('support_availability', filters.supportAvailability);
  if (filters.language) q = q.eq('primary_language', filters.language);
  if (typeof filters.reviewed === 'boolean') q = q.eq('reviewed', filters.reviewed);
  if (filters.excludeAdapted) {
    q = q.neq('support_availability', 'USABLE').or('effective_state.neq.ADAPTED,effective_state.is.null');
  }
  if (filters.analysisStatus === 'analyzed') q = q.not('analysis_tier', 'is', null);
  if (filters.analysisStatus === 'unanalyzed') q = q.is('analysis_tier', null);

  // 归档过滤
  if (filters.archived === true) {
    q = q.eq('is_archived', true);
  } else if (filters.archived === false) {
    q = q.eq('is_archived', false);
  } else if (filters.excludeArchived) {
    q = q.eq('is_archived', false);
  }

  const from = (page - 1) * pageSize;
  q = q
    .order(orderBy, { ascending: orderAsc, nullsFirst: false })
    .range(from, from + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: (data ?? []) as BoardRow[], total: count ?? 0 };
}

export async function fetchLanguages(): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('repo_board')
    .select('primary_language')
    .not('primary_language', 'is', null)
    .order('primary_language');
  if (error) throw new Error(error.message);
  const langs = new Set<string>();
  for (const row of data ?? []) {
    if (row.primary_language) langs.add(row.primary_language);
  }
  return Array.from(langs).sort();
}

export async function fetchRepoByFullName(fullName: string): Promise<BoardRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('repo_board').select('*').eq('full_name', fullName).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardRow) ?? null;
}

export interface CategoryStat {
  category: string;          // slug
  category_name: string;     // 中文名
  total: number;
  avg_priority: number | null;
  adapted: number;
  not_adapted: number;
}

export async function fetchCategoryStats(): Promise<CategoryStat[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from('v_category_stats').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryStat[];
}

export interface HarmonyStat {
  effective_state: HarmonyState;
  total: number;
  reviewed: number;
}

export async function fetchHarmonyStats(): Promise<HarmonyStat[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from('v_harmony_stats').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as HarmonyStat[];
}

export interface TrendingRow {
  id: number;
  captured_date: string;
  source: string;
  repo_name: string;
  repository_id: number | null;
  primary_language: string | null;
  description: string | null;
  /** 仓库当前总 star 数 */
  stars: number | null;
  /** 本周(快照周期内)新增 star 数 */
  stars_delta: number | null;
  /** 仓库当前总 fork 数 */
  forks: number | null;
  /** 本周新增 fork 数 */
  forks_delta: number | null;
  total_score: number | null;
  rank: number | null;
  // 以下字段由 fetchTrending 关联 repo_board 填充
  analysis_tier: number | null;
  effective_state: HarmonyState | null;
  category_name: string | null;
  subcategory_name: string | null;
  project_summary_cn: string | null;
  reasoning: string | null;
  priority_score: number | null;
  weeks_on_trending: number;
}

export async function fetchLatestTrendingDate(): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('trending_snapshots')
    .select('captured_date')
    .order('captured_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { captured_date: string } | null)?.captured_date ?? null;
}

export async function fetchTrending(date: string): Promise<TrendingRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('trending_snapshots')
    .select('*')
    .eq('captured_date', date)
    .order('rank', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TrendingRow[];

  // 关联 repo_board 获取分析状态(仅对有 repository_id 的行)
  const repoIds = rows.filter((r) => r.repository_id != null).map((r) => r.repository_id!);
  if (repoIds.length > 0) {
    const { data: boardData, error: boardError } = await sb
      .from('repo_board')
      .select('id, analysis_tier, effective_state, category_name, subcategory_name, reasoning, priority_score, project_summary_cn')
      .in('id', repoIds);
    const boardRows = boardError
      ? (
          await sb
            .from('repo_board')
            .select('id, analysis_tier, effective_state, category_name, subcategory_name, reasoning, priority_score')
            .in('id', repoIds)
        ).data
      : boardData;
    const boardMap = new Map(
      ((boardRows ?? []) as {
        id: number;
        analysis_tier: number | null;
        effective_state: HarmonyState | null;
        category_name: string | null;
        subcategory_name: string | null;
        project_summary_cn?: string | null;
        reasoning: string | null;
        priority_score: number | null;
      }[]).map((r) => [r.id, r]),
    );
    for (const row of rows) {
      if (row.repository_id != null) {
        const board = boardMap.get(row.repository_id);
        row.analysis_tier = board?.analysis_tier ?? null;
        row.effective_state = board?.effective_state ?? null;
        row.category_name = board?.category_name ?? null;
        row.subcategory_name = board?.subcategory_name ?? null;
        row.project_summary_cn = board?.project_summary_cn ?? null;
        row.reasoning = board?.reasoning ?? null;
        row.priority_score = board?.priority_score ?? null;
      }
    }
  }

  return rows;
}

export async function upsertOverride(input: {
  repositoryId: number;
  state: HarmonyState;
  note?: string | null;
  markedBy?: string | null;
}): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('harmony_overrides').upsert(
    {
      repository_id: input.repositoryId,
      state: input.state,
      note: input.note ?? null,
      marked_by: input.markedBy ?? null,
      marked_at: new Date().toISOString(),
    },
    { onConflict: 'repository_id' },
  );
  if (error) throw new Error(error.message);
}

// ─── Tier-3 深度分析 ───────────────────────────────────────────────────────

export interface Tier3Analysis {
  repository_id: number;
  project_type: string | null;
  tech_stack: {
    primary_language?: string;
    languages?: string[];
    frameworks?: string[];
    total_lines?: number;
    native_code_ratio?: number;
    description?: string;
  } | null;
  dependencies_analysis: {
    total_deps?: number;
    os_specific_deps?: string[];
    hardware_deps?: string[];
    easy_to_adapt?: string[];
    hard_to_adapt?: string[];
  } | null;
  key_files_analyzed: string[] | null;
  adaptation_points: (AdaptationPoint & { evidence?: string })[] | null;
  reasoning: string | null;
  recommended_approach: string | null;
  created_at: string;
}

export async function fetchTier3Analysis(repositoryId: number): Promise<Tier3Analysis | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('analysis')
    .select(`
      repository_id,
      project_type,
      tech_stack,
      dependencies_analysis,
      key_files_analyzed,
      adaptation_points,
      reasoning,
      recommended_approach,
      created_at
    `)
    .eq('repository_id', repositoryId)
    .eq('tier', 3)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Tier3Analysis) ?? null;
}

// ─── 仓库统计 ─────────────────────────────────────────────────────────────

export interface RepoStats {
  total: number;
  analyzed: number;
  unanalyzed: number;
  archived: number;
}

export async function fetchRepoStats(): Promise<RepoStats> {
  const sb = getSupabase();

  // 总数
  const { count: total, error: e1 } = await sb
    .from('repositories')
    .select('*', { count: 'exact', head: true });
  if (e1) throw new Error(e1.message);

  // 已分析数 (有 analysis 记录的)
  const { count: analyzed, error: e2 } = await sb
    .from('repo_board')
    .select('id', { count: 'exact', head: true })
    .not('analysis_tier', 'is', null);
  if (e2) throw new Error(e2.message);

  // 归档数
  const { count: archived, error: e3 } = await sb
    .from('repositories')
    .select('id', { count: 'exact', head: true })
    .eq('is_archived', true);
  if (e3) throw new Error(e3.message);

  return {
    total: total ?? 0,
    analyzed: analyzed ?? 0,
    unanalyzed: (total ?? 0) - (analyzed ?? 0),
    archived: archived ?? 0,
  };
}

// ─── Pipeline 运行记录 ─────────────────────────────────────────────────────

export interface PipelineRun {
  id: number;
  session_id: string | null;
  stage: string;
  status: string;
  stats: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
}

export interface DailyPipelineMetric {
  metric_date: string;
  repositories_total: number;
  discovered_today: number;
  preliminary_today: number;
  deep_today: number;
  tier3_today: number;
  trending_collected: number;
  trending_promoted: number;
  preliminary_backlog: number;
  deep_backlog: number;
  tier3_backlog: number;
  failed_count: number;
  updated_at: string;
}

export async function fetchDailyPipelineMetrics(limit = 14): Promise<DailyPipelineMetric[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('pipeline_daily_metrics')
    .select('*')
    .order('metric_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyPipelineMetric[];
}

export async function fetchPipelineRuns(limit = 20): Promise<PipelineRun[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('pipeline_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PipelineRun[];
}
