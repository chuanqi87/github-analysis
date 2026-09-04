// 阶段:tier-3 深度评估(DeepWiki 逐子系统问询 + 一次结构化定级)。
//
// 取代原 scripts/agent/ 的 tarball 下载 + 30 轮采样。不进 FULL_ORDER ——
// tier-3 是按需深挖,由 code-analysis.yml 或手动对 top-N / 指定 ids 触发。
//
// 未被 DeepWiki 索引的仓库在这里会被跳过并列出,交给 scripts/agent/ 的兜底路径。
import 'dotenv/config';
import { collectDeepwiki, deepEvidenceCoverage, QUESTION_VERSION, type DeepwikiFacts } from '@/lib/deepwiki';
import {
  deepEvaluateRepo,
  deepEvaluateInputHash,
  DEEP_PROMPT_VERSION,
  type OpportunityEvaluationSeed,
} from '@/lib/llm/deep-evaluate';
import type { AnalyzeRepo } from '@/lib/llm/classify';
import { resolveAndCreateCategory } from '@/lib/llm/resolve-category';
import { loadCategoryTree } from '@/lib/category/loader';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { assertAnalysisSchema } from '@/lib/pipeline/schema-check';
import { log, pMap, type StageOpts } from '@/scripts/_common';
import { loadStageRepos, loadSignalsMap, signalsFor } from '@/scripts/_data';
import { refreshAnalysisQueue, selectTier3Candidates } from '@/lib/pipeline/candidates';
import { EVALUATE_MODEL_NAME } from '@/lib/llm/provider';
import { stableHash } from '@/lib/hash';
import { PROMPT_VERSION } from '@/lib/llm/prompts';
import { scoreRepositoryOpportunities } from '@/lib/scoring/opportunity';
import {
  buildEvidenceSnapshot,
  captureAnalysisExecution,
  flushAnalysisExecutionLogs,
  type AnalysisExecutionRow,
} from '@/lib/pipeline/analysis-log';
import { loadHistoricalAnalysisContexts } from '@/lib/llm/history-context';

/** tier-3 成本比 tier-2 高(7 问 + 强模型),默认只做 top-30。 */
const DEFAULT_LIMIT = 30;
const CACHE_DEPTH_RANK = { toc: 1, evidence: 2, deep: 3 } as const;

interface DeepwikiCacheState {
  depth: keyof typeof CACHE_DEPTH_RANK;
  question_version: string;
  source_pushed_at: string | null;
}

async function loadDeepwikiCacheState(ids: number[]): Promise<Map<number, DeepwikiCacheState>> {
  const result = new Map<number, DeepwikiCacheState>();
  const client = getAdminClient();
  for (let offset = 0; offset < ids.length; offset += 800) {
    const { data, error } = await client
      .from('deepwiki_analysis')
      .select('repository_id,depth,question_version,source_pushed_at')
      .in('repository_id', ids.slice(offset, offset + 800));
    if (error) throw new Error(`加载 DeepWiki 缓存深度失败:${error.message}`);
    for (const row of (data ?? []) as (DeepwikiCacheState & { repository_id: number })[]) {
      result.set(row.repository_id, row);
    }
  }
  return result;
}

function deepwikiCacheRow(
  repositoryId: number,
  pushedAt: string | null,
  inputHash: string,
  facts: DeepwikiFacts,
): Record<string, unknown> {
  const coverage = deepEvidenceCoverage(facts);
  const depth = coverage.complete ? 'deep' : coverage.core === 2 ? 'evidence' : 'toc';
  return {
    repository_id: repositoryId,
    indexed: facts.indexed,
    wiki_toc: facts.wiki_toc,
    harmony_scope: facts.harmony?.harmony_scope ?? null,
    harmony_paths: facts.harmony?.harmony_paths ?? null,
    harmony_quote: facts.harmony?.harmony_quote ?? null,
    harmony_declares_support: facts.harmony?.declares_harmony_support ?? null,
    ohos_imports: facts.harmony?.ohos_imports ?? null,
    project_type: facts.porting?.project_type ?? null,
    languages: facts.porting?.languages ?? null,
    native_code_ratio: facts.porting?.native_code_ratio ?? null,
    has_platform_abstraction: facts.porting?.has_platform_abstraction ?? null,
    platform_layer_paths: facts.porting?.platform_layer_paths ?? null,
    existing_platform_backends: facts.porting?.existing_platform_backends ?? null,
    portable_core_paths: facts.porting?.portable_core_paths ?? null,
    blocking_deps: facts.porting?.blocking_deps ?? null,
    platform_apis_used: facts.porting?.platform_apis_used ?? null,
    conditional_compilation: facts.porting?.conditional_compilation ?? null,
    extra: facts.extra,
    raw_answers: facts.raw_answers,
    question_version: QUESTION_VERSION,
    depth,
    source_pushed_at: pushedAt,
    input_hash: inputHash,
    fetched_at: new Date().toISOString(),
  };
}

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

