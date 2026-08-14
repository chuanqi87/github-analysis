// 阶段:DeepWiki 代码事实采集。跑在 mark-archived 之后、LLM 之前 ——
// 让 tier-1/tier-2 拿到真实代码结构,而不是靠 README 猜。
//
// 两档取数(见 docs/deepwiki-redesign.md §4.2):
//   目录档:全部候选取 read_wiki_structure(~1s/仓,免费,能看出模块构成)
//   证据档:top-N(--evidence-limit,默认 200)再加两问(~15s/仓)
//
// 幂等键挂 pushed_at:仓库没有新 commit 就不重问 —— DeepWiki 的索引也不会变。
import 'dotenv/config';
import { collectDeepwiki, QUESTION_VERSION, type CollectDepth } from '@/lib/deepwiki';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { stableHash } from '@/lib/hash';
import { log, pMap, type StageOpts } from '@/scripts/_common';
import { loadStageRepos, type StageRepo } from '@/scripts/_data';

/** 默认给多少个仓库做定向提问。其余只取目录。 */
const DEFAULT_EVIDENCE_LIMIT = 200;

export function deepwikiInputHash(repo: StageRepo, depth: CollectDepth): string {
  return stableHash({
    v: QUESTION_VERSION,
    full: repo.full_name,
    // 仓库没新提交 → DeepWiki 索引不变 → 不必重问
    pushed: repo.pushed_at,
    depth,
  });
}

interface ExistingDeepwikiCache {
  inputHash: string;
  questionVersion: string;
  depth: CollectDepth;
  sourcePushedAt: string | null;
}

const DEPTH_RANK: Record<CollectDepth, number> = { toc: 1, evidence: 2, deep: 3 };

async function loadExistingHashes(ids: number[]): Promise<Map<number, ExistingDeepwikiCache>> {
  const client = getAdminClient();
  const map = new Map<number, ExistingDeepwikiCache>();
  // PostgREST 默认 1000 行上限,按 800 分块(与 _data.ts 一致)
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('deepwiki_analysis')
      .select('repository_id,input_hash,question_version,depth,source_pushed_at')
      .in('repository_id', chunk);
    if (error) throw new Error(`加载 deepwiki_analysis 失败:${error.message}`);
    for (const r of (data ?? []) as {
      repository_id: number;
      input_hash: string;
      question_version: string;
      depth: CollectDepth;
      source_pushed_at: string | null;
    }[]) {
      map.set(r.repository_id, {
        inputHash: r.input_hash,
        questionVersion: r.question_version,
        depth: r.depth,
        sourcePushedAt: r.source_pushed_at,
      });
    }
  }
  return map;
}

export async function runDeepwiki(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('deepwiki');
  try {
    const all = await loadStageRepos(opts);
    // 归档仓库不做深度取数(与 LLM 阶段同样的省成本逻辑)
    const active = all.filter((r) => !r.is_archived);
    const archivedCount = all.length - active.length;
    if (archivedCount > 0) log(`跳过 ${archivedCount} 个已归档仓库`);

    // loadStageRepos 已按 star 降序,取前 N 做证据档
    const evidenceLimit = opts.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    const depthFor = (idx: number): CollectDepth => (idx < evidenceLimit ? 'evidence' : 'toc');

    const existing = opts.force
      ? new Map<number, ExistingDeepwikiCache>()
      : await loadExistingHashes(active.map((r) => r.id));

    log(
      `DeepWiki 取数:${active.length} 个仓库(前 ${Math.min(evidenceLimit, active.length)} 个做定向提问)…`,
    );

    let fetched = 0;
    let notIndexed = 0;
    let skipped = 0;
    let failed = 0;
    const rows: Record<string, unknown>[] = [];

    await pMap(
      active,
      async (repo, idx) => {
        const depth = depthFor(idx);
        const hash = deepwikiInputHash(repo, depth);
        const cached = existing.get(repo.id);
        const cacheCoversRequest =
          cached?.questionVersion === QUESTION_VERSION &&
          cached.sourcePushedAt === repo.pushed_at &&
          DEPTH_RANK[cached.depth] >= DEPTH_RANK[depth];
        if (cached?.inputHash === hash || cacheCoversRequest) {
          skipped++;
          return;
        }
        try {
          const f = await collectDeepwiki(repo.full_name, depth);
          if (!f.indexed) notIndexed++;
          else fetched++;

          rows.push({
            repository_id: repo.id,
            indexed: f.indexed,
            wiki_toc: f.wiki_toc,
            harmony_scope: f.harmony?.harmony_scope ?? null,
            harmony_paths: f.harmony?.harmony_paths ?? null,
            harmony_quote: f.harmony?.harmony_quote ?? null,
            harmony_declares_support: f.harmony?.declares_harmony_support ?? null,
            ohos_imports: f.harmony?.ohos_imports ?? null,
            project_type: f.porting?.project_type ?? null,
            languages: f.porting?.languages ?? null,
            native_code_ratio: f.porting?.native_code_ratio ?? null,
            has_platform_abstraction: f.porting?.has_platform_abstraction ?? null,
            platform_layer_paths: f.porting?.platform_layer_paths ?? null,
            existing_platform_backends: f.porting?.existing_platform_backends ?? null,
            portable_core_paths: f.porting?.portable_core_paths ?? null,
            blocking_deps: f.porting?.blocking_deps ?? null,
            platform_apis_used: f.porting?.platform_apis_used ?? null,
            conditional_compilation: f.porting?.conditional_compilation ?? null,
            extra: f.extra,
            raw_answers: f.raw_answers,
            question_version: QUESTION_VERSION,
            depth,
            source_pushed_at: repo.pushed_at,
            input_hash: hash,
            fetched_at: new Date().toISOString(),
          });

          if ((fetched + notIndexed) % 25 === 0) {
            log(`  已取数 ${fetched + notIndexed}/${active.length}(未索引 ${notIndexed})`);
          }
        } catch (err) {
          failed++;
          log(`  取数失败 ${repo.full_name}: ${String(err).slice(0, 120)}`);
        }
      },
      // collectDeepwiki 内部还会并发发问,外层保守一些;
      // 全局并发最终由 deepwikiLimiter(maxConcurrent 5)兜底
      4,
    );

    await upsertBatched('deepwiki_analysis', rows, { onConflict: 'repository_id' });
    await finishRun(runId, 'success', { fetched, notIndexed, skipped, failed, archived: archivedCount });
    log(
      `deepwiki 完成:取数 ${fetched}、未索引 ${notIndexed}、跳过 ${skipped}、失败 ${failed}、归档 ${archivedCount}`,
    );
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeepwiki().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
