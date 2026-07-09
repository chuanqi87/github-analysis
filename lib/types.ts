// ============================================================================
// 共享领域类型(与 Supabase 表列一一对应,snake_case)
// 前端与管道脚本共用。
// ============================================================================

export const HARMONY_STATES = ['ADAPTED', 'PARTIAL', 'NOT_ADAPTED', 'NOT_APPLICABLE'] as const;
export type HarmonyState = (typeof HARMONY_STATES)[number];

export const REPO_CATEGORIES = [
  'UI_FRAMEWORK', 'CROSS_PLATFORM', 'NETWORK_LIB', 'DATABASE', 'AI_ML',
  'DEV_TOOL', 'CLI', 'BUILD_TOOL', 'UTILITY_LIB', 'MEDIA', 'GRAPHICS_GAME',
  'SECURITY', 'MOBILE_APP', 'DESKTOP_APP', 'SERVER_BACKEND', 'LEARNING_DOCS', 'OTHER',
] as const;

export type RepoCategory = (typeof REPO_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<RepoCategory, string> = {
  UI_FRAMEWORK: 'UI 框架',
  CROSS_PLATFORM: '跨端框架',
  NETWORK_LIB: '网络库',
  DATABASE: '数据存储',
  AI_ML: 'AI/ML',
  DEV_TOOL: '开发工具',
  CLI: '命令行工具',
  BUILD_TOOL: '构建工具',
  UTILITY_LIB: '通用工具库',
  MEDIA: '多媒体',
  GRAPHICS_GAME: '图形/游戏',
  SECURITY: '安全',
  MOBILE_APP: '移动应用',
  DESKTOP_APP: '桌面应用',
  SERVER_BACKEND: '服务端/后端',
  LEARNING_DOCS: '学习/文档',
  OTHER: '其它',
};

export const HARMONY_STATE_LABELS: Record<HarmonyState, string> = {
  ADAPTED: '已鸿蒙化',
  PARTIAL: '部分适配',
  NOT_ADAPTED: '未适配',
  NOT_APPLICABLE: '不适用',
};

export interface RepositoryRow {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  homepage: string | null;
  primary_language: string | null;
  stars: number;
  forks: number;
  open_issues: number | null;
  topics: string[];
  license: string | null;
  pushed_at: string | null;
  repo_created_at: string | null;
  readme_text: string | null;
  readme_fetched_at: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface HarmonySignalsRow {
  repository_id: number;
  ohpm_matched: boolean;
  ohpm_packages: { pkg: string; repository: string | null }[] | null;
  has_oh_package: boolean;
  has_build_profile: boolean;
  has_module_json5: boolean;
  has_hvigor: boolean;
  has_entry_dir: boolean;
  has_ets: boolean;
  in_registry: boolean;
  registry_source: string | null;
  source_repo_url: string | null;
  keyword_score: number;
  auto_state_hint: HarmonyState | null;
  signals: Record<string, unknown> | null;
  checked_at: string;
}

export interface AdaptationPoint {
  area: string;
  description: string;
  difficulty: 'low' | 'medium' | 'high';
}

export interface AnalysisRow {
  id: number;
  repository_id: number;
  tier: number;
  model: string;
  prompt_version: string;
  input_hash: string;
  category: RepoCategory | null;
  harmony_suggestion: HarmonyState | null;
  mobile_relevance: number | null;
  feasibility: number | null;
  effort_estimate: number | null;
  ecosystem_gap: number | null;
  adaptation_points: AdaptationPoint[] | null;
  recommended_approach: string | null;
  reasoning: string | null;
  confidence: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface HarmonyOverrideRow {
  repository_id: number;
  state: HarmonyState;
  note: string | null;
  marked_by: string | null;
  marked_at: string;
}

export interface PriorityRankingRow {
  repository_id: number;
  priority_score: number;
  rank: number | null;
  weights_version: string;
  breakdown: ScoreBreakdown | null;
  computed_at: string;
}

export interface TrendingSnapshotRow {
  id: number;
  captured_date: string;
  source: string;
  repo_name: string;
  repository_id: number | null;
  primary_language: string | null;
  description: string | null;
  stars: number | null;
  forks: number | null;
  total_score: number | null;
  rank: number | null;
  captured_at: string;
}

// ---- 评分相关(见 lib/scoring/priority.ts)--------------------------------
export interface ScoreBreakdown {
  popularity: number;
  velocity: number;
  mobileRelevance: number;
  effortInv: number;
  ecosystemGap: number;
  weighted: number;
  feasibility: number;
  adaptedGate: number;
  priorityScore: number;
  weightsVersion: string;
}
