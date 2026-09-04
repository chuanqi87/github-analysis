// ============================================================================
// 适配价值评分模型(纯函数,前端与管道共用)
//
//   weighted = 0.28*popularity + 0.12*velocity + 0.28*mobileRelevance
//            + 0.18*effortInv + 0.14*ecosystemGap        # 五项和=1
//   priorityScore = 100 * feasibility * adaptedGate * weighted
//
// feasibility / adaptedGate 作乘子:不可行或已适配的项目自然沉底。
// ============================================================================

import type { HarmonyState, ScoreBreakdown } from '@/lib/types';

export const WEIGHTS_VERSION = 'v2-opportunity';

const WEIGHTS = {
  popularity: 0.28,
  velocity: 0.12,
  mobileRelevance: 0.28,
  effortInv: 0.18,
  ecosystemGap: 0.14,
} as const;

// 品类先验:该品类做鸿蒙化的移动/跨端价值。
// 使用 slug 键值(与 categories 表一致),向后兼容旧枚举值(大写)。
const SLUG_PRIOR: Record<string, number> = {
  // 顶层分类 slug(小写)
  ui_framework: 1.0,
  cross_platform: 1.0,
  media: 0.8,
  graphics_game: 0.8,
  network_lib: 0.7,
  utility_lib: 0.7,
  database: 0.65,
  ai_ml: 0.6,
  security: 0.6,
  mobile_app: 0.55,
  dev_tool: 0.4,
  cli: 0.3,
  build_tool: 0.3,
  desktop_app: 0.25,
  server_backend: 0.2,
  learning_docs: 0.1,
  other: 0.3,
  // 旧枚举值(大写)兼容
  UI_FRAMEWORK: 1.0,
  CROSS_PLATFORM: 1.0,
  MEDIA: 0.8,
  GRAPHICS_GAME: 0.8,
  NETWORK_LIB: 0.7,
  UTILITY_LIB: 0.7,
  DATABASE: 0.65,
  AI_ML: 0.6,
  SECURITY: 0.6,
  MOBILE_APP: 0.55,
  DEV_TOOL: 0.4,
  CLI: 0.3,
  BUILD_TOOL: 0.3,
  DESKTOP_APP: 0.25,
  SERVER_BACKEND: 0.2,
  LEARNING_DOCS: 0.1,
  OTHER: 0.3,
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// stars≥10000(log10≥4)起步,~300k 封顶。
export function popularityFromStars(stars: number): number {
  const denom = Math.log10(300000) - 4; // ≈1.477
  return clamp01((Math.log10(Math.max(stars, 1)) - 4) / denom);
}

// 人工标记(权威)/ 自动暂定状态 → 门控乘子。null=尚未评估,视为待适配(1.0)以浮到前面待审。
export function adaptedGate(state: HarmonyState | null | undefined): number {
  switch (state) {
    case 'ADAPTED':
      return 0.0;
    case 'NOT_APPLICABLE':
      return 0.0;
    case 'PARTIAL':
      return 0.3;
    case 'PENDING_ADAPTATION':
      return 1.0;
    case 'NOT_ADAPTED':
      return 1.0;
    default:
      return 1.0;
  }
}

/**
 * 品类先验:接受 slug(小写)或旧枚举值(大写)。
 * 未知 slug 返回 0.4 作为安全默认值。
 */
export function categoryPrior(category: string | null | undefined): number {
  if (!category) return 0.4;
  return SLUG_PRIOR[category] ?? 0.4;
}

export interface ScoreInput {
  stars: number;
  /** 趋势热度 0-1(来自 trending / star 增速百分位);非热点传 0 */
  velocity?: number;
  /** 有效鸿蒙状态:人工标记优先,否则自动暂定,否则 null */
  effectiveState?: HarmonyState | null;
  category?: string | null;   // slug
  /** LLM 给出的移动/跨端相关度 0-1 */
  llmMobileRelevance?: number | null;
  /** LLM 工作量估计 0-1(0 易 1 难)*/
  effortEstimate?: number | null;
  /** 生态缺口 0-1 */
  ecosystemGap?: number | null;
  /** 可行性 0-1 */
  feasibility?: number | null;
  /** 新分析模型产出的最佳可信结合机会分(0-100)。 */
  opportunityScore?: number | null;
  confidence?: number | null;
}

export function computePriority(input: ScoreInput): ScoreBreakdown {
  const popularity = popularityFromStars(input.stars);
  const velocity = clamp01(input.velocity ?? 0);

  // 移动相关度 = 品类先验与 LLM 值加权平均(各 50%)
  const prior = categoryPrior(input.category);
  const llmMobile = input.llmMobileRelevance == null ? prior : clamp01(input.llmMobileRelevance);
  const mobileRelevance = clamp01(0.5 * prior + 0.5 * llmMobile);

  const effortInv = clamp01(1 - (input.effortEstimate ?? 0.5));
  const ecosystemGap = clamp01(input.ecosystemGap ?? 0.5);
  const feasibility = clamp01(input.feasibility ?? 0.5);
  const gate = adaptedGate(input.effectiveState);

  const weighted =
    WEIGHTS.popularity * popularity +
    WEIGHTS.velocity * velocity +
    WEIGHTS.mobileRelevance * mobileRelevance +
    WEIGHTS.effortInv * effortInv +
    WEIGHTS.ecosystemGap * ecosystemGap;

  const opportunityScore = Math.max(0, Math.min(100, input.opportunityScore ?? 0));
  const impactFactor = 0.7 + 0.3 * (0.75 * popularity + 0.25 * velocity);
  const confidenceFactor = 0.85 + 0.15 * clamp01(input.confidence ?? 0.5);
  // 新版结果已经逐条扣除了已覆盖范围，不能再用仓库整体“已适配”状态归零。
  // 旧分析没有机会分时继续走兼容公式，直到 p11 回填完成。
  const priorityScore = input.opportunityScore == null
    ? 100 * feasibility * gate * weighted
    : opportunityScore * impactFactor * confidenceFactor;

  return {
    popularity,
    velocity,
    mobileRelevance,
    effortInv,
    ecosystemGap,
    weighted,
    feasibility,
    adaptedGate: gate,
    priorityScore: Math.round(priorityScore * 100) / 100,
    weightsVersion: WEIGHTS_VERSION,
    opportunityScore,
    impactFactor,
    confidenceFactor,
  };
}
