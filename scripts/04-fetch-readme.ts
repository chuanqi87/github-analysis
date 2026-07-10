// 阶段4:仅对候选(高 star / 指定 ids)抓取 README,写 repositories.readme_text。
// 同时通过 README 关键词检测归档/废弃状态。
import 'dotenv/config';
import { getReadme } from '@/lib/github/rest';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';

// ─── README 归档关键词检测 ──────────────────────────────────────────────────
// 分为两类:archived(项目已死)和 deprecated(推荐替代方案)。

/** 明确声明项目已归档/停止(强信号) */
const ARCHIVED_PATTERNS: RegExp[] = [
  // 英文
  /\b(?:this\s+(?:repo(?:sitory)?|project)\s+(?:is|has\s+been)\s+archiv(?:ed|e))/i,
  /\b(?:archiv(?:ed|e)\s+(?:repo(?:sitory)?|project))\b/i,
  /\b(?:abandoned)\b/i,
  /\b(?:discontinued)\b/i,
  /\b(?:end[\s-]of[\s-]life)\b/i,
  /\bEOL\b/,
  // 中文
  /(?:已归档|停止维护|不再维护|已停用|暂停维护|暂停更新|停止更新)/,
  /(?:本项目已|本仓库已|此项目已).{0,6}(?:归档|停用)/,
  /(?:不再(?:维护|更新|支持|开发))/,
];

/** 声明弃用/推荐替代(弱信号,项目可能仍可用) */
const DEPRECATED_PATTERNS: RegExp[] = [
  // 英文
  /\b(?:deprecated[!.]?)\b/i,
  /\b(?:this\s+project\s+is\s+deprecated)\b/i,
  /\b(?:DEPRECATED\s*[:\-–])\b/i,
  /\b(?:superseded\s+by)\b/i,
  /\b(?:replaced\s+by)\b/i,
  /\b(?:obsolete)\b/i,
  /\b(?:no\s+longer\s+(?:maintained|supported|developed|active))\b/i,
  /\b(?:not\s+maintained)\b/i,
  /\b(?:unmaintained)\b/i,
  /\b(?:⚠️.*(?:no\s+longer|deprecated|archived|unmaintained))/i,
  /\b(?:❗\s*(?:This\s+repo|This\s+project|No\s+longer))/i,
  // 中文
  /(?:已废弃|已弃用|已弃坑)/,
  /(?:本项目已|本仓库已|此项目已).{0,6}(?:废弃|弃用)/,
  /(?:迁移至|迁移到|请移步|转移到|已转移).{0,20}(?:新仓库|新项目|替代)/,
];

/**
 * 检测 README 中是否包含归档声明(项目已死)。
 */
export function detectArchivedInReadme(readme: string | null): boolean {
  if (!readme) return false;
  const head = readme.slice(0, 2000);
  return ARCHIVED_PATTERNS.some((p) => p.test(head));
}

/**
 * 检测 README 中是否包含弃用声明(推荐替代)。
 */
export function detectDeprecatedInReadme(readme: string | null): boolean {
  if (!readme) return false;
  const head = readme.slice(0, 2000);
  return DEPRECATED_PATTERNS.some((p) => p.test(head));
}

/**
 * 综合检测:返回 'readme_archived' | 'deprecated_notice' | null。
 * 优先级:archived > deprecated。
 */
export function detectReadmeStatus(readme: string | null): 'readme_archived' | 'deprecated_notice' | null {
  if (!readme) return null;
  if (detectArchivedInReadme(readme)) return 'readme_archived';
  if (detectDeprecatedInReadme(readme)) return 'deprecated_notice';
  return null;
}

interface RepoRef {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  is_archived: boolean;
  archived_reason: string | null;
}

async function loadCandidates(opts: StageOpts): Promise<RepoRef[]> {
  const client = getAdminClient();
  let q = client
    .from('repositories')
    .select('id, full_name, owner, name, is_archived, archived_reason')
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
    let readmeArchivedCount = 0;
    let deprecatedCount = 0;
    const nowIso = new Date().toISOString();
    const rows = await pMap(
      repos,
      async (repo) => {
        const readme = await getReadme(repo.owner, repo.name).catch(() => null);
        done++;
        if (done % 100 === 0) log(`  README 进度 ${done}/${repos.length}`);

        // 检测 README 状态:仅在 GitHub 未标记归档时检测
        let isArchived = repo.is_archived;
        let archivedReason = repo.archived_reason;
        if (!isArchived && readme) {
          const status = detectReadmeStatus(readme);
          if (status) {
            isArchived = true;
            archivedReason = status;
            if (status === 'readme_archived') readmeArchivedCount++;
            else deprecatedCount++;
          }
        }

        return {
          id: repo.id,
          full_name: repo.full_name,
          owner: repo.owner,
          name: repo.name,
          readme_text: readme,
          readme_fetched_at: nowIso,
          is_archived: isArchived,
          archived_reason: archivedReason,
        };
      },
      6,
    );
    await upsertBatched('repositories', rows, { onConflict: 'id' });
    await finishRun(runId, 'success', {
      count: rows.length,
      readme_archived: readmeArchivedCount,
      deprecated: deprecatedCount,
    });
    log(
      `fetch-readme 完成:${rows.length} 条` +
        `(README 归档 ${readmeArchivedCount}, 弃用声明 ${deprecatedCount})`,
    );
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
