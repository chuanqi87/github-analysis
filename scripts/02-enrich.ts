// 阶段2:GraphQL 批量富化元数据 + 探测鸿蒙工程文件信号。
import 'dotenv/config';
import { batchEnrich } from '@/lib/github/graphql';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, type StageOpts } from '@/scripts/_common';

interface RepoRef {
  id: number;
  full_name: string;
  owner: string;
  name: string;
}

// PostgREST 单次查询硬上限 1000 行,全量刷新必须 range 分页。
const PAGE_SIZE = 1000;

async function loadRepos(opts: StageOpts): Promise<RepoRef[]> {
  const client = getAdminClient();
  const selectStr = 'id, full_name, owner, name';
  // ids 模式:候选集小(每日热点),单次查询即可
  if (opts.ids?.length) {
    const { data, error } = await client
      .from('repositories')
      .select(selectStr)
      .in('id', opts.ids)
      .order('stars', { ascending: false });
    if (error) throw new Error(`加载 repositories 失败:${error.message}`);
    return (data ?? []) as RepoRef[];
  }
  // 全量模式:range 分页,绕过 PostgREST 1000 行上限
  const out: RepoRef[] = [];
  const cap = opts.limit ?? Number.MAX_SAFE_INTEGER;
  for (let from = 0; out.length < cap; from += PAGE_SIZE) {
    const take = Math.min(PAGE_SIZE, cap - out.length);
    const { data, error } = await client
      .from('repositories')
      .select(selectStr)
      .order('stars', { ascending: false })
      .range(from, from + take - 1);
    if (error) throw new Error(`加载 repositories 失败:${error.message}`);
    const rows = (data ?? []) as RepoRef[];
    out.push(...rows);
    if (rows.length < take) break; // 已取尽
  }
  return out;
}

export async function runEnrich(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('enrich');
  try {
    const repos = await loadRepos(opts);
    log(`富化 ${repos.length} 个仓库(GraphQL 批量)...`);
    const results = await batchEnrich(
      repos.map((r) => ({ owner: r.owner, name: r.name, full_name: r.full_name })),
      (done, total) => {
        if (done % 200 === 0 || done === total) log(`  富化进度 ${done}/${total}`);
      },
    );

    const byFullName = new Map(repos.map((r) => [r.full_name, r]));
    const repoUpdates: Record<string, unknown>[] = [];
    const signalUpdates: Record<string, unknown>[] = [];
    let archivedCount = 0;
    for (const e of results) {
      if (!e.found) continue;
      const ref = byFullName.get(e.full_name);
      if (!ref) continue;
      const isArchived = e.is_archived;
      if (isArchived) archivedCount++;
      repoUpdates.push({
        id: ref.id,
        full_name: ref.full_name,
        owner: ref.owner,
        name: ref.name,
        description: e.description,
        homepage: e.homepage,
        primary_language: e.primary_language,
        stars: e.stars,
        forks: e.forks,
        license: e.license,
        pushed_at: e.pushed_at,
        repo_created_at: e.repo_created_at,
        topics: e.topics,
        latest_release_at: e.latest_release_at,
        is_archived: isArchived,
        // 仅当 GitHub 标记归档时才更新 reason,避免覆盖 readme 检测结果
        archived_reason: isArchived ? 'github_archived' : undefined,
      });
      signalUpdates.push({
        repository_id: ref.id,
        has_oh_package: e.has_oh_package,
        has_build_profile: e.has_build_profile,
        has_module_json5: e.has_module_json5,
        has_hvigor: e.has_hvigor,
        has_entry_dir: e.has_entry_dir,
        has_ets: e.has_ets,
      });
    }

    await upsertBatched('repositories', repoUpdates, { onConflict: 'id' });
    await upsertBatched('harmony_signals', signalUpdates, { onConflict: 'repository_id' });
    await finishRun(runId, 'success', { enriched: repoUpdates.length, archived: archivedCount });
    log(`enrich 完成:${repoUpdates.length} 条(其中 ${archivedCount} 个已归档)`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEnrich().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
