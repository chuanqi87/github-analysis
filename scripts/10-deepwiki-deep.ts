// 阶段:tier-3 深度评估(DeepWiki 逐子系统问询 + 一次结构化定级)。
//
// 取代原 scripts/agent/ 的 tarball 下载 + 30 轮采样。不进 FULL_ORDER ——
// tier-3 是按需深挖,由 code-analysis.yml 或手动对 top-N / 指定 ids 触发。
//
// 未被 DeepWiki 索引的仓库在这里会被跳过并列出,交给 scripts/agent/ 的兜底路径。
import 'dotenv/config';
import { collectDeepwiki } from '@/lib/deepwiki';
import { deepEvaluateRepo, deepEvaluateInputHash, DEEP_PROMPT_VERSION } from '@/lib/llm/deep-evaluate';
import type { AnalyzeRepo } from '@/lib/llm/classify';
import { resolveAndCreateCategory } from '@/lib/llm/resolve-category';
import { loadCategoryTree } from '@/lib/category/loader';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';
import { loadStageRepos, loadSignalsMap, signalsFor } from '@/scripts/_data';
import { refreshAnalysisQueue, selectTier3Candidates } from '@/lib/pipeline/candidates';
import { EVALUATE_MODEL_NAME } from '@/lib/llm/provider';

/** tier-3 成本比 tier-2 高(7 问 + 强模型),默认只做 top-30。 */
const DEFAULT_LIMIT = 30;

async function loadExistingHashes(ids: number[]): Promise<Map<number, string>> {
  const client = getAdminClient();
  const map = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('analysis')
      .select('repository_id, input_hash')
      .eq('tier', 3)
      .eq('prompt_version', DEEP_PROMPT_VERSION)
      .eq('model', EVALUATE_MODEL_NAME)
      .in('repository_id', chunk);
    if (error) throw new Error(`加载 tier3 analysis 失败:${error.message}`);
    for (const r of (data ?? []) as { repository_id: number; input_hash: string }[]) {
      map.set(r.repository_id, r.input_hash);
    }
  }
  return map;
}

export async function runDeepwikiDeep(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('deepwiki-deep');
  try {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    if (!opts.ids?.length) await refreshAnalysisQueue();
    const selectedIds = opts.ids?.length ? opts.ids : await selectTier3Candidates(limit);
    const all = await loadStageRepos({ ids: selectedIds });
    const active = all.filter((r) => !r.is_archived);
    // 候选池已排除现有 tier-3，并按热点 + 鸿蒙价值排序；这里不再从 Star 榜首反复截断。
    const candidates = active.slice(0, limit);

    const ids = candidates.map((r) => r.id);
    const signals = await loadSignalsMap(ids);
    const existing = opts.force ? new Map<number, string>() : await loadExistingHashes(ids);

    const adminClient = getAdminClient();
    const categoryTree = await loadCategoryTree(adminClient);

    log(`tier-3 深度评估 ${candidates.length} 个候选(DeepWiki 逐子系统问询 + 百炼定级)…`);

    let analyzed = 0;
    let skipped = 0;
    let failed = 0;
    let newCategories = 0;
    const notIndexed: string[] = [];
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

        try {
          // 深度档:7 问并发,约 15s
          const facts = await collectDeepwiki(repo.full_name, 'deep');
          if (!facts.indexed) {
            notIndexed.push(repo.full_name);
            return;
          }

          const hash = deepEvaluateInputHash(analyzeRepo, sig, repo.readme_text, facts);
          if (existing.get(repo.id) === hash) {
            skipped++;
            return;
          }

          const out = await deepEvaluateRepo(
            analyzeRepo,
            sig,
            repo.readme_text,
            categoryTree,
            facts,
          );

          const resolved = await resolveAndCreateCategory(adminClient, categoryTree, out.data);
          if (resolved.created_new) newCategories++;

          rows.push({
            repository_id: repo.id,
            tier: 3,
            model: out.model,
            prompt_version: out.prompt_version,
            input_hash: out.input_hash,
            category_id: resolved.category_id,
            subcategory_id: resolved.subcategory_id,
            category: resolved.category_enum,
            subcategory: out.data.subcategory || '',
            harmony_suggestion: out.data.harmony_suggestion,
            mobile_relevance: out.data.mobile_relevance,
            feasibility: out.data.feasibility,
            effort_estimate: out.data.effort_estimate,
            ecosystem_gap: out.data.ecosystem_gap,
            adaptation_points: out.data.adaptation_points,
            recommended_approach: out.data.recommended_approach,
            reasoning: out.data.reasoning,
            harmony_adapted_repo_url: out.data.harmony_adapted_repo_url,
            confidence: out.data.confidence,
            tokens_in: out.tokens_in,
            tokens_out: out.tokens_out,
            analyzed_at: new Date().toISOString(),
          });
          analyzed++;
          log(`  已深挖 ${analyzed}/${candidates.length}:${repo.full_name}`);
        } catch (err) {
          failed++;
          log(`  深挖失败 ${repo.full_name}: ${String(err).slice(0, 120)}`);
        }
      },
      // DeepWiki 深度档本身已并发 7 问,外层压到 2 避免叠乘
      2,
    );

    await upsertBatched('analysis', rows, { onConflict: 'repository_id,tier,prompt_version,model' });

    if (notIndexed.length) {
      log(
        `以下 ${notIndexed.length} 个仓库 DeepWiki 未索引,需走 scripts/agent/ tarball 兜底:\n  ` +
          notIndexed.join('\n  '),
      );
    }

    await finishRun(runId, 'success', {
      analyzed,
      skipped,
      failed,
      newCategories,
      not_indexed: notIndexed,
    });
    log(
      `deepwiki-deep 完成:深挖 ${analyzed}、跳过 ${skipped}、失败 ${failed}、未索引 ${notIndexed.length}、新建分类 ${newCategories}`,
    );
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeepwikiDeep().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
