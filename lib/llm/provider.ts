// 阿里百炼 / DashScope(OpenAI 兼容)provider。
// API Key 由用户在 DASHSCOPE_API_KEY 提供;base URL 与模型可配置。
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const CLASSIFY_MODEL_NAME = process.env.DASHSCOPE_MODEL ?? 'qwen-plus';
export const EVALUATE_MODEL_NAME = process.env.DASHSCOPE_MODEL_DEEP ?? 'qwen-max';

// qwen3.x 为思考模型:开启 thinking 时(1)不支持 tool_choice;(2)JSON 输出约 1/3 概率不合 schema;
// (3)推理 token 拖慢速度。注入 enable_thinking:false → 干净直出 JSON、更快、更稳。
const disableThinkingFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      body.enable_thinking = false;
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
    fetch: disableThinkingFetch,
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
