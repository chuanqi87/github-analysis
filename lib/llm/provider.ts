// 阿里百炼 / DashScope(OpenAI 兼容)provider。
// API Key 由用户在 DASHSCOPE_API_KEY 提供;base URL 与模型可配置。
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const CLASSIFY_MODEL_NAME = process.env.DASHSCOPE_MODEL ?? 'qwen-plus';
export const EVALUATE_MODEL_NAME = process.env.DASHSCOPE_MODEL_DEEP ?? 'qwen-max';

function getProvider() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DASHSCOPE_API_KEY,请在 .env 或 Actions Secrets 配置百炼 API Key。');
  }
  return createOpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
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
