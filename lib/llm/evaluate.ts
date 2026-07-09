// tier-2 深度评估:候选项目,更强模型 + README,产出适配点与推荐路径。
import { generateObject } from 'ai';
import { evaluateModel, EVALUATE_MODEL_NAME } from '@/lib/llm/provider';
import { evaluateSchema, type EvaluateResult } from '@/lib/llm/schema';
import { systemPrompt, buildUserPrompt, PROMPT_VERSION } from '@/lib/llm/prompts';
import { llmLimiter, withRetry } from '@/lib/ratelimit/limiter';
import { stableHash } from '@/lib/hash';
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { AnalyzeRepo, LlmOutput } from '@/lib/llm/classify';

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

export function evaluateInputHash(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
  readme: string | null,
): string {
  return stableHash({
    v: PROMPT_VERSION,
    m: EVALUATE_MODEL_NAME,
    tier: 2,
    full: repo.full_name,
    desc: repo.description,
    lang: repo.primary_language,
    topics: [...repo.topics].sort(),
    sig: signalFingerprint(sig),
    readme: readme ? stableHash(readme) : null,
  });
}

export async function evaluateRepo(
  repo: AnalyzeRepo,
  sig: CollectedSignals,
  readme: string | null,
): Promise<LlmOutput<EvaluateResult>> {
  const result = await withRetry(
    () =>
      llmLimiter.schedule(() =>
        generateObject({
          model: evaluateModel(),
          schema: evaluateSchema,
          // qwen3.x 为思考模型,不支持 tool_choice=required;改用 JSON 模式输出结构化结果。
          mode: 'json',
          system: systemPrompt(2),
          prompt: buildUserPrompt(repo, sig, readme),
          maxRetries: 1,
        }),
      ),
    { retries: 2, label: `evaluate ${repo.full_name}` },
  );
  const usage = result.usage as Record<string, number> | undefined;
  return {
    data: result.object,
    input_hash: evaluateInputHash(repo, sig, readme),
    tokens_in: usage?.promptTokens ?? usage?.inputTokens ?? null,
    tokens_out: usage?.completionTokens ?? usage?.outputTokens ?? null,
    model: EVALUATE_MODEL_NAME,
    prompt_version: PROMPT_VERSION,
  };
}
