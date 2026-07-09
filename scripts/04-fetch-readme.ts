// 阶段4:仅对候选(高 star / 指定 ids)抓取 README,写 repositories.readme_text。
import 'dotenv/config';
import { getReadme } from '@/lib/github/rest';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';

interface RepoRef {
  id: number;
  full_name: string;
  owner: string;
  name: string;
}

async function loadCandidates(opts: StageOpts): Promise<RepoRef[]> {
  const client = getAdminClient();
  let q = client
    .from('repositories')
    .select('id, full_name, owner, name')
    .is('readme_text', null)
    .order('stars', { ascending: false });
  if (opts.ids?.length) q = q.in('id', opts.ids);
  q = q.limit(opts.limit ?? 800);
  const { data, error } = await q;
  if (error) throw new Error(`加载候选失败:${error.message}`);
  return (data ?? []) as RepoRef[];
}

export async function runFetchReadme(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('fetch-readme');
  try {
    const repos = await loadCandidates(opts);
    log(`抓取 ${repos.length} 个候选 README...`);
    let done = 0;
    const nowIso = new Date().toISOString();
    const rows = await pMap(
      repos,
      async (repo) => {
        const readme = await getReadme(repo.owner, repo.name).catch(() => null);
        done++;
        if (done % 100 === 0) log(`  README 进度 ${done}/${repos.length}`);
        return {
          id: repo.id,
          full_name: repo.full_name,
          owner: repo.owner,
          name: repo.name,
          readme_text: readme,
          readme_fetched_at: nowIso,
        };
      },
      6,
    );
    await upsertBatched('repositories', rows, { onConflict: 'id' });
    await finishRun(runId, 'success', { count: rows.length });
    log(`fetch-readme 完成:${rows.length} 条`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFetchReadme().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
