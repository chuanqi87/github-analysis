// 阶段8:全量刷新归档标记。
// 1) GitHub GraphQL 批量查询 isArchived → github_archived
// 2) 已有 README 的仓库做关键词检测 → readme_archived
// 3) 超过 2 年未更新的仓库 → stale_repository
// 4) 归档仓库不再参与 LLM 分析,priority_score 自动沉底。
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
  pushed_at: string | null;
}

/** 超过此年限未更新视为 stale(2 年) */
const STALE_THRESHOLD_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

async function loadAllRepos(): Promise<RepoRow[]> {
  const client = getAdminClient();
  const out: RepoRow[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await client
      .from('repositories')
      .select('id, full_name, owner, name, readme_text, is_archived, archived_reason, pushed_at')
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
    log('Step 1/3: GraphQL 批量查询 isArchived...');
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

    // ── Step 2 & 3: 合并 GitHub + README + Stale 检测结果 ────────────
    log('Step 2/3: 合并 GitHub + README + Stale 检测结果...');
    let ghArchived = 0;
    let readmeArchived = 0;
    let staleArchived = 0;
    let unchanged = 0;
    const updates: Record<string, unknown>[] = [];
    const now = Date.now();

    for (const repo of repos) {
      const ghIsArchived = archivedMap.get(repo.full_name) ?? false;

      // 优先级:GitHub archived > README archived > Stale
      // GitHub archived 和 README archived 优先级更高
      let newArchived = false;
      let newReason: string | null = null;

      if (ghIsArchived) {
        newArchived = true;
        newReason = 'github_archived';
        ghArchived++;
      } else if (detectArchivedInReadme(repo.readme_text)) {
        newArchived = true;
        newReason = 'readme_archived';
        readmeArchived++;
      } else if (repo.pushed_at) {
        // 检查是否超过 2 年未更新
        const pushedAtMs = new Date(repo.pushed_at).getTime();
        const ageMs = now - pushedAtMs;
        if (ageMs > STALE_THRESHOLD_MS) {
          newArchived = true;
          newReason = 'stale_repository';
          staleArchived++;
        }
      }

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

    // ── Step 4: 批量写入 ─────────────────────────────────────────────
    if (updates.length > 0) {
      log(`写入 ${updates.length} 条变更...`);
      await upsertBatched('repositories', updates, { onConflict: 'id' });
    }

    const total = ghArchived + readmeArchived + staleArchived;
    await finishRun(runId, 'success', {
      total_repos: repos.length,
      github_archived: ghArchived,
      readme_archived: readmeArchived,
      stale_archived: staleArchived,
      total_archived: total,
      unchanged,
      updated: updates.length,
    });
    log(
      `mark-archived 完成:共 ${total} 个归档(GitHub ${ghArchived}, README ${readmeArchived}, Stale ${staleArchived}), ` +
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
