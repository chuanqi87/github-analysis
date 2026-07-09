// tier-1 粗分类:全量项目,便宜模型,短输出。
import { generateObject } from 'ai';
import { classifyModel, CLASSIFY_MODEL_NAME } from '@/lib/llm/provider';
import { classifySchema, type ClassifyResult } from '@/lib/llm/schema';
import { systemPrompt, buildUserPrompt, PROMPT_VERSION } from '@/lib/llm/prompts';
import { llmLimiter, withRetry } from '@/lib/ratelimit/limiter';
import { stableHash } from '@/lib/hash';
import type { CollectedSignals } from '@/lib/harmony/signals';

export interface AnalyzeRepo {
  full_name: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
  stars: number;
  license: string | null;
}

export interface LlmOutput<T> {
  data: T;
  input_hash: string;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string;
  prompt_version: string;
}

function signalFingerprint(sig: CollectedSignals) {
  return {
    ohpm: sig.ohpm_matched,
    oh: sig.has_oh_package,
    proj: sig.has_build_profile || sig.has_module_json5 || sig.has_hvigor || sig.has_entry_dir,
    ets: sig.has_ets,
    reg: sig.in_registry,
    kw: Math.round(sig.keyword_score * 4),
  };
}

export function classifyInputHash(repo: AnalyzeRepo, sig: CollectedSignals): string {
  return stableHash({
    v: PROMPT_VERSION,
    m: CLASSIFY_MODEL_NAME,
    tier: 1,
    full: repo.full_name,
    desc: repo.description,
    lang: repo.primary_language,
    topics: [...repo.topics].sort(),
    sig: signalFingerprint(sig),
  });
}

export async function classifyRepo(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
): Promise<LlmOutput<ClassifyResult>> {
  const result = await withRetry(
    () =>
      llmLimiter.schedule(() =>
        generateObject({
          model: classifyModel(),
          schema: classifySchema,
          // qwen3.x 为思考模型,不支持 tool_choice=required;改用 JSON 模式输出结构化结果。
          mode: 'json',
          system: systemPrompt(1),
          prompt: buildUserPrompt(repo, sig),
          maxRetries: 1,
        }),
      ),
    { retries: 2, label: `classify ${repo.full_name}` },
  );
  const usage = result.usage as Record<string, number> | undefined;
  return {
    data: result.object,
    input_hash: classifyInputHash(repo, sig),
    tokens_in: usage?.promptTokens ?? usage?.inputTokens ?? null,
    tokens_out: usage?.completionTokens ?? usage?.outputTokens ?? null,
    model: CLASSIFY_MODEL_NAME,
    prompt_version: PROMPT_VERSION,
  };
}
