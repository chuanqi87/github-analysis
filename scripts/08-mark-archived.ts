// 阶段8:全量刷新归档标记。
// 1) GitHub GraphQL 批量查询 isArchived → github_archived
// 2) 已有 README 的仓库做关键词检测 → readme_archived
// 3) 归档仓库不再参与 LLM 分析,priority_score 自动沉底。
import 'dotenv/config';
import { batchEnrich } from '@/lib/github/graphql';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';
import { detectArchivedInReadme } from '@/scripts/04-fetch-readme';

interface RepoRow {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  readme_text: string | null;
  is_archived: boolean;
  archived_reason: string | null;
}

async function loadAllRepos(): Promise<RepoRow[]> {
  const client = getAdminClient();
  const out: RepoRow[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await client
      .from('repositories')
      .select('id, full_name, owner, name, readme_text, is_archived, archived_reason')
      .order('stars', { ascending: false })
      .range(from, from + size - 1);
    if (error) throw new Error(`加载 repositories 失败:${error.message}`);
    const rows = (data ?? []) as RepoRow[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

export async function runMarkArchived(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('mark-archived');
  try {
    const repos = await loadAllRepos();
    log(`全量刷新归档标记:共 ${repos.length} 个仓库`);

    // ── Step 1: GraphQL 批量查询 isArchived ──────────────────────────
    log('Step 1/2: GraphQL 批量查询 isArchived...');
    const enriched = await batchEnrich(
      repos.map((r) => ({ owner: r.owner, name: r.name, full_name: r.full_name })),
      (done, total) => {
        if (done % 200 === 0 || done === total) log(`  GraphQL 进度 ${done}/${total}`);
      },
    );
    const archivedMap = new Map<string, boolean>();
    for (const e of enriched) {
      if (e.found) archivedMap.set(e.full_name, e.is_archived);
    }

    // ── Step 2: 合并 GitHub + README 检测结果 ────────────────────────
    log('Step 2/2: 合并 GitHub + README 检测结果...');
    let ghArchived = 0;
    let readmeArchived = 0;
    let unchanged = 0;
    const updates: Record<string, unknown>[] = [];

    for (const repo of repos) {
      const ghIsArchived = archivedMap.get(repo.full_name) ?? false;
      const readmeIsArchived = !ghIsArchived && detectArchivedInReadme(repo.readme_text);

      const newArchived = ghIsArchived || readmeIsArchived;
      const newReason = ghIsArchived ? 'github_archived' : readmeIsArchived ? 'readme_archived' : null;

      if (ghIsArchived) ghArchived++;
      if (readmeIsArchived) readmeArchived++;

      // 仅当状态有变化时才更新
      if (repo.is_archived === newArchived && repo.archived_reason === newReason) {
        unchanged++;
        continue;
      }

      updates.push({
        id: repo.id,
        full_name: repo.full_name,
        owner: repo.owner,
        name: repo.name,
        is_archived: newArchived,
        archived_reason: newReason,
      });
    }

    // ── Step 3: 批量写入 ─────────────────────────────────────────────
    if (updates.length > 0) {
      log(`写入 ${updates.length} 条变更...`);
      await upsertBatched('repositories', updates, { onConflict: 'id' });
    }

    const total = ghArchived + readmeArchived;
    await finishRun(runId, 'success', {
      total_repos: repos.length,
      github_archived: ghArchived,
      readme_archived: readmeArchived,
      total_archived: total,
      unchanged,
      updated: updates.length,
    });
    log(
      `mark-archived 完成:共 ${total} 个归档(GitHub ${ghArchived}, README ${readmeArchived}), ` +
        `更新 ${updates.length} 条,未变化 ${unchanged} 条`,
    );
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMarkArchived().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
