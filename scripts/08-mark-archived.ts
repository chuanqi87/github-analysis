// 阶段8:全量刷新归档标记。
// 1) GitHub GraphQL 批量查询 isArchived → github_archived
// 2) 已有 README 的仓库做关键词检测 → readme_archived / deprecated_notice
// 3) 最后 Release 距今 > 3 年 → no_recent_release
// 4) 超过 2 年未更新的仓库 → stale_repository
// 5) 归档仓库不再参与 LLM 分析,priority_score 自动沉底。
import 'dotenv/config';
import { batchEnrich } from '@/lib/github/graphql';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, type StageOpts } from '@/scripts/_common';
import { detectReadmeStatus } from '@/scripts/04-fetch-readme';

interface RepoRow {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  readme_text: string | null;
  is_archived: boolean;
  archived_reason: string | null;
  pushed_at: string | null;
  latest_release_at: string | null;
}

/** 超过此年限未发布新版本视为 no_recent_release(3 年) */
const NO_RELEASE_THRESHOLD_MS = 3 * 365.25 * 24 * 60 * 60 * 1000;

/** 超过此年限未更新视为 stale(2 年) */
const STALE_THRESHOLD_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

async function loadAllRepos(): Promise<RepoRow[]> {
  const client = getAdminClient();
  const out: RepoRow[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await client
      .from('repositories')
      .select('id, full_name, owner, name, readme_text, is_archived, archived_reason, pushed_at, latest_release_at')
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

    // ── Step 1: GraphQL 批量查询 isArchived + latestRelease ──────────
    log('Step 1/3: GraphQL 批量查询 isArchived + latestRelease...');
    const enriched = await batchEnrich(
      repos.map((r) => ({ owner: r.owner, name: r.name, full_name: r.full_name })),
      (done, total) => {
        if (done % 200 === 0 || done === total) log(`  GraphQL 进度 ${done}/${total}`);
      },
    );
    const archivedMap = new Map<string, boolean>();
    const releaseMap = new Map<string, string | null>();
    for (const e of enriched) {
      if (e.found) {
        archivedMap.set(e.full_name, e.is_archived);
        releaseMap.set(e.full_name, e.latest_release_at);
      }
    }

    // ── Step 2: 合并所有检测结果 ─────────────────────────────────────
    log('Step 2/3: 合并 GitHub + README + Release + Stale 检测结果...');
    const counters = {
      github_archived: 0,
      readme_archived: 0,
      deprecated_notice: 0,
      no_recent_release: 0,
      stale_repository: 0,
    };
    let unchanged = 0;
    const updates: Record<string, unknown>[] = [];
    const now = Date.now();

    for (const repo of repos) {
      const ghIsArchived = archivedMap.get(repo.full_name) ?? false;
      const latestRelease = releaseMap.get(repo.full_name) ?? repo.latest_release_at;
      const readmeStatus = detectReadmeStatus(repo.readme_text);

      // 优先级: github_archived > readme_archived > deprecated_notice > no_recent_release > stale_repository
      let newArchived = false;
      let newReason: string | null = null;

      if (ghIsArchived) {
        newArchived = true;
        newReason = 'github_archived';
        counters.github_archived++;
      } else if (readmeStatus === 'readme_archived') {
        newArchived = true;
        newReason = 'readme_archived';
        counters.readme_archived++;
      } else if (readmeStatus === 'deprecated_notice') {
        newArchived = true;
        newReason = 'deprecated_notice';
        counters.deprecated_notice++;
      } else if (latestRelease) {
        const releaseAgeMs = now - new Date(latestRelease).getTime();
        if (releaseAgeMs > NO_RELEASE_THRESHOLD_MS) {
          newArchived = true;
          newReason = 'no_recent_release';
          counters.no_recent_release++;
        }
      } else if (repo.pushed_at) {
        const pushedAgeMs = now - new Date(repo.pushed_at).getTime();
        if (pushedAgeMs > STALE_THRESHOLD_MS) {
          newArchived = true;
          newReason = 'stale_repository';
          counters.stale_repository++;
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
        // 同时更新 latest_release_at(GraphQL 获取到的)
        latest_release_at: latestRelease ?? repo.latest_release_at,
      });
    }

    // ── Step 3: 批量写入 ─────────────────────────────────────────────
    if (updates.length > 0) {
      log(`写入 ${updates.length} 条变更...`);
      await upsertBatched('repositories', updates, { onConflict: 'id' });
    }

    const total = Object.values(counters).reduce((a, b) => a + b, 0);
    await finishRun(runId, 'success', {
      total_repos: repos.length,
      ...counters,
      total_archived: total,
      unchanged,
      updated: updates.length,
    });
    log(
      `mark-archived 完成:共 ${total} 个归档` +
        `(GitHub ${counters.github_archived}, README归档 ${counters.readme_archived}, ` +
        `弃用声明 ${counters.deprecated_notice}, 无新版本 ${counters.no_recent_release}, ` +
        `Stale ${counters.stale_repository}), ` +
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
