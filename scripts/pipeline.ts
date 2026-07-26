// 管道编排器:pnpm pipeline --stage=<stage> [--limit=N] [--ids=1,2] [--force]
//
// stages: fetch-top | enrich | harmony-signals | fetch-readme | deepwiki | llm-classify
//         | llm-evaluate | deepwiki-deep | score | weekly-trending | build-registry
//         | mark-archived | all
import 'dotenv/config';
import { parseArgs, log, type StageOpts } from '@/scripts/_common';
import { runFetchTop } from '@/scripts/01-fetch-top';
import { runEnrich } from '@/scripts/02-enrich';
import { runHarmonySignals } from '@/scripts/03-harmony-signals';
import { runFetchReadme } from '@/scripts/04-fetch-readme';
import { runLlmClassify } from '@/scripts/05-llm-classify';
import { runLlmEvaluate } from '@/scripts/06-llm-evaluate';
import { runScore } from '@/scripts/07-score';
import { runMarkArchived } from '@/scripts/08-mark-archived';
import { runDeepwiki } from '@/scripts/09-deepwiki';
import { runDeepwikiDeep } from '@/scripts/10-deepwiki-deep';
import { runWeeklyTrending } from '@/scripts/weekly-trending';
import { runBuildRegistry } from '@/scripts/build-registry';

const STAGES: Record<string, (opts: StageOpts) => Promise<void>> = {
  'fetch-top': runFetchTop,
  enrich: runEnrich,
  'harmony-signals': runHarmonySignals,
  'fetch-readme': runFetchReadme,
  'llm-classify': runLlmClassify,
  'llm-evaluate': runLlmEvaluate,
  score: runScore,
  'weekly-trending': runWeeklyTrending,
  'build-registry': () => runBuildRegistry(),
  'mark-archived': runMarkArchived,
  deepwiki: runDeepwiki,
  // tier-3 按需深挖,不进 FULL_ORDER/SYNC_ORDER
  'deepwiki-deep': runDeepwikiDeep,
};

const FULL_ORDER = [
  'fetch-top',
  'enrich',
  'build-registry',
  // 代码事实采集:必须在 harmony-signals 之前,鸿蒙证据要参与 auto_state_hint 汇总
  'deepwiki',
  'harmony-signals',
  'fetch-readme',
  'mark-archived',   // 在 LLM 分析之前标记归档,避免浪费 token
  'llm-classify',
  'llm-evaluate',
  'score',
] as const;

// 同步模式:仅获取新仓库 + 初步分析,不含 LLM 深度分析
// 用于定时调度,确保跟踪 Star>=10000 的新项目
const SYNC_ORDER = [
  'fetch-top',
  'enrich',
  'build-registry',
  // DeepWiki 不烧 token,且幂等键挂 pushed_at,同步模式下只会为新增/有新提交的仓库取数
  'deepwiki',
  'harmony-signals',
  'fetch-readme',
  'mark-archived',
  'score',
] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stage = args.stage ?? 'all';
  const opts: StageOpts = { limit: args.limit, since: args.since, force: args.force, ids: args.ids };

  if (stage === 'all') {
    log(`运行全流程(limit=${opts.limit ?? '全量'})`);
    for (const s of FULL_ORDER) {
      log(`==== 阶段:${s} ====`);
      await STAGES[s](opts);
    }
    log('全流程完成');
    return;
  }

  if (stage === 'sync') {
    log(`运行同步模式:获取新仓库 + 初步分析(不含 LLM)`);
    for (const s of SYNC_ORDER) {
      log(`==== 阶段:${s} ====`);
      await STAGES[s](opts);
    }
    log('同步完成');
    return;
  }

  const fn = STAGES[stage];
  if (!fn) {
    console.error(`未知阶段:${stage}。可选:${Object.keys(STAGES).join(', ')}, all, sync`);
    process.exit(1);
  }
  await fn(opts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
