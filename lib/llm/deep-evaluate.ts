// tier-3 深度评估:DeepWiki 多问汇总 + 一次结构化定级。
//
// 换引擎的动机(见 docs/deepwiki-redesign.md §4.6):
// 原 tier-3 是 scripts/agent/ 的 Python Agent —— 下载整个 tarball(linux/tensorflow
// 是灾难级体积),再用多轮强模型工具调用**采样**代码。DeepWiki 基于**全量索引**,
// 7 问并发约 15 秒、零 token 就能给出同等甚至更完整的事实。
//
// 分工不变:DeepWiki 出事实,这里的 LLM 出判断。
import { generateObject } from 'ai';
import { evaluateModel, EVALUATE_MODEL_NAME } from '@/lib/llm/provider';
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
import { deepwikiFingerprint, QUESTION_VERSION, type DeepwikiFacts } from '@/lib/deepwiki';
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { AnalyzeRepo, LlmOutput } from '@/lib/llm/classify';
import type { CategoryTreeNode } from '@/lib/types';
import { normalizeEvaluateResult } from '@/lib/llm/evaluate';
import {
  historicalContextFingerprint,
  type HistoricalAnalysisReference,
} from '@/lib/llm/history-context';

/** tier-3 独立的 prompt 版本标识,便于与 tier-2 结果并存对比。 */
export const DEEP_PROMPT_VERSION = `${PROMPT_VERSION}-deep-${QUESTION_VERSION}`;
/** Python tarball 兜底使用的同代 verifier 版本。 */
export const TARBALL_PROMPT_VERSION = `${PROMPT_VERSION}-agent-v3`;

export type OpportunityEvaluationSeed = Pick<
  EvaluateResult,
  'opportunity_verdict' | 'opportunities' | 'recommended_approach'
>;

/** 每个子系统答复的注入上限,防止单条超长回答挤爆上下文。 */
const SECTION_CHARS = 4000;

/** tier-3 追加问题的中文小标题(extra 的 key → 标题)。 */
const SECTION_TITLES: Record<string, string> = {
  build_system: '构建系统与目标平台声明',
  native_bridge: '原生/托管边界(桥接机制)',
  ui_layer: 'UI 与渲染层',
  io_layer: '网络 / 存储 / 并发',
  license_and_health: '许可证与第三方代码',
};

/**
 * 把 tier-3 的子系统问答铺成 prompt 段落。
 *
 * 直接给 JSON 而不是转成散文:这些回答本身就是结构化的,
 * 再套一层自然语言只会引入改写误差。
 */
export function formatDeepSections(facts: DeepwikiFacts): string {
  if (!facts.extra) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(facts.extra)) {
    const title = SECTION_TITLES[key] ?? key;
    const json = JSON.stringify(value, null, 2);
    parts.push(`### ${title}\n${json.length > SECTION_CHARS ? `${json.slice(0, SECTION_CHARS)}\n…(已截断)` : json}`);
  }
  return parts.join('\n\n');
}

export function deepEvaluateInputHash(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
  readme: string | null,
  facts: DeepwikiFacts,
  priorEvaluation?: OpportunityEvaluationSeed | null,
  history?: HistoricalAnalysisReference[] | null,
): string {
  const prepared = prepareReadme(readme, README_CHARS_TIER2);
  return stableHash({
    v: DEEP_PROMPT_VERSION,
    m: EVALUATE_MODEL_NAME,
    tier: 3,
    full: repo.full_name,
    desc: repo.description,
    topics: [...repo.topics].sort(),
    readme: prepared ? stableHash(prepared) : null,
    dw: deepwikiFingerprint(facts),
    // 子系统问答参与哈希,但只取 key 集合与长度量级,不取原文
    sections: Object.entries(facts.extra ?? {})
      .map(([k, v]) => `${k}:${Math.round(JSON.stringify(v).length / 200)}`)
      .sort(),
    prior: priorEvaluation
      ? stableHash({ verdict: priorEvaluation.opportunity_verdict, opportunities: priorEvaluation.opportunities })
      : null,
    history: historicalContextFingerprint(history),
  });
}

export async function deepEvaluateRepo(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
  readme: string | null,
  categoryTree: CategoryTreeNode[],
  facts: DeepwikiFacts,
  priorEvaluation?: OpportunityEvaluationSeed | null,
  history?: HistoricalAnalysisReference[] | null,
): Promise<LlmOutput<EvaluateResult>> {
  // tier-2 是待验证假设；tier-3 可删改，也可在新的代码事实直接支持时补充漏项。
  const base = buildUserPrompt(repo, sig, prepareReadme(readme, README_CHARS_TIER2), facts, 2, history);
  const sections = formatDeepSections(facts);
  const prior = priorEvaluation
    ? `\n## tier-2 待验证机会（逐条复核，可删改；新机会必须由 tier-3 代码事实直接支持）\n${JSON.stringify({
        opportunity_verdict: priorEvaluation.opportunity_verdict,
        opportunities: priorEvaluation.opportunities,
        recommended_approach: priorEvaluation.recommended_approach,
      }, null, 2)}`
    : '\n## tier-2 待验证机会\n无可用候选；除非代码事实直接证明，否则返回空机会。';
  const prompt = `${base.replace('\n请按 schema 输出 JSON。', '')}${prior}${
    sections ? `\n## 子系统深度事实(DeepWiki 逐项问询结果)\n${sections}` : ''
  }\n\n先完成架构和移植面的独立技术尽调，再逐条寻找反证；保留代码事实明确支持且当前支持尚未覆盖的机会。若深层代码暴露了 tier-2 未识别的平台插槽，可以新增，但必须引用当前仓库的新证据。请按 schema 输出 JSON。`;
  const system = `${systemPrompt(2, categoryTree)}\n\n## tier-3 验证职责\n你是独立技术尽调者。tier-2 与历史分析都是待验证先验，不是结论。充分阅读子系统事实，既要淘汰弱机会，也要识别深层代码中被遗漏的高价值平台结合点。输出必须让投资、立项和技术负责人能据此决定是否投入。允许最终 opportunities=[]。`;
  const startedAt = new Date();

  const result = await withRetry(
    () =>
      llmLimiter.schedule(() =>
        generateObject({
          model: evaluateModel(),
          schema: evaluateSchema,
          // qwen3.8-max 先推理审查，再以 JSON 返回通过反证的机会。
          mode: 'json',
          system,
          prompt,
          maxRetries: 1,
        }),
      ),
    { retries: 2, label: `deep-evaluate ${repo.full_name}` },
  );

  const usage = result.usage as Record<string, number> | undefined;
  const finishedAt = new Date();
  return {
    data: normalizeEvaluateResult(result.object, true),
    input_hash: deepEvaluateInputHash(repo, sig, readme, facts, priorEvaluation, history),
    tokens_in: usage?.promptTokens ?? usage?.inputTokens ?? null,
    tokens_out: usage?.completionTokens ?? usage?.outputTokens ?? null,
    model: EVALUATE_MODEL_NAME,
    prompt_version: DEEP_PROMPT_VERSION,
    trace: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      system_prompt: system,
      user_prompt: prompt,
    },
  };
}
