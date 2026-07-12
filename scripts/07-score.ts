// 阶段7:合并人工标记(权威)与信号/分析,计算适配优先级并排名。
// 已归档仓库不参与排名计算。
// v3: 支持动态分类,通过 repo_board 视图获取分类 slug。
import 'dotenv/config';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { computePriority, WEIGHTS_VERSION } from '@/lib/scoring/priority';
import type { HarmonyState } from '@/lib/types';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, type StageOpts } from '@/scripts/_common';

interface BestAnalysis {
  category: string | null;          // slug(从视图 join)
  mobile_relevance: number | null;
  feasibility: number | null;
  effort_estimate: number | null;
  ecosystem_gap: number | null;
}

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/**
 * 从 repo_board 视图获取每个仓库的最佳分析结果。
 * 视图已按 tier desc + created_at desc 取最新一条。
 */
async function loadBestAnalysis(): Promise<Map<number, BestAnalysis>> {
  const client = getAdminClient();
  const rows = await pageAll<{
    id: number;
    category: string | null;
    mobile_relevance: number | null;
    feasibility: number | null;
    effort_estimate: number | null;
    ecosystem_gap: number | null;
  }>((from, to) =>
    client
      .from('repo_board')
      .select('id, category, mobile_relevance, feasibility, effort_estimate, ecosystem_gap')
      .range(from, to),
  );
  const map = new Map<number, BestAnalysis>();
  for (const r of rows) {
    map.set(r.id, {
      category: r.category,
      mobile_relevance: r.mobile_relevance,
      feasibility: r.feasibility,
      effort_estimate: r.effort_estimate,
      ecosystem_gap: r.ecosystem_gap,
    });
  }
  return map;
}

async function loadHints(): Promise<Map<number, HarmonyState>> {
  const client = getAdminClient();
  const rows = await pageAll<{ repository_id: number; auto_state_hint: HarmonyState | null }>((from, to) =>
    client.from('harmony_signals').select('repository_id, auto_state_hint').range(from, to),
  );
  const m = new Map<number, HarmonyState>();
  for (const r of rows) if (r.auto_state_hint) m.set(r.repository_id, r.auto_state_hint);
  return m;
}

async function loadOverrides(): Promise<Map<number, HarmonyState>> {
  const client = getAdminClient();
  const rows = await pageAll<{ repository_id: number; state: HarmonyState }>((from, to) =>
    client.from('harmony_overrides').select('repository_id, state').range(from, to),
  );
  return new Map(rows.map((r) => [r.repository_id, r.state]));
}

async function loadVelocity(): Promise<Map<number, number>> {
  const client = getAdminClient();
  // 近 7 天热点快照中,取每仓最高 total_score,并按全局最大值归一化。
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const rows = await pageAll<{ repository_id: number | null; total_score: number | null }>((from, to) =>
    client
      .from('trending_snapshots')
      .select('repository_id, total_score')
      .gte('captured_date', since)
      .range(from, to),
  );
  const raw = new Map<number, number>();
  let max = 0;
  for (const r of rows) {
    if (r.repository_id == null || r.total_score == null) continue;
    raw.set(r.repository_id, Math.max(raw.get(r.repository_id) ?? 0, r.total_score));
    max = Math.max(max, r.total_score);
  }
  const norm = new Map<number, number>();
  if (max > 0) for (const [id, v] of raw) norm.set(id, v / max);
  return norm;
}

export async function runScore(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('score');
  try {
    const client = getAdminClient();
    // range 分页加载全部仓库(绕过 PostgREST 单次 1000 行上限);ids 模式小集合同样安全
    const allRepos = await pageAll<{ id: number; stars: number; is_archived: boolean }>((from, to) => {
      let q = client
        .from('repositories')
        .select('id, stars, is_archived')
        .order('stars', { ascending: false })
        .range(from, to);
      if (opts.ids?.length) q = q.in('id', opts.ids);
      return q as unknown as PromiseLike<{ data: unknown; error: { message: string } | null }>;
    });
    if (!allRepos.length) throw new Error('加载 repositories 失败:无数据');

    // 过滤已归档仓库
    const repos = allRepos.filter((r) => !r.is_archived);
    const archivedCount = allRepos.length - repos.length;
    if (archivedCount > 0) log(`跳过 ${archivedCount} 个已归档仓库`);

    const [analysis, hints, overrides, velocity] = await Promise.all([
      loadBestAnalysis(),
      loadHints(),
      loadOverrides(),
      loadVelocity(),
    ]);

    log(`为 ${repos.length} 个仓库计算优先级...`);
    const scored = repos.map((repo) => {
      const a = analysis.get(repo.id);
      const effectiveState = overrides.get(repo.id) ?? hints.get(repo.id) ?? null;
      const breakdown = computePriority({
        stars: repo.stars,
        velocity: velocity.get(repo.id) ?? 0,
        effectiveState,
        category: a?.category ?? null,
        llmMobileRelevance: a?.mobile_relevance ?? null,
        effortEstimate: a?.effort_estimate ?? null,
        ecosystemGap: a?.ecosystem_gap ?? null,
        feasibility: a?.feasibility ?? null,
      });
      return { repository_id: repo.id, breakdown };
    });

    // 全局排名(仅对 opts.ids 局部运行时,rank 仅在该子集内相对;全量运行给出全局 rank)
    scored.sort((x, y) => y.breakdown.priorityScore - x.breakdown.priorityScore);
    const rows = scored.map((s, i) => ({
      repository_id: s.repository_id,
      priority_score: s.breakdown.priorityScore,
      rank: opts.ids?.length ? null : i + 1,
      weights_version: WEIGHTS_VERSION,
      breakdown: s.breakdown,
      computed_at: new Date().toISOString(),
    }));

    await upsertBatched('priority_rankings', rows, { onConflict: 'repository_id' });
    await finishRun(runId, 'success', { count: rows.length, archived: archivedCount });
    log(`score 完成:${rows.length} 条(跳过 ${archivedCount} 个归档)`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScore().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
