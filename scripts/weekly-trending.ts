// 多源热点发现：每天保留候选全集，每周证据自然累积；高可信热点进入分析池。
import 'dotenv/config';
import { fetchTrending, type TrendingPeriod } from '@/lib/sources/ossinsight';
import { fetchGithubTrending, type TrendingSince } from '@/lib/sources/githubTrending';
import { batchEnrich, type EnrichResult } from '@/lib/github/graphql';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, today, type StageOpts } from '@/scripts/_common';

const SNAPSHOT_LIMIT = 100;
const PROMOTION_LIMIT = 50;
const RRF_K = 10;
const METRIC_VERSION = 'multi-source-v2';

interface Seed {
  source: string;
  repoName: string;
  rank: number;
  weight: number;
}

interface PreviousSnapshot {
  stars: number | null;
  forks: number | null;
}

interface ScoredRepo {
  repo: EnrichResult;
  sources: string[];
  dailyScore: number;
  weeklyScore: number;
  starsDelta: number | null;
  forksDelta: number | null;
  score: number;
}

function mondayIso(): string {
  // 用北京时间业务日期的正午构造，确保周日 20:00 UTC（北京时间周一）属于新一周。
  const date = new Date(`${today()}T12:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day + (day === 0 ? -6 : 1));
  return date.toISOString().slice(0, 10);
}

async function collectSource(
  source: string,
  weight: number,
  fetcher: () => Promise<{ repo_name: string; rank: number }[]>,
): Promise<Seed[]> {
  try {
    const rows = await fetcher();
    log(`${source} 获取 ${rows.length} 条`);
    return rows.map((row) => ({ source, repoName: row.repo_name, rank: row.rank, weight }));
  } catch (error) {
    log(`${source} 获取失败，降级使用其它来源:${String(error).slice(0, 160)}`);
    return [];
  }
}

async function collectSeeds(): Promise<Seed[]> {
  const specs: Array<Promise<Seed[]>> = [
    collectSource('ossinsight-daily', 1, () => fetchTrending('past_24_hours' satisfies TrendingPeriod)),
    collectSource('ossinsight-weekly', 1.15, () => fetchTrending('past_week' satisfies TrendingPeriod)),
    collectSource('github-daily', 0.9, () => fetchGithubTrending('daily' satisfies TrendingSince)),
    collectSource('github-weekly', 1.05, () => fetchGithubTrending('weekly' satisfies TrendingSince)),
  ];
  return (await Promise.all(specs)).flat();
}

async function loadPrevious(names: string[]): Promise<Map<string, PreviousSnapshot>> {
  const client = getAdminClient();
  const map = new Map<string, PreviousSnapshot>();
  for (let i = 0; i < names.length; i += 300) {
    const { data, error } = await client
      .from('trending_snapshots')
      .select('repo_name,stars,forks,captured_date')
      .in('repo_name', names.slice(i, i + 300))
      .lt('captured_date', today())
      .eq('metric_version', METRIC_VERSION)
      .order('captured_date', { ascending: false });
    if (error) throw new Error(`加载历史热点失败:${error.message}`);
    for (const row of (data ?? []) as Array<PreviousSnapshot & { repo_name: string }>) {
      if (!map.has(row.repo_name)) map.set(row.repo_name, { stars: row.stars, forks: row.forks });
    }
  }
  return map;
}

async function loadTrendingWeeks(names: string[]): Promise<Map<string, number>> {
  const client = getAdminClient();
  const weekMap = new Map<string, number>();
  const currentWeek = new Set<string>();
  for (let i = 0; i < names.length; i += 300) {
    const chunk = names.slice(i, i + 300);
    const [{ data, error }, current] = await Promise.all([
      client.rpc('count_trending_weeks', { p_repo_names: chunk }),
      client
        .from('trending_snapshots')
        .select('repo_name')
        .in('repo_name', chunk)
        .gte('captured_date', mondayIso()),
    ]);
    if (error) throw new Error(`查询热点周数失败:${error.message}`);
    for (const row of (data ?? []) as { repo_name: string; week_count: number }[]) {
      weekMap.set(row.repo_name, Number(row.week_count));
    }
    for (const row of (current.data ?? []) as { repo_name: string }[]) currentWeek.add(row.repo_name);
  }
  for (const name of names) weekMap.set(name, (weekMap.get(name) ?? 0) + (currentWeek.has(name) ? 0 : 1));
  return weekMap;
}

function normalized(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((value) => (max > 0 ? value / max : 0));
}

function scoreRepos(seeds: Seed[], repos: EnrichResult[], previous: Map<string, PreviousSnapshot>): ScoredRepo[] {
  const grouped = new Map<string, Seed[]>();
  for (const seed of seeds) grouped.set(seed.repoName, [...(grouped.get(seed.repoName) ?? []), seed]);

  const base = repos.filter((repo) => repo.found && repo.id != null).map((repo) => {
    const entries = grouped.get(repo.full_name) ?? [];
    const dailyScore = entries
      .filter((entry) => entry.source.endsWith('daily'))
      .reduce((sum, entry) => sum + entry.weight / (RRF_K + entry.rank), 0);
    const weeklyScore = entries
      .filter((entry) => entry.source.endsWith('weekly'))
      .reduce((sum, entry) => sum + entry.weight / (RRF_K + entry.rank), 0);
    const old = previous.get(repo.full_name);
    return {
      repo,
      sources: Array.from(new Set(entries.map((entry) => entry.source))).sort(),
      dailyScore,
      weeklyScore,
      starsDelta: old?.stars == null ? null : Math.max(0, repo.stars - old.stars),
      forksDelta: old?.forks == null ? null : Math.max(0, repo.forks - old.forks),
      score: 0,
    };
  });
  const rankNorm = normalized(base.map((row) => row.dailyScore + row.weeklyScore));
  const starNorm = normalized(base.map((row) => row.starsDelta ?? 0));
  const forkNorm = normalized(base.map((row) => row.forksDelta ?? 0));
  return base
    .map((row, index) => ({
      ...row,
      // 排名共识为主，真实 Star/Fork 增量校正；多源交叉命中额外加分。
      score:
        0.55 * rankNorm[index] +
        0.25 * starNorm[index] +
        0.1 * forkNorm[index] +
        0.1 * Math.min(1, row.sources.length / 3),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SNAPSHOT_LIMIT);
}

function repoRow(repo: EnrichResult, existing?: { is_archived: boolean; archived_reason: string | null }): Record<string, unknown> {
  const derivedArchived = existing?.is_archived === true && existing.archived_reason !== 'github_archived';
  return {
    id: repo.id,
    full_name: repo.full_name,
    owner: repo.owner,
    name: repo.name,
    description: repo.description,
    homepage: repo.homepage,
    primary_language: repo.primary_language,
    stars: repo.stars,
    forks: repo.forks,
    license: repo.license,
    pushed_at: repo.pushed_at,
    repo_created_at: repo.repo_created_at,
    topics: repo.topics,
    latest_release_at: repo.latest_release_at,
    is_archived: repo.is_archived || derivedArchived,
    archived_reason: repo.is_archived ? 'github_archived' : (derivedArchived ? existing?.archived_reason ?? null : null),
  };
}

function signalRow(repo: EnrichResult): Record<string, unknown> {
  return {
    repository_id: repo.id,
    has_oh_package: repo.has_oh_package,
    has_build_profile: repo.has_build_profile,
    has_module_json5: repo.has_module_json5,
    has_hvigor: repo.has_hvigor,
    has_entry_dir: repo.has_entry_dir,
    has_ets: repo.has_ets,
  };
}

export async function runWeeklyTrending(_opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('trending-discovery');
  try {
    const seeds = await collectSeeds();
    const names = Array.from(new Set(seeds.map((seed) => seed.repoName).filter((name) => name.includes('/'))));
    if (!names.length) throw new Error('所有热点来源均无有效数据');

    log(`热点候选去重后 ${names.length} 个，统一获取 GitHub 实时元数据…`);
    const enriched = await batchEnrich(names.map((full_name) => {
      const [owner, name] = full_name.split('/');
      return { owner, name, full_name };
    }));
    const valid = enriched.filter((repo) => repo.found && repo.id != null && repo.owner && repo.name);
    const archiveStates = new Map<number, { is_archived: boolean; archived_reason: string | null }>();
    for (let i = 0; i < valid.length; i += 300) {
      const { data, error } = await getAdminClient()
        .from('repositories')
        .select('id,is_archived,archived_reason')
        .in('id', valid.slice(i, i + 300).map((repo) => repo.id));
      if (error) throw new Error(`加载热点仓归档状态失败:${error.message}`);
      for (const row of (data ?? []) as Array<{ id: number; is_archived: boolean; archived_reason: string | null }>) {
        archiveStates.set(row.id, row);
      }
    }
    await upsertBatched('repositories', valid.map((repo) => repoRow(repo, archiveStates.get(repo.id!))), { onConflict: 'id' });
    await upsertBatched('harmony_signals', valid.map(signalRow), { onConflict: 'repository_id' });

    const [previous, weeks] = await Promise.all([loadPrevious(names), loadTrendingWeeks(names)]);
    const scored = scoreRepos(seeds, valid, previous);
    const date = today();
    const snapshots = scored.map((row, index) => ({
      captured_date: date,
      source: row.sources.join(','),
      repo_name: row.repo.full_name,
      repository_id: row.repo.id,
      primary_language: row.repo.primary_language,
      description: row.repo.description,
      stars: row.repo.stars,
      forks: row.repo.forks,
      total_score: Number(row.score.toFixed(6)),
      daily_score: Number(row.dailyScore.toFixed(6)),
      weekly_score: Number(row.weeklyScore.toFixed(6)),
      stars_delta: row.starsDelta,
      forks_delta: row.forksDelta,
      source_count: row.sources.length,
      rank: index + 1,
      weeks_on_trending: weeks.get(row.repo.full_name) ?? 1,
      promoted: index < PROMOTION_LIMIT,
      metric_version: METRIC_VERSION,
    }));
    // 同一天重跑时快照必须是精确替换；仅 upsert 会遗留本次已跌出 Top100 的旧行。
    const { error: clearError } = await getAdminClient()
      .from('trending_snapshots')
      .delete()
      .eq('captured_date', date);
    if (clearError) throw new Error(`清理当日旧热点快照失败:${clearError.message}`);
    await upsertBatched('trending_snapshots', snapshots, { onConflict: 'captured_date,repo_name' });

    await finishRun(runId, 'success', {
      raw_seeds: seeds.length,
      unique_candidates: names.length,
      snapshots: snapshots.length,
      promoted: Math.min(PROMOTION_LIMIT, snapshots.length),
      sources_ok: new Set(seeds.map((seed) => seed.source)).size,
    });
    log(`热点发现完成:原始 ${seeds.length} → 候选 ${names.length} → 快照 ${snapshots.length}，Top ${PROMOTION_LIMIT} 入池`);
  } catch (error) {
    await finishRun(runId, 'failed', { error: String(error) });
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWeeklyTrending().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
