// tier-2 深度评估:候选项目,更强模型 + README,产出 0-3 个可反证的生态结合机会。
import { generateObject } from 'ai';
import { evaluateModel, EVALUATE_MODEL_NAME, requestTimeoutMsFor } from '@/lib/llm/provider';
import { evaluateSchema, type EvaluateResult } from '@/lib/llm/schema';
import {
  systemPrompt,
  buildUserPrompt,
  prepareReadme,
  PROMPT_VERSION,
  README_CHARS_TIER2,
} from '@/lib/llm/prompts';
import { llmLimiter, withRetry } from '@/lib/ratelimit/limiter';
import { stableHash } from '@/lib/hash';
import { deepwikiFingerprint, type DeepwikiFacts } from '@/lib/deepwiki';
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { AnalyzeRepo, LlmOutput } from '@/lib/llm/classify';
import type { CategoryTreeNode } from '@/lib/types';
import { isConcreteOpportunity, scoreRepositoryOpportunities, verdictFromOpportunityScore } from '@/lib/scoring/opportunity';
import {
  historicalContextFingerprint,
  type HistoricalAnalysisReference,
} from '@/lib/llm/history-context';
import { buildCurrentEvidenceCorpus, sanitizeEvaluateEvidence } from '@/lib/llm/evidence';

export function normalizeEvaluateResult(
  result: EvaluateResult,
  hasCodeEvidence: boolean,
  support?: Pick<CollectedSignals, 'support_availability' | 'support_coverage'>,
): EvaluateResult {
  const unknownExistingCoverage =
    support?.support_availability === 'USABLE' && support.support_coverage === 'UNKNOWN';
  const opportunities = result.opportunities
    .filter(isConcreteOpportunity)
    .map((opportunity) => unknownExistingCoverage
      ? {
          ...opportunity,
          ecosystem_need: Math.min(opportunity.ecosystem_need, 0.6),
          confidence: Math.min(opportunity.confidence, 0.55),
          validation_questions: [
            '先审计现有鸿蒙实现的版本、API/组件覆盖与维护状态，再确认该机会是否仍未覆盖',
            ...opportunity.validation_questions,
          ],
        }
      : opportunity);
  const opportunityScore = scoreRepositoryOpportunities(opportunities);
  const details = unknownExistingCoverage && result.analysis_details.decision.recommendation === 'INVEST'
    ? {
        ...result.analysis_details,
        decision: {
          ...result.analysis_details.decision,
          recommendation: 'VALIDATE_FIRST' as const,
          prerequisites: [
            '完成现有鸿蒙实现的版本、功能覆盖和维护活跃度审计',
            ...result.analysis_details.decision.prerequisites,
          ],
        },
      }
    : result.analysis_details;
  return {
    ...result,
    opportunities,
    analysis_details: details,
    opportunity_verdict: verdictFromOpportunityScore(opportunityScore, hasCodeEvidence),
    recommended_approach: opportunities.length ? result.recommended_approach : null,
    ecosystem_gap: opportunities.length ? Math.max(...opportunities.map((point) => point.ecosystem_need)) : 0,
    harmony_leverage: opportunities.length
      ? Math.max(...opportunities.map((point) => (point.project_advantage + point.user_reach) / 2))
      : 0,
  };
}

function signalFingerprint(sig: CollectedSignals) {
  return {
    ohpm: sig.ohpm_matched,
    oh: sig.has_oh_package,
    proj: sig.has_build_profile || sig.has_module_json5 || sig.has_hvigor || sig.has_entry_dir,
    ets: sig.has_ets,
    reg: sig.in_registry,
    kw: Math.round(sig.keyword_score * 4),
    support: [sig.support_availability, sig.support_provenance, sig.support_coverage],
    port: [sig.gitcode_repo_url, ...sig.ecosystem_port_capabilities],
    override: sig.manual_override
      ? [sig.manual_override.state, sig.manual_override.note, sig.manual_override.marked_at]
      : null,
  };
}

export function evaluateInputHash(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
  readme: string | null,
  facts?: DeepwikiFacts | null,
  history?: HistoricalAnalysisReference[] | null,
): string {
  // hash 用清洗截断后的 README:超出截断窗口的尾部变动不触发重评
  const prepared = prepareReadme(readme, README_CHARS_TIER2);
  return stableHash({
    v: PROMPT_VERSION,
    m: EVALUATE_MODEL_NAME,
    tier: 2,
    full: repo.full_name,
    desc: repo.description,
    lang: repo.primary_language,
    topics: [...repo.topics].sort(),
    sig: signalFingerprint(sig),
    readme: prepared ? stableHash(prepared) : null,
    dw: deepwikiFingerprint(facts),
    history: historicalContextFingerprint(history),
  });
}

export async function evaluateRepo(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
  readme: string | null,
  categoryTree: CategoryTreeNode[],
  facts?: DeepwikiFacts | null,
  history?: HistoricalAnalysisReference[] | null,
): Promise<LlmOutput<EvaluateResult>> {
  const system = systemPrompt(2, categoryTree);
  const prompt = buildUserPrompt(repo, sig, prepareReadme(readme, README_CHARS_TIER2), facts, 2, history);
  const startedAt = new Date();
  const result = await withRetry(
    () =>
      llmLimiter.schedule(() =>
        generateObject({
          model: evaluateModel(),
          schema: evaluateSchema,
          // qwen3.8-max 支持 JSON 结构化输出；保留推理能力后再做本地机会门槛过滤。
          mode: 'json',
          system,
          prompt,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(requestTimeoutMsFor('evaluate')),
        }),
      ),
    { retries: 1, label: `evaluate ${repo.full_name}` },
  );
  const usage = result.usage as Record<string, number> | undefined;
  const finishedAt = new Date();
  const evidenceCorpus = buildCurrentEvidenceCorpus(
    sig,
    facts,
    prepareReadme(readme, README_CHARS_TIER2),
  );
  const data = normalizeEvaluateResult(
    sanitizeEvaluateEvidence(result.object, evidenceCorpus),
    Boolean(facts?.indexed),
    sig,
  );
  return {
    data,
    input_hash: evaluateInputHash(repo, sig, readme, facts, history),
    tokens_in: usage?.promptTokens ?? usage?.inputTokens ?? null,
    tokens_out: usage?.completionTokens ?? usage?.outputTokens ?? null,
    model: EVALUATE_MODEL_NAME,
    prompt_version: PROMPT_VERSION,
    trace: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      system_prompt: system,
      user_prompt: prompt,
    },
  };
}
