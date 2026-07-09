// 管道编排器:pnpm pipeline --stage=<stage> [--limit=N] [--ids=1,2] [--force]
//
// stages: fetch-top | enrich | harmony-signals | fetch-readme | llm-classify
//         | llm-evaluate | score | daily-trending | build-registry | all
import 'dotenv/config';
import { parseArgs, log, type StageOpts } from '@/scripts/_common';
import { runFetchTop } from '@/scripts/01-fetch-top';
import { runEnrich } from '@/scripts/02-enrich';
import { runHarmonySignals } from '@/scripts/03-harmony-signals';
import { runFetchReadme } from '@/scripts/04-fetch-readme';
import { runLlmClassify } from '@/scripts/05-llm-classify';
import { runLlmEvaluate } from '@/scripts/06-llm-evaluate';
import { runScore } from '@/scripts/07-score';
import { runDailyTrending } from '@/scripts/daily-trending';
import { runBuildRegistry } from '@/scripts/build-registry';

const STAGES: Record<string, (opts: StageOpts) => Promise<void>> = {
  'fetch-top': runFetchTop,
  enrich: runEnrich,
  'harmony-signals': runHarmonySignals,
  'fetch-readme': runFetchReadme,
  'llm-classify': runLlmClassify,
  'llm-evaluate': runLlmEvaluate,
  score: runScore,
  'daily-trending': runDailyTrending,
  'build-registry': () => runBuildRegistry(),
};

const FULL_ORDER = [
  'fetch-top',
  'enrich',
  'build-registry',
  'harmony-signals',
  'fetch-readme',
  'llm-classify',
  'llm-evaluate',
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

  const fn = STAGES[stage];
  if (!fn) {
    console.error(`未知阶段:${stage}。可选:${Object.keys(STAGES).join(', ')}, all`);
    process.exit(1);
  }
  await fn(opts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
