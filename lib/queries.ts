// 浏览器端看板查询(读 repo_board / 聚合视图,写 harmony_overrides)。
import { getSupabase } from '@/lib/supabase/client';
import type {
  HarmonyState,
  RepoCategory,
  ScoreBreakdown,
  AdaptationPoint,
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
  priority_score: number | null;
  rank: number | null;
  breakdown: ScoreBreakdown | null;
  category: RepoCategory | null;
  subcategory: string | null;
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
  category?: RepoCategory;
  effectiveState?: HarmonyState;
  language?: string;
  reviewed?: boolean;
  excludeAdapted?: boolean;
}

export interface BoardPage {
  data: BoardRow[];
  total: number;
}

export async function fetchBoard(
  params: { page: number; pageSize: number; filters?: BoardFilters },
): Promise<BoardPage> {
  const sb = getSupabase();
  const { page, pageSize, filters = {} } = params;
  let q = sb.from('repo_board').select('*', { count: 'exact' });

  if (filters.keyword) q = q.ilike('full_name', `%${filters.keyword}%`);
  if (filters.category) q = q.eq('category', filters.category);
  if (filters.effectiveState) q = q.eq('effective_state', filters.effectiveState);
  if (filters.language) q = q.eq('primary_language', filters.language);
  if (typeof filters.reviewed === 'boolean') q = q.eq('reviewed', filters.reviewed);
  if (filters.excludeAdapted) q = q.neq('effective_state', 'ADAPTED');

  const from = (page - 1) * pageSize;
  q = q
    .order('priority_score', { ascending: false, nullsFirst: false })
    .order('stars', { ascending: false })
    .range(from, from + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: (data ?? []) as BoardRow[], total: count ?? 0 };
}

export async function fetchRepoByFullName(fullName: string): Promise<BoardRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('repo_board').select('*').eq('full_name', fullName).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardRow) ?? null;
}

export interface CategoryStat {
  category: string;
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
  return (data ?? []) as TrendingRow[];
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
