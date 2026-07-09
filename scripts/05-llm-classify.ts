// 阶段5:tier-1 LLM 粗分类(全量),幂等跳过未变化的项目。
import 'dotenv/config';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { classifyRepo, classifyInputHash, type AnalyzeRepo } from '@/lib/llm/classify';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';
import { loadStageRepos, loadSignalsMap, signalsFor } from '@/scripts/_data';

async function loadExistingHashes(ids: number[]): Promise<Map<number, string>> {
  const client = getAdminClient();
  const map = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('analysis')
      .select('repository_id, input_hash')
      .eq('tier', 1)
      .in('repository_id', chunk);
    if (error) throw new Error(`加载 analysis 失败:${error.message}`);
    for (const r of (data ?? []) as { repository_id: number; input_hash: string }[]) {
      map.set(r.repository_id, r.input_hash);
    }
  }
  return map;
}

export async function runLlmClassify(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('llm-classify');
  try {
    const repos = await loadStageRepos(opts);
    const ids = repos.map((r) => r.id);
    const signals = await loadSignalsMap(ids);
    const existing = opts.force ? new Map<number, string>() : await loadExistingHashes(ids);
    log(`tier-1 分类 ${repos.length} 个仓库(百炼)...`);

    let skipped = 0;
    let analyzed = 0;
    let failed = 0;
    const rows: Record<string, unknown>[] = [];

    await pMap(
      repos,
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
        const hash = classifyInputHash(analyzeRepo, sig);
        if (existing.get(repo.id) === hash) {
          skipped++;
          return;
        }
        try {
          const out = await classifyRepo(analyzeRepo, sig);
          rows.push({
            repository_id: repo.id,
            tier: 1,
            model: out.model,
            prompt_version: out.prompt_version,
            input_hash: out.input_hash,
            category: out.data.category,
            harmony_suggestion: out.data.harmony_suggestion,
            mobile_relevance: out.data.mobile_relevance,
            feasibility: out.data.feasibility,
            confidence: out.data.confidence,
            tokens_in: out.tokens_in,
            tokens_out: out.tokens_out,
          });
          analyzed++;
          if (analyzed % 50 === 0) log(`  已分析 ${analyzed}(跳过 ${skipped})`);
        } catch (err) {
          failed++;
          log(`  分类失败 ${repo.full_name}: ${String(err).slice(0, 120)}`);
        }
      },
      6,
    );

    await upsertBatched('analysis', rows, { onConflict: 'repository_id,tier,prompt_version,model' });
    await finishRun(runId, 'success', { analyzed, skipped, failed });
    log(`llm-classify 完成:分析 ${analyzed}、跳过 ${skipped}、失败 ${failed}`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLlmClassify().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
