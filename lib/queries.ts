// 浏览器端看板查询(读 repo_board / 聚合视图,写 harmony_overrides)。
import { getSupabase } from '@/lib/supabase/client';
import type {
  HarmonyState,
  ScoreBreakdown,
  AdaptationPoint,
  ArchivedReason,
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
  adaptation_points: AdaptationPoint[] | null;
  recommended_approach: string | null;
  reasoning: string | null;
  auto_state_hint: HarmonyState | null;
  ohpm_matched: boolean | null;
  ohpm_packages: { pkg: string; repository: string | null }[] | null;
  has_oh_package: boolean | null;
  has_build_profile: boolean | null;
  has_ets: boolean | null;
  in_registry: boolean | null;
  registry_source: string | null;
  source_repo_url: string | null;
  keyword_score: number | null;
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
  if (filters.language) q = q.eq('primary_language', filters.language);
  if (typeof filters.reviewed === 'boolean') q = q.eq('reviewed', filters.reviewed);
  if (filters.excludeAdapted) q = q.neq('effective_state', 'ADAPTED');
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
  stars: number | null;
  total_score: number | null;
  rank: number | null;
  // 以下字段由 fetchTrending 关联 repo_board 填充
  analysis_tier: number | null;
  effective_state: HarmonyState | null;
  category_name: string | null;
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
    const { data: boardData } = await sb
      .from('repo_board')
      .select('id, analysis_tier, effective_state, category_name, priority_score')
      .in('id', repoIds);
    const boardMap = new Map(
      ((boardData ?? []) as { id: number; analysis_tier: number | null; effective_state: HarmonyState | null; category_name: string | null; priority_score: number | null }[]).map(
        (r) => [r.id, r],
      ),
    );
    for (const row of rows) {
      if (row.repository_id != null) {
        const board = boardMap.get(row.repository_id);
        row.analysis_tier = board?.analysis_tier ?? null;
        row.effective_state = board?.effective_state ?? null;
        row.category_name = board?.category_name ?? null;
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
  stage: string;
  status: string;
  stats: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
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

// ─── GitHub Actions 触发 ────────────────────────────────────────────────────

export interface WorkflowDispatchResult {
  success: boolean;
  message: string;
}

export async function triggerGitHubWorkflow(
  workflowId: string,
  inputs?: Record<string, string>,
): Promise<WorkflowDispatchResult> {
  const token = process.env.NEXT_PUBLIC_GH_TRIGGER_TOKEN;
  const repo = process.env.NEXT_PUBLIC_GH_REPO || 'chuanqi87/github-analysis';

  if (!token) {
    return { success: false, message: '未配置 GH_TRIGGER_TOKEN，请在环境变量中设置 NEXT_PUBLIC_GH_TRIGGER_TOKEN' };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: inputs ?? {},
        }),
      },
    );

    if (res.status === 204) {
      return { success: true, message: '任务已触发，请稍后查看运行结果' };
    }

    const err = await res.text();
    return { success: false, message: `触发失败 (${res.status}): ${err}` };
  } catch (e) {
    return { success: false, message: `请求异常: ${(e as Error).message}` };
  }
}
