// 每周热点:抓取 trending → 跨源去重 + 热度排名 Top-N → 落库快照 → 补齐新仓 → 对热点仓做增量鸿蒙分析。
import 'dotenv/config';
import { fetchTrending } from '@/lib/sources/ossinsight';
import { fetchGithubTrending } from '@/lib/sources/githubTrending';
import { batchEnrich } from '@/lib/github/graphql';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, type StageOpts } from '@/scripts/_common';
import { runHarmonySignals } from '@/scripts/03-harmony-signals';
import { runLlmClassify } from '@/scripts/05-llm-classify';
import { runScore } from '@/scripts/07-score';

/** 每周热点保留条数 */
const TOP_N = 10;

interface SnapshotSeed {
  source: string;
  repo_name: string;
  primary_language: string | null;
  description: string | null;
  /** 仓库总 star 数(以 GitHub GraphQL 为准) */
  stars: number | null;
  /** 仓库总 fork 数 */
  forks: number | null;
  /** 近一周新增 star 数 */
  stars_delta: number | null;
  /** 近一周新增 fork 数 */
  forks_delta: number | null;
  total_score: number | null;
  rank: number | null;
}

/**
 * 本周一的日期(ISO 周,UTC)。
 *
 * 全程用 UTC 分量运算:旧实现混用本地 getDay/getDate 与 toISOString(UTC),
 * 在 UTC+N 时区的周一凌晨会算出上周日,把本周快照错写到上一周。
 */
