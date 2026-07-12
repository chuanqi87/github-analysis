// 每周热点:抓取 trending → 跨源去重 + 热度排名 Top-N → 落库快照 → 补齐新仓 → 对热点仓做增量鸿蒙分析。
import 'dotenv/config';
import { fetchTrending } from '@/lib/sources/ossinsight';
import { fetchGithubTrending } from '@/lib/sources/githubTrending';
import { batchEnrich } from '@/lib/github/graphql';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, today, type StageOpts } from '@/scripts/_common';
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
  stars: number | null;
  forks: number | null;
  total_score: number | null;
  rank: number | null;
}

/**
 * 获取本周一的日期(ISO 周)
 */
function getMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // 调整周日为 -6
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

/**
 * 查询仓库的历史上榜周数
 * 通过统计 distinct DATE_TRUNC('week', captured_date) 来计算
 */
async function getWeeksOnTrending(repoNames: string[]): Promise<Map<string, number>> {
  const client = getAdminClient();
  const weekMap = new Map<string, number>();
  
  if (repoNames.length === 0) return weekMap;

  // 分批查询(每批最多 500 个)
  for (let i = 0; i < repoNames.length; i += 500) {
    const chunk = repoNames.slice(i, i + 500);
    const { data, error } = await client.rpc('count_trending_weeks', {
      p_repo_names: chunk,
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
        stars: it.stars,
        forks: it.forks,
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
        stars: null,
        forks: null,
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

/**
 * 跨数据源去重 + 热度排名。
 *
 * 策略:
 * 1. 按 repo_name 分组,同一项目出现在多个来源时合并为一条;
 * 2. 热度分 = Σ(1/rank) 各来源倒数排名之和,出现在多源的项目自然获得加权;
 * 3. 按热度分降序取 Top-N,重新编号 rank 1..N;
 * 4. 元数据(stars/language/description)优先取 OSS Insight(数据更全)。
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

  for (const [, entries] of grouped) {
    // 优先取 OSS Insight 数据(stars/forks/total_score 更全)
    const ossEntry = entries.find((e) => e.source === 'ossinsight');
    const bestData = ossEntry ?? entries[0];

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
        ...bestData,
        // 多来源用逗号拼接
        source: sources.join(','),
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

    // 查询历史上榜周数
    const weekMap = await getWeeksOnTrending(names);
    log(`查询到 ${weekMap.size} 个仓库的历史上榜周数`);

    // 已在库的仓
    const nameToId = new Map<string, number>();
    for (let i = 0; i < names.length; i += 500) {
      const chunk = names.slice(i, i + 500);
      const { data } = await client.from('repositories').select('id, full_name').in('full_name', chunk);
      for (const r of (data ?? []) as { id: number; full_name: string }[]) nameToId.set(r.full_name, r.id);
    }

    // 补齐新仓(GraphQL 富化拿 id + 元数据 + 工程文件信号)
    const missing = names.filter((n) => !nameToId.has(n) && n.includes('/'));
    if (missing.length) {
      log(`补齐 ${missing.length} 个新仓...`);
      const enriched = await batchEnrich(
        missing.map((n) => {
          const [owner, name] = n.split('/');
          return { owner, name, full_name: n };
        }),
      );
      const repoRows: Record<string, unknown>[] = [];
      const sigRows: Record<string, unknown>[] = [];
      for (const e of enriched) {
        if (!e.found || e.id == null || !e.owner || !e.name) continue;
        nameToId.set(e.full_name, e.id);
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
    const date = getMonday(); // 使用本周一作为 captured_date
    const snapRows = seeds.map((s) => ({
      captured_date: date,
      source: s.source,
      repo_name: s.repo_name,
      repository_id: nameToId.get(s.repo_name) ?? null,
      primary_language: s.primary_language,
      description: s.description,
      stars: s.stars,
      forks: s.forks,
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
