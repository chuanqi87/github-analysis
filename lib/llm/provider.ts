// 阿里百炼 / DashScope(OpenAI 兼容)provider。
// API Key 由用户在 DASHSCOPE_API_KEY 提供;base URL 与模型可配置。
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const CLASSIFY_MODEL_NAME = process.env.DASHSCOPE_MODEL ?? 'qwen3.8-max';
export const EVALUATE_MODEL_NAME = process.env.DASHSCOPE_MODEL_DEEP ?? 'qwen3.8-max';

export type AnalysisTier = 'classify' | 'evaluate' | 'deep';

const DEFAULT_REASONING_EFFORT: Record<AnalysisTier, string> = {
  classify: 'medium',
  evaluate: 'medium',
  deep: 'xhigh',
};

const DEFAULT_TIMEOUT_MS: Record<AnalysisTier, number> = {
  classify: 5 * 60_000,
  evaluate: 10 * 60_000,
  deep: 25 * 60_000,
};

export function reasoningEffortFor(tier: AnalysisTier): string {
  const tierValue = {
    classify: process.env.DASHSCOPE_REASONING_EFFORT_CLASSIFY,
    evaluate: process.env.DASHSCOPE_REASONING_EFFORT_EVALUATE,
    deep: process.env.DASHSCOPE_REASONING_EFFORT_DEEP,
  }[tier];
  return tierValue ?? process.env.DASHSCOPE_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT[tier];
}

export function requestTimeoutMsFor(tier: AnalysisTier): number {
  const tierValue = {
    classify: process.env.DASHSCOPE_TIMEOUT_MS_CLASSIFY,
    evaluate: process.env.DASHSCOPE_TIMEOUT_MS_EVALUATE,
    deep: process.env.DASHSCOPE_TIMEOUT_MS_DEEP,
  }[tier];
  const parsed = Number(tierValue);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : DEFAULT_TIMEOUT_MS[tier];
}

export function applyDashscopeModelOptions(
  body: Record<string, unknown>,
  reasoningEffort = process.env.DASHSCOPE_REASONING_EFFORT,
): Record<string, unknown> {
  const next = { ...body };
  if (/^qwen3\.8(?:-|$)/i.test(String(next.model ?? ''))) {
    next.enable_thinking = true;
    if (reasoningEffort) next.reasoning_effort = reasoningEffort;
  } else {
    next.enable_thinking = false;
  }
  return next;
}

function getProvider(reasoningEffort: string) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DASHSCOPE_API_KEY,请在 .env 或 Actions Secrets 配置百炼 API Key。');
  }
  return createOpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    fetch: async (input, init) => {
      if (init?.body && typeof init.body === 'string') {
        try {
          const body = applyDashscopeModelOptions(JSON.parse(init.body), reasoningEffort);
          init = { ...init, body: JSON.stringify(body) };
        } catch {
          /* 非 JSON body,原样透传 */
        }
      }
      return fetch(input as RequestInfo, init);
    },
  });
}

/** tier-1 粗分类模型(便宜)。 */
export function classifyModel(): LanguageModel {
  return getProvider(reasoningEffortFor('classify'))(CLASSIFY_MODEL_NAME);
}

/** tier-2 深度评估模型(更强)。 */
export function evaluateModel(): LanguageModel {
  return getProvider(reasoningEffortFor('evaluate'))(EVALUATE_MODEL_NAME);
}

/** tier-3 独立模型实例，允许在长时 Runner 上使用更高推理强度。 */
export function deepEvaluateModel(): LanguageModel {
  return getProvider(reasoningEffortFor('deep'))(EVALUATE_MODEL_NAME);
}
