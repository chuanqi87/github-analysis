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

// PostgREST 单次查询硬上限 1000 行,全量补齐 README 必须 range 分页。
const PAGE_SIZE = 1000;

/** 单页加载未抓 README 的候选(按 id 游标推进,可中断恢复)。 */
async function loadCandidatePage(opts: StageOpts, afterId: number, take: number): Promise<RepoRef[]> {
  const client = getAdminClient();
  const selectStr = 'id, full_name, owner, name, is_archived, archived_reason';
  let q = client
    .from('repositories')
    .select(selectStr)
    .is('readme_text', null)
    .order('id', { ascending: true })
    .limit(take);
  if (afterId > 0) q = q.gt('id', afterId);
  if (opts.ids?.length) q = q.in('id', opts.ids);
  const { data, error } = await q;
  if (error) throw new Error(`加载候选失败:${error.message}`);
  return (data ?? []) as RepoRef[];
}

/** 探测 GitHub core 配额剩余(不消耗配额);低于阈值返回 true 表示应停止。 */
async function coreQuotaLow(threshold = 100): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: token ? { Authorization: `Bearer ${token}`, 'User-Agent': 'fetch-readme' } : { 'User-Agent': 'fetch-readme' },
    });
    if (!res.ok) return false; // 探测失败不阻断
    const json = (await res.json()) as { resources: { core: { remaining: number } } };
    return json.resources.core.remaining < threshold;
  } catch {
    return false;
  }
}

export async function runFetchReadme(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('fetch-readme');
  try {
    // 估算待抓总量(head count,绕过 max-rows)
    const client = getAdminClient();
    let q = client.from('repositories').select('*', { count: 'exact', head: true }).is('readme_text', null);
    if (opts.ids?.length) q = q.in('id', opts.ids);
    const { count: total } = await q;
    log(`抓取 ${total ?? 0} 个候选 README(逐页 fetch+upsert,可中断恢复,配额不足自动停)...`);

    let done = 0;
    let readmeArchivedCount = 0;
    let deprecatedCount = 0;
    let stoppedForQuota = false;
    let afterId = 0; // id 游标:无论本页成功/失败都推进,避免单次运行死循环
    const cap = opts.limit ?? Number.MAX_SAFE_INTEGER;
    for (;;) {
      if (done >= cap) break;
      const take = Math.min(PAGE_SIZE, cap - done);
      // 抓页前检查 core 配额,避免每仓 ~5min 的重试空转
      if (await coreQuotaLow()) {
        log(`GitHub core 配额不足,停止本批(已抓 ${done}/${total ?? '?'}),重跑在配额重置后续抓`);
        stoppedForQuota = true;
        break;
      }
      const page = await loadCandidatePage(opts, afterId, take);
      if (page.length === 0) break;
      afterId = page[page.length - 1].id; // 游标推进
      const nowIso = new Date().toISOString();
      const rows = await pMap(
        page,
        async (repo) => {
          let readme: string | null = null;
          let transient = false;
          try {
            readme = await getReadme(repo.owner, repo.name); // null=404无README, string=正文
          } catch {
            transient = true; // 限流/网络:保留 null 待重跑续抓(游标已越过本仓)
          }
          done++;
          if (done % 100 === 0) log(`  README 进度 ${done}/${total ?? '?'}`);
          // 404 用空串占位(排除出 null 过滤集,避免每次重抓);瞬时失败保留 null 待重跑
          // 清洗 NUL/控制字符 + 孤立代理项:Postgres JSON 解析拒绝 \u0000 与 lone surrogate(损坏 emoji/编码)
          //   否则 upsert 报 "invalid input syntax for type json";合法 emoji 代理对会一并被删(关键词检测无影响)
          const storedReadme = transient
            ? null
            : (readme ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g, '');
          let isArchived = repo.is_archived;
          let archivedReason = repo.archived_reason;
          if (!isArchived && storedReadme) {
            const status = detectReadmeStatus(storedReadme);
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
            readme_text: storedReadme,
            readme_fetched_at: nowIso,
            is_archived: isArchived,
            archived_reason: archivedReason,
          };
        },
        6,
      );
      // 逐页落库:被中断/配额不足已抓的部分不丢,重跑从 readme_text IS NULL 续抓
      await upsertBatched('repositories', rows, { onConflict: 'id' });
      if (page.length < take) break; // 已取尽
    }
    await finishRun(runId, 'success', {
      count: done,
      readme_archived: readmeArchivedCount,
      deprecated: deprecatedCount,
      stopped_for_quota: stoppedForQuota,
    });
    log(
      `fetch-readme ${stoppedForQuota ? '暂停(配额不足)' : '完成'}:${done}/${total ?? '?'} 条` +
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
