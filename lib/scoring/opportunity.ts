import type { AdaptationPoint, OpportunityVerdict } from '@/lib/types';

function clamp01(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const DIFFICULTY_FACTOR: Record<AdaptationPoint['difficulty'], number> = {
  low: 1,
  medium: 0.9,
  high: 0.78,
};

/**
 * 单条结合机会的确定性评分。价值占主导，工作量只作温和修正；
 * 这样“容易发一个通用包”不会胜过困难但能补齐关键平台能力的项目。
 */
export function scoreOpportunity(point: AdaptationPoint): number {
  const strategicValue =
    0.35 * clamp01(point.ecosystem_need) +
    0.25 * clamp01(point.project_advantage) +
    0.2 * clamp01(point.user_reach) +
    0.2 * clamp01(point.upstream_fit);
  const confidence = clamp01(point.confidence);
  const score = 100 * strategicValue * confidence * DIFFICULTY_FACTOR[point.difficulty];
  return Math.round(score * 100) / 100;
}

/** 项目按最佳机会排序，第二机会只提供 10% 加成，避免靠凑数量得高分。 */
export function scoreRepositoryOpportunities(points: AdaptationPoint[]): number {
  const scores = points.map(scoreOpportunity).sort((a, b) => b - a);
  return Math.min(100, Math.round(((scores[0] ?? 0) + 0.1 * (scores[1] ?? 0)) * 100) / 100);
}

export function verdictFromOpportunityScore(
  score: number,
  hasEvidence: boolean,
): OpportunityVerdict {
  if (!hasEvidence) return 'INSUFFICIENT_EVIDENCE';
  if (score >= 65) return 'HIGH_VALUE';
  if (score >= 40) return 'PROMISING';
  if (score > 0) return 'LOW_VALUE';
  return 'NO_CLEAR_OPPORTUNITY';
}

export function scoreScreening(input: {
  clientRelevance: number;
  platformIntegrationNeed: number;
  reusableAssetStrength: number;
  feasibility: number;
  confidence: number;
}): number {
  const value =
    0.3 * clamp01(input.clientRelevance) +
    0.45 * clamp01(input.platformIntegrationNeed) +
    0.25 * clamp01(input.reusableAssetStrength);
  const feasibilityFactor = 0.75 + 0.25 * clamp01(input.feasibility);
  return Math.round(100 * value * feasibilityFactor * clamp01(input.confidence) * 100) / 100;
}

/** 过滤缺少项目资产、鸿蒙场景、未覆盖范围或证据引用的“万金油”建议。 */
export function isConcreteOpportunity(point: AdaptationPoint): boolean {
  return Boolean(
    point.project_assets?.trim() &&
      point.harmony_value?.trim() &&
      point.uncovered_scope?.trim() &&
      point.integration_form &&
      point.evidence_refs?.some((evidence) => evidence.trim()) &&
      clamp01(point.confidence) >= 0.45,
  );
}
