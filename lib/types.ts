// ============================================================================
// 共享领域类型(与 Supabase 表列一一对应,snake_case)
// 前端和管道脚本共用。
// ============================================================================

export const HARMONY_STATES = ['ADAPTED', 'PARTIAL', 'PENDING_ADAPTATION', 'NOT_ADAPTED', 'NOT_APPLICABLE'] as const;
export type HarmonyState = (typeof HARMONY_STATES)[number];

// ---- 动态二级分类体系 --------------------------------------------------------
// 分类现在由 categories 表管理(见 0004_categories.sql)。
// 以下常量仅用于向后兼容(迁移过渡期),新代码应使用 CategoryRow。

/** @deprecated 使用 categories 表代替;仅保留用于旧数据兼容 */
export const REPO_CATEGORIES = [
  'UI_FRAMEWORK', 'CROSS_PLATFORM', 'NETWORK_LIB', 'DATABASE', 'AI_ML',
  'DEV_TOOL', 'CLI', 'BUILD_TOOL', 'UTILITY_LIB', 'MEDIA', 'GRAPHICS_GAME',
  'SECURITY', 'MOBILE_APP', 'DESKTOP_APP', 'SERVER_BACKEND', 'LEARNING_DOCS', 'OTHER',
] as const;

/** @deprecated 使用 categories 表代替 */
export type RepoCategory = (typeof REPO_CATEGORIES)[number];

/** @deprecated 使用 categories 表代替 */
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

// ---- 动态分类类型(来自 categories 表) ----------------------------------------

export interface CategoryRow {
  id: number;
  parent_id: number | null;
  slug: string;
  name_cn: string;
  name_en: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

/** v_category_tree 视图返回的展平行(含父分类信息) */
export interface CategoryTreeNode extends CategoryRow {
  parent_slug: string | null;
  parent_name_cn: string | null;
  parent_sort_order: number | null;
}

/** 前端用的树形结构(嵌套) */
export interface CategoryTree {
  parent: CategoryRow;
  children: CategoryRow[];
}

// ---- 归档来源 ---------------------------------------------------------------

export const ARCHIVED_REASONS = ['github_archived', 'readme_archived', 'deprecated_notice', 'stale_repository'] as const;
export type ArchivedReason = (typeof ARCHIVED_REASONS)[number];

export const ARCHIVED_REASON_LABELS: Record<ArchivedReason, string> = {
  github_archived: 'GitHub 已归档',
  deprecated_notice: '官方声明弃用',
  stale_repository: '超过3年未更新',
  readme_archived: 'README 声明归档',
};

export const HARMONY_STATE_LABELS: Record<HarmonyState, string> = {
  ADAPTED: '已鸿蒙化',
  PARTIAL: '部分适配',
  PENDING_ADAPTATION: '待适配',
  NOT_ADAPTED: '未适配',
  NOT_APPLICABLE: '不适用',
};

// ---- DeepWiki 代码事实(见 supabase/migrations/0013_deepwiki.sql)------------

/**
 * 鸿蒙痕迹的证据强度分级。
 *
 * 这个四分法是防误判的关键,不要退化成 boolean:
 * 某大型前端框架的 napi 产物列表里带一个 openharmony 目标,只说明它的构建工具
 * 支持该 ABI,不代表项目做过鸿蒙适配 —— 那是 build_target_only,不是适配。
 */
export const HARMONY_SCOPES = [
  'dedicated_port',
  'build_target_only',
  'incidental_mention',
  'none',
] as const;
export type HarmonyScope = (typeof HARMONY_SCOPES)[number];

export const HARMONY_SCOPE_LABELS: Record<HarmonyScope, string> = {
  dedicated_port: '有专门的鸿蒙实现',
  build_target_only: '仅构建目标中提及',
  incidental_mention: '仅文档中偶然提及',
  none: '未发现鸿蒙痕迹',
};

/** 一条结论背后的证据强度,只用于如实标注,不参与评分。 */
export const EVIDENCE_LEVELS = ['wiki', 'toc', 'readme', 'none'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = {
  wiki: '代码级证据',
  toc: '模块结构',
  readme: '仅 README',
  none: '无证据',
};

export interface BlockingDep {
  name: string;
  why: string;
}

// ---- 数据库行类型 -----------------------------------------------------------

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
  is_archived: boolean;
  archived_reason: ArchivedReason | null;
  latest_release_at: string | null;
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
  harmony_value?: string;
  project_assets?: string;
  target_devices?: string[];
  target_kits?: string[];
  integration_form?: 'ohpm_package' | 'arkui_component' | 'napi_module' | 'platform_backend' | 'sdk_plugin' | 'app_feature' | 'docs_tooling';
  evidence?: string;
}

export interface AnalysisRow {
  id: number;
  repository_id: number;
  tier: number;
  model: string;
  prompt_version: string;
  input_hash: string;
  category_id: number | null;
  subcategory_id: number | null;
  /** @deprecated 旧枚举列,迁移完成后可删除 */
  category: RepoCategory | null;
  /** @deprecated 旧自由文本列,迁移完成后可删除 */
  subcategory: string | null;
  harmony_suggestion: HarmonyState | null;
  mobile_relevance: number | null;
  feasibility: number | null;
  effort_estimate: number | null;
  ecosystem_gap: number | null;
  adaptation_points: AdaptationPoint[] | null;
  recommended_approach: string | null;
  reasoning: string | null;
  /** 1-2 句中文:这个项目是干什么的 */
  project_summary_cn: string | null;
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
