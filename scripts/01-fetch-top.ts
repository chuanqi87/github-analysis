// 阶段1:枚举 Star>=10000 的仓库(star 区间分段),upsert 到 repositories。
import 'dotenv/config';
import { enumerateTopRepos, fetchTopN, type SearchRepo } from '@/lib/github/search';
import { upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, type StageOpts } from '@/scripts/_common';

function toRow(r: SearchRepo) {
  return {
    id: r.id,
    full_name: r.full_name,
    owner: r.owner,
    name: r.name,
    description: r.description,
    homepage: r.homepage,
    primary_language: r.primary_language,
    stars: r.stars,
    forks: r.forks,
    open_issues: r.open_issues,
    topics: r.topics,
    license: r.license,
    pushed_at: r.pushed_at,
    repo_created_at: r.repo_created_at,
  };
}

export async function runFetchTop(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('fetch-top');
  try {
    log(opts.limit ? `抓取 top ${opts.limit}` : '全量枚举 stars>=10000(分段)');
    const repos = opts.limit
      ? await fetchTopN(opts.limit)
      : await enumerateTopRepos(10000, (m) => log(m));
    log(`共 ${repos.length} 个仓库,写入 repositories...`);
    await upsertBatched('repositories', repos.map(toRow), { onConflict: 'id' });
    await finishRun(runId, 'success', { count: repos.length });
    log(`fetch-top 完成:${repos.length} 条`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFetchTop().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
