// 阶段6:tier-2 LLM 深度评估(候选:有 tier-1 结果、按 star 取 top-N),带 README。
import 'dotenv/config';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { evaluateRepo, evaluateInputHash } from '@/lib/llm/evaluate';
import type { AnalyzeRepo } from '@/lib/llm/classify';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';
import { loadStageRepos, loadSignalsMap, signalsFor } from '@/scripts/_data';

async function loadTier1Ids(): Promise<Set<number>> {
  const client = getAdminClient();
  const set = new Set<number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('analysis')
      .select('repository_id')
      .eq('tier', 1)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`加载 tier1 集合失败:${error.message}`);
    const rows = (data ?? []) as { repository_id: number }[];
    rows.forEach((r) => set.add(r.repository_id));
    if (rows.length < pageSize) break;
  }
  return set;
}

async function loadExistingHashes(ids: number[]): Promise<Map<number, string>> {
  const client = getAdminClient();
  const map = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('analysis')
      .select('repository_id, input_hash')
      .eq('tier', 2)
      .in('repository_id', chunk);
    if (error) throw new Error(`加载 tier2 analysis 失败:${error.message}`);
    for (const r of (data ?? []) as { repository_id: number; input_hash: string }[]) {
      map.set(r.repository_id, r.input_hash);
    }
  }
  return map;
}

export async function runLlmEvaluate(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('llm-evaluate');
  try {
    const tier1 = await loadTier1Ids();
    const all = await loadStageRepos({ ...opts, limit: undefined });
    const limit = opts.limit ?? 100;
    const candidates = all.filter((r) => tier1.has(r.id)).slice(0, limit);

    const ids = candidates.map((r) => r.id);
    const signals = await loadSignalsMap(ids);
    const existing = opts.force ? new Map<number, string>() : await loadExistingHashes(ids);
    log(`tier-2 深评 ${candidates.length} 个候选(百炼)...`);

    let analyzed = 0;
    let skipped = 0;
    let failed = 0;
    const rows: Record<string, unknown>[] = [];

    await pMap(
      candidates,
      async (repo) => {
        const sig = signalsFor(signals, repo.id);
        const analyzeRepo: AnalyzeRepo = {
          full_name: repo.full_name,
          description: repo.description,
          primary_language: repo.primary_language,
          topics: repo.topics,
          stars: repo.stars,
          license: repo.license,
        };
        const hash = evaluateInputHash(analyzeRepo, sig, repo.readme_text);
        if (existing.get(repo.id) === hash) {
          skipped++;
          return;
        }
        try {
          const out = await evaluateRepo(analyzeRepo, sig, repo.readme_text);
          rows.push({
            repository_id: repo.id,
            tier: 2,
            model: out.model,
            prompt_version: out.prompt_version,
            input_hash: out.input_hash,
            category: out.data.category,
            subcategory: out.data.subcategory,
            harmony_suggestion: out.data.harmony_suggestion,
            mobile_relevance: out.data.mobile_relevance,
            feasibility: out.data.feasibility,
            effort_estimate: out.data.effort_estimate,
            ecosystem_gap: out.data.ecosystem_gap,
            adaptation_points: out.data.adaptation_points,
            recommended_approach: out.data.recommended_approach,
            reasoning: out.data.reasoning,
            confidence: out.data.confidence,
            tokens_in: out.tokens_in,
            tokens_out: out.tokens_out,
          });
          analyzed++;
          if (analyzed % 20 === 0) log(`  已深评 ${analyzed}`);
        } catch (err) {
          failed++;
          log(`  深评失败 ${repo.full_name}: ${String(err).slice(0, 120)}`);
        }
      },
      4,
    );

    await upsertBatched('analysis', rows, { onConflict: 'repository_id,tier,prompt_version,model' });
    await finishRun(runId, 'success', { analyzed, skipped, failed });
    log(`llm-evaluate 完成:深评 ${analyzed}、跳过 ${skipped}、失败 ${failed}`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLlmEvaluate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
