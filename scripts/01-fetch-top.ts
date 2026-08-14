// 阶段1:枚举 Star>=10000 的仓库(star 区间分段),upsert 到 repositories。
import 'dotenv/config';
import { enumerateTopRepos, fetchTopN, type SearchRepo } from '@/lib/github/search';
import { upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, type StageOpts } from '@/scripts/_common';
import { getAdminClient } from '@/lib/supabase/admin';

interface ArchiveState {
  is_archived: boolean;
  archived_reason: string | null;
}

async function loadArchiveStates(ids: number[]): Promise<Map<number, ArchiveState>> {
  const client = getAdminClient();
  const map = new Map<number, ArchiveState>();
  for (let i = 0; i < ids.length; i += 800) {
    const { data, error } = await client
      .from('repositories')
      .select('id,is_archived,archived_reason')
      .in('id', ids.slice(i, i + 800));
    if (error) throw new Error(`加载已有归档状态失败:${error.message}`);
    for (const row of (data ?? []) as Array<ArchiveState & { id: number }>) map.set(row.id, row);
  }
  return map;
}

function toRow(r: SearchRepo, existing?: ArchiveState) {
  const derivedArchived = existing?.is_archived === true && existing.archived_reason !== 'github_archived';
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
    // GitHub 明确归档时提升；否则保留 README/stale 派生状态，新仓明确写 false。
    is_archived: r.archived || derivedArchived,
    archived_reason: r.archived ? 'github_archived' : (derivedArchived ? existing?.archived_reason ?? null : null),
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
    const archivedCount = repos.filter((r) => r.archived).length;
    const archiveStates = await loadArchiveStates(repos.map((repo) => repo.id));
    await upsertBatched('repositories', repos.map((repo) => toRow(repo, archiveStates.get(repo.id))), { onConflict: 'id' });
    await finishRun(runId, 'success', { count: repos.length, archived: archivedCount });
    log(`fetch-top 完成:${repos.length} 条(其中 ${archivedCount} 个已归档)`);
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