function getMonday(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0=周日
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * 查询仓库的历史上榜周数(不含 excludeWeek 所在周)。
 *
 * 排除本周是为了幂等:同一周内重跑本阶段时,本周快照可能已写入,
 * 若把它算进历史周数再 +1,weeks_on_trending 会每跑一次涨一次。
 */
async function getWeeksOnTrending(
  repoNames: string[],
  excludeWeek: string,
): Promise<Map<string, number>> {
  const client = getAdminClient();
  const weekMap = new Map<string, number>();

  if (repoNames.length === 0) return weekMap;

  // 分批查询(每批最多 500 个)
  for (let i = 0; i < repoNames.length; i += 500) {
    const chunk = repoNames.slice(i, i + 500);
    const { data, error } = await client.rpc('count_trending_weeks', {
      p_repo_names: chunk,
      p_exclude_week: excludeWeek,
    });

    if (error) {
      log(`查询上榜周数失败: ${error.message}`);
      continue;
    }

    if (data) {
      for (const row of data as { repo_name: string; week_count: number }[]) {
        weekMap.set(row.repo_name, row.week_count);
      }
    }
  }

  return weekMap;
}

async function collectSeeds(): Promise<SnapshotSeed[]> {
  const seeds: SnapshotSeed[] = [];
  try {
    const oss = await fetchTrending('past_week');
    for (const it of oss) {
      seeds.push({
        source: 'ossinsight',
        repo_name: it.repo_name,
        primary_language: it.primary_language,
        description: it.description,
        // OSS Insight 只给周期增量,总量后面统一由 GraphQL 富化补齐
        stars: null,
        forks: null,
        stars_delta: it.stars_delta,
        forks_delta: it.forks_delta,
        total_score: it.total_score,
        rank: it.rank,
      });
    }
    log(`OSS Insight 热点 ${oss.length} 条`);
  } catch (e) {
    log(`OSS Insight 抓取失败:${String(e).slice(0, 120)}`);
  }
  try {
    const gh = await fetchGithubTrending('weekly');
    for (const it of gh) {
      seeds.push({
        source: 'github-trending',
        repo_name: it.repo_name,
        primary_language: it.primary_language,
        description: it.description,
        stars: it.stars,
        forks: it.forks,
        stars_delta: it.stars_delta,
        forks_delta: null,
        total_score: null,
        rank: it.rank,
      });
    }
    log(`GitHub Trending 热点 ${gh.length} 条`);
  } catch (e) {
    log(`GitHub Trending 抓取失败:${String(e).slice(0, 120)}`);
  }
  return seeds;
}

/** 按来源优先级取第一个非空字段值。 */
function pick<K extends keyof SnapshotSeed>(
  entries: SnapshotSeed[],
  order: string[],
  key: K,
): SnapshotSeed[K] | null {
  for (const source of order) {
    const hit = entries.find((e) => e.source === source && e[key] != null);
    if (hit) return hit[key];
  }
  const any = entries.find((e) => e[key] != null);
  return any ? any[key] : null;
}

/**
 * 跨数据源去重 + 热度排名。
 *
 * 策略:
 * 1. 按 repo_name 分组,同一项目出现在多个来源时合并为一条;
 * 2. 热度分 = Σ(1/rank) 各来源倒数排名之和,出现在多源的项目自然获得加权;
 * 3. 按热度分降序取 Top-N,重新编号 rank 1..N;
 * 4. 字段级合并(而非整条取某一来源):
 *    - stars/forks 总量:只有 github-trending 抓得到,OSS Insight 没有;
 *    - stars_delta 周增量:优先 github-trending(GitHub 自己的口径),
 *      缺失时回落 OSS Insight 的 past_week 统计;
 *    - 文本元数据优先 OSS Insight(描述更完整,不像 trending 页面被截断)。
 */
function deduplicateAndTopN(seeds: SnapshotSeed[], topN = TOP_N): SnapshotSeed[] {
  // 按 repo_name 分组
  const grouped = new Map<string, SnapshotSeed[]>();
  for (const s of seeds) {
    const list = grouped.get(s.repo_name) ?? [];
    list.push(s);
    grouped.set(s.repo_name, list);
  }

  // 计算统一热度分
  interface ScoredEntry {
    seed: SnapshotSeed;
    hotScore: number;
    multiSource: boolean;
  }
  const scored: ScoredEntry[] = [];

  const TEXT_ORDER = ['ossinsight', 'github-trending'];
  const COUNT_ORDER = ['github-trending', 'ossinsight'];

  for (const [repoName, entries] of grouped) {
    // 热度分:各来源倒数排名之和
    let hotScore = 0;
    const sourceSet = new Set<string>();
    for (const e of entries) {
      if (e.rank && e.rank > 0) hotScore += 1 / e.rank;
      sourceSet.add(e.source);
    }

    const sources = Array.from(sourceSet).sort();

    scored.push({
      seed: {
        // 多来源用逗号拼接
        source: sources.join(','),
        repo_name: repoName,
        primary_language: pick(entries, TEXT_ORDER, 'primary_language'),
        description: pick(entries, TEXT_ORDER, 'description'),
        stars: pick(entries, COUNT_ORDER, 'stars'),
        forks: pick(entries, COUNT_ORDER, 'forks'),
        stars_delta: pick(entries, COUNT_ORDER, 'stars_delta'),
        forks_delta: pick(entries, COUNT_ORDER, 'forks_delta'),
        total_score: pick(entries, TEXT_ORDER, 'total_score'),
        rank: null, // 下面按热度分重新编号
      },
      hotScore,
      multiSource: sources.length > 1,
    });
  }

  // 按热度分降序排序,取 Top-N
  scored.sort((a, b) => {
    // 多来源优先(同分时)
    if (a.multiSource !== b.multiSource) return a.multiSource ? -1 : 1;
    return b.hotScore - a.hotScore;
  });
  const top = scored.slice(0, topN);

  // 重新编号 rank,把 hotScore 存入 total_score
  return top.map((item, i) => ({
    ...item.seed,
    rank: i + 1,
    total_score: Math.round(item.hotScore * 10000) / 10000, // 保留 4 位小数
  }));
}

export async function runWeeklyTrending(_opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('weekly-trending');
  try {
    const client = getAdminClient();
    const rawSeeds = await collectSeeds();
    if (rawSeeds.length === 0) {
      await finishRun(runId, 'success', { count: 0 });
      log('无热点数据');
      return;
    }

    // 跨源去重 + 热度排名 Top-N
    const seeds = deduplicateAndTopN(rawSeeds);
    log(`去重后 ${seeds.length} 条(Top ${TOP_N},原始 ${rawSeeds.length} 条)`);

    const names = Array.from(new Set(seeds.map((s) => s.repo_name)));
    const date = getMonday(); // 使用本周一作为 captured_date

    // 查询历史上榜周数(排除本周,保证同周重跑幂等)
    const weekMap = await getWeeksOnTrending(names, date);
    log(`查询到 ${weekMap.size} 个仓库的历史上榜周数`);

    // 已在库的仓
    const nameToId = new Map<string, number>();
    for (let i = 0; i < names.length; i += 500) {
      const chunk = names.slice(i, i + 500);
      const { data } = await client.from('repositories').select('id, full_name').in('full_name', chunk);
      for (const r of (data ?? []) as { id: number; full_name: string }[]) nameToId.set(r.full_name, r.id);
    }

    // GraphQL 富化 Top-N 全部仓库(不只是新仓):
    // trending 两个来源都给不出可靠的仓库总 star 数(OSS Insight 只有周增量,
    // GitHub Trending 页面解析是 best-effort),这里统一以 stargazerCount 为准,
    // 顺带补齐新仓的 id/元数据/工程文件信号。Top-10 只占一次 GraphQL 批量请求。
    const totals = new Map<string, { stars: number; forks: number }>();
    const enrichable = names.filter((n) => n.includes('/'));
    if (enrichable.length) {
      log(`富化 ${enrichable.length} 个热点仓(取总 star 数 + 新仓元数据)...`);
      const enriched = await batchEnrich(
        enrichable.map((n) => {
          const [owner, name] = n.split('/');
          return { owner, name, full_name: n };
        }),
      );
      const repoRows: Record<string, unknown>[] = [];
      const sigRows: Record<string, unknown>[] = [];
      for (const e of enriched) {
        if (!e.found || e.id == null || !e.owner || !e.name) continue;
        nameToId.set(e.full_name, e.id);
        totals.set(e.full_name, { stars: e.stars, forks: e.forks });
        repoRows.push({
          id: e.id,
          full_name: e.full_name,
          owner: e.owner,
          name: e.name,
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
        });
        sigRows.push({
          repository_id: e.id,
          has_oh_package: e.has_oh_package,
          has_build_profile: e.has_build_profile,
          has_module_json5: e.has_module_json5,
          has_hvigor: e.has_hvigor,
          has_entry_dir: e.has_entry_dir,
          has_ets: e.has_ets,
        });
      }
      await upsertBatched('repositories', repoRows, { onConflict: 'id' });
      await upsertBatched('harmony_signals', sigRows, { onConflict: 'repository_id' });
    }

    // 落库快照(带 repository_id,去重后每条 repo 只写一行)
    const snapRows = seeds.map((s) => ({
      captured_date: date,
      source: s.source,
      repo_name: s.repo_name,
      repository_id: nameToId.get(s.repo_name) ?? null,
      primary_language: s.primary_language,
      description: s.description,
      // 总量以 GraphQL 为准,拿不到时回落到 trending 页面解析出的值
      stars: totals.get(s.repo_name)?.stars ?? s.stars,
      forks: totals.get(s.repo_name)?.forks ?? s.forks,
      stars_delta: s.stars_delta,
      forks_delta: s.forks_delta,
      total_score: s.total_score,
      rank: s.rank,
      weeks_on_trending: (weekMap.get(s.repo_name) ?? 0) + 1, // 历史周数 + 本次
    }));
    // 注意:去重后 unique 约束是 (captured_date, repo_name)
    await upsertBatched('trending_snapshots', snapRows, { onConflict: 'captured_date,repo_name' });

    // 对热点仓做增量鸿蒙分析(信号 → tier-1 分类 → 评分)
    const ids = Array.from(new Set(Array.from(nameToId.values())));
    if (ids.length) {
      log(`对 ${ids.length} 个热点仓做增量分析...`);
      await runHarmonySignals({ ids });
      await runLlmClassify({ ids });
      await runScore({ ids });
    }

    await finishRun(runId, 'success', {
      raw_seeds: rawSeeds.length,
      snapshots: snapRows.length,
      analyzed: ids.length,
    });
    log(`weekly-trending 完成:原始 ${rawSeeds.length} → 去重 Top${TOP_N} ${snapRows.length}、分析 ${ids.length}`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWeeklyTrending().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