async function loadTier2OpportunitySeeds(ids: number[]): Promise<Map<number, OpportunityEvaluationSeed>> {
  const client = getAdminClient();
  const result = new Map<number, OpportunityEvaluationSeed>();
  for (let offset = 0; offset < ids.length; offset += 800) {
    const { data, error } = await client
      .from('analysis')
      .select('repository_id,opportunity_verdict,adaptation_points,recommended_approach')
      .eq('tier', 2)
      .eq('prompt_version', PROMPT_VERSION)
      .eq('model', EVALUATE_MODEL_NAME)
      .in('repository_id', ids.slice(offset, offset + 800));
    if (error) throw new Error(`加载 tier-2 结合机会失败:${error.message}`);
    for (const row of (data ?? []) as Array<{
      repository_id: number;
      opportunity_verdict: OpportunityEvaluationSeed['opportunity_verdict'];
      adaptation_points: OpportunityEvaluationSeed['opportunities'] | null;
      recommended_approach: string | null;
    }>) {
      result.set(row.repository_id, {
        opportunity_verdict: row.opportunity_verdict,
        opportunities: row.adaptation_points ?? [],
        recommended_approach: row.recommended_approach,
      });
    }
  }
  return result;
}

export async function runDeepwikiDeep(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('deepwiki-deep');
  try {
    await assertAnalysisSchema();
    const limit = opts.limit ?? DEFAULT_LIMIT;
    if (!opts.ids?.length) await refreshAnalysisQueue();
    // 多取一倍后备候选：未索引、证据不足或模型失败时继续向后补，尽量兑现每日配额。
    const selectedIds = opts.ids?.length ? opts.ids : await selectTier3Candidates(limit * 2);
    const all = await loadStageRepos({ ids: selectedIds });
    const active = all.filter((r) => !r.is_archived);
    // 候选池已排除现有 tier-3，并按热点 + 鸿蒙价值排序；这里不再从 Star 榜首反复截断。
    const candidates = active;

    const ids = candidates.map((r) => r.id);
    const signals = await loadSignalsMap(ids);
    const existing = opts.force ? new Map<number, string>() : await loadExistingHashes(ids);
    const tier2Seeds = await loadTier2OpportunitySeeds(ids);
    const deepwikiCache = await loadDeepwikiCacheState(ids);
    const historyContexts = await loadHistoricalAnalysisContexts(candidates.map((repo) => ({
      id: repo.id,
      owner: repo.owner,
      full_name: repo.full_name,
      primary_language: repo.primary_language,
      topics: repo.topics,
    })));

    const adminClient = getAdminClient();
    const categoryTree = await loadCategoryTree(adminClient);

    log(`tier-3 目标 ${limit} 个，准备 ${candidates.length} 个候选(含证据不足/失败后备)…`);

    let analyzed = 0;
    let skipped = 0;
    let failed = 0;
    let newCategories = 0;
    const notIndexed: string[] = [];
    const insufficientEvidence: string[] = [];
    const rows: Record<string, unknown>[] = [];
    const deepwikiRows: Record<string, unknown>[] = [];
    const executionRows: AnalysisExecutionRow[] = [];

    const analyzeCandidate = async (repo: (typeof candidates)[number]) => {
        const attemptStartedAt = new Date().toISOString();
        const sig = signalsFor(signals, repo.id);
        const analyzeRepo: AnalyzeRepo = {
          full_name: repo.full_name,
          description: repo.description,
          primary_language: repo.primary_language,
          topics: repo.topics,
          stars: repo.stars,
          license: repo.license,
        };
        const priorEvaluation = tier2Seeds.get(repo.id) ?? null;
        const history = historyContexts.get(repo.id) ?? [];

        try {
          // 深度档:7 问并发,约 15s
          const facts = await collectDeepwiki(repo.full_name, 'deep');
          const deepwikiHash = stableHash({
            v: QUESTION_VERSION,
            full: repo.full_name,
            pushed: repo.pushed_at,
            depth: 'deep',
          });
          const cacheRow = deepwikiCacheRow(repo.id, repo.pushed_at, deepwikiHash, facts);
          const previousCache = deepwikiCache.get(repo.id);
          const newDepth = cacheRow.depth as keyof typeof CACHE_DEPTH_RANK;
          const preservesNewerDepth =
            previousCache?.question_version === QUESTION_VERSION &&
            previousCache.source_pushed_at === repo.pushed_at &&
            CACHE_DEPTH_RANK[previousCache.depth] > CACHE_DEPTH_RANK[newDepth];
          if (!preservesNewerDepth) deepwikiRows.push(cacheRow);
          if (!facts.indexed) {
            notIndexed.push(repo.full_name);
            skipped++;
            executionRows.push(captureAnalysisExecution({
              pipelineRunId: runId,
              repositoryId: repo.id,
              repositoryName: repo.full_name,
              tier: 3,
              status: 'skipped',
              model: EVALUATE_MODEL_NAME,
              promptVersion: DEEP_PROMPT_VERSION,
              evidence: buildEvidenceSnapshot(sig, facts, repo.readme_text),
              error: 'DeepWiki 未索引',
              startedAt: attemptStartedAt,
            }));
            return;
          }

          const coverage = deepEvidenceCoverage(facts);
          if (!coverage.complete) {
            insufficientEvidence.push(repo.full_name);
            skipped++;
            executionRows.push(captureAnalysisExecution({
              pipelineRunId: runId,
              repositoryId: repo.id,
              repositoryName: repo.full_name,
              tier: 3,
              status: 'skipped',
              model: EVALUATE_MODEL_NAME,
              promptVersion: DEEP_PROMPT_VERSION,
              evidence: {
                ...buildEvidenceSnapshot(sig, facts, repo.readme_text),
                coverage,
              },
              error: `代码证据不足:核心 ${coverage.core}/2，子系统 ${coverage.subsystems}/${coverage.expectedSubsystems}`,
              startedAt: attemptStartedAt,
            }));
            log(`  换下 ${repo.full_name}:代码证据不足(核心 ${coverage.core}/2，子系统 ${coverage.subsystems}/${coverage.expectedSubsystems})`);
            return;
          }

          const hash = deepEvaluateInputHash(analyzeRepo, sig, repo.readme_text, facts, priorEvaluation, history);
          if (existing.get(repo.id) === hash) {
            skipped++;
            executionRows.push(captureAnalysisExecution({
              pipelineRunId: runId,
              repositoryId: repo.id,
              repositoryName: repo.full_name,
              tier: 3,
              status: 'skipped',
              model: EVALUATE_MODEL_NAME,
              promptVersion: DEEP_PROMPT_VERSION,
              inputHash: hash,
              evidence: buildEvidenceSnapshot(sig, facts, repo.readme_text),
              startedAt: attemptStartedAt,
            }));
            return;
          }

          const out = await deepEvaluateRepo(
            analyzeRepo,
            sig,
            repo.readme_text,
            categoryTree,
            facts,
            priorEvaluation,
            history,
          );

          const resolved = await resolveAndCreateCategory(adminClient, categoryTree, out.data);
          if (resolved.created_new) newCategories++;
          const opportunityScore = scoreRepositoryOpportunities(out.data.opportunities);

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
            harmony_suggestion: null,
            mobile_relevance: out.data.client_relevance,
            feasibility: out.data.feasibility,
            effort_estimate: out.data.effort_estimate,
            ecosystem_gap: out.data.ecosystem_gap,
            harmony_leverage: out.data.harmony_leverage,
            opportunity_verdict: out.data.opportunity_verdict,
            opportunity_score: opportunityScore,
            adaptation_points: out.data.opportunities,
            analysis_details: out.data.analysis_details,
            recommended_approach: out.data.recommended_approach,
            reasoning: out.data.reasoning,
            project_summary_cn: out.data.project_summary_cn,
            confidence: out.data.confidence,
            tokens_in: out.tokens_in,
            tokens_out: out.tokens_out,
            analyzed_at: new Date().toISOString(),
          });
          executionRows.push(captureAnalysisExecution({
            pipelineRunId: runId,
            repositoryId: repo.id,
            repositoryName: repo.full_name,
            tier: 3,
            status: 'success',
            model: out.model,
            promptVersion: out.prompt_version,
            inputHash: out.input_hash,
            trace: out.trace,
            evidence: buildEvidenceSnapshot(sig, facts, repo.readme_text),
            output: out.data,
            tokensIn: out.tokens_in,
            tokensOut: out.tokens_out,
          }));
          analyzed++;
          log(`  已深挖 ${analyzed}/${limit}:${repo.full_name}`);
        } catch (err) {
          failed++;
          executionRows.push(captureAnalysisExecution({
            pipelineRunId: runId,
            repositoryId: repo.id,
            repositoryName: repo.full_name,
            tier: 3,
            status: 'failed',
            model: EVALUATE_MODEL_NAME,
            promptVersion: DEEP_PROMPT_VERSION,
            evidence: buildEvidenceSnapshot(sig, undefined, repo.readme_text),
            error: String(err),
            startedAt: attemptStartedAt,
          }));
          log(`  深挖失败 ${repo.full_name}: ${String(err).slice(0, 120)}`);
        }
    };

    // 每批最多 2 个；接近目标时按剩余名额缩小批次，避免并发越过 quota。
    let candidateOffset = 0;
    while (candidateOffset < candidates.length && analyzed < limit) {
      const batchSize = Math.min(2, limit - analyzed);
      const batch = candidates.slice(candidateOffset, candidateOffset + batchSize);
      candidateOffset += batch.length;
      await pMap(batch, analyzeCandidate, batch.length);
    }

    await upsertBatched('analysis', rows, { onConflict: 'repository_id,tier,prompt_version,model' });
    await upsertBatched('deepwiki_analysis', deepwikiRows, { onConflict: 'repository_id' });
    await flushAnalysisExecutionLogs(executionRows);

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
      insufficient_evidence: insufficientEvidence,
      target: limit,
      quota_filled: analyzed >= limit,
    });
    log(
      `deepwiki-deep 完成:深挖 ${analyzed}/${limit}、跳过 ${skipped}、失败 ${failed}、` +
        `未索引 ${notIndexed.length}、证据不足 ${insufficientEvidence.length}、新建分类 ${newCategories}`,
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
