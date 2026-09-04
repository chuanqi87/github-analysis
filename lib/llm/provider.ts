// 阿里百炼 / DashScope(OpenAI 兼容)provider。
// API Key 由用户在 DASHSCOPE_API_KEY 提供;base URL 与模型可配置。
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const CLASSIFY_MODEL_NAME = process.env.DASHSCOPE_MODEL ?? 'qwen3.8-max';
export const EVALUATE_MODEL_NAME = process.env.DASHSCOPE_MODEL_DEEP ?? 'qwen3.8-max';

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

// qwen3.8-max 的优势来自强制思考能力，不能沿用旧模型统一关闭 thinking 的策略。
// 其他旧 Qwen 仍默认关闭 thinking，以保持已有 JSON 管道兼容性。
const dashscopeFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = applyDashscopeModelOptions(JSON.parse(init.body));
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      /* 非 JSON body,原样透传 */
    }
  }
  return fetch(input as RequestInfo, init);
};

function getProvider() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DASHSCOPE_API_KEY,请在 .env 或 Actions Secrets 配置百炼 API Key。');
  }
  return createOpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    fetch: dashscopeFetch,
  });
}

/** tier-1 粗分类模型(便宜)。 */
export function classifyModel(): LanguageModel {
  return getProvider()(CLASSIFY_MODEL_NAME);
}

/** tier-2 深度评估模型(更强)。 */
export function evaluateModel(): LanguageModel {
  return getProvider()(EVALUATE_MODEL_NAME);
}
