// 每日热点:抓取 trending → 落库快照 → 补齐新仓 → 对热点仓做增量鸿蒙分析。
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

async function collectSeeds(): Promise<SnapshotSeed[]> {
  const seeds: SnapshotSeed[] = [];
  try {
    const oss = await fetchTrending('past_24_hours');
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
    const gh = await fetchGithubTrending('daily');
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

export async function runDailyTrending(_opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('daily-trending');
  try {
    const client = getAdminClient();
    const seeds = await collectSeeds();
    const names = Array.from(new Set(seeds.map((s) => s.repo_name)));
    if (names.length === 0) {
      await finishRun(runId, 'success', { count: 0 });
      log('无热点数据');
      return;
    }

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

    // 落库快照(带 repository_id)
    const date = today();
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
    }));
    await upsertBatched('trending_snapshots', snapRows, { onConflict: 'captured_date,source,repo_name' });

    // 对热点仓做增量鸿蒙分析(信号 → tier-1 分类 → 评分)
    const ids = Array.from(new Set(Array.from(nameToId.values())));
    if (ids.length) {
      log(`对 ${ids.length} 个热点仓做增量分析...`);
      await runHarmonySignals({ ids });
      await runLlmClassify({ ids });
      await runScore({ ids });
    }

    await finishRun(runId, 'success', { snapshots: snapRows.length, analyzed: ids.length });
    log(`daily-trending 完成:快照 ${snapRows.length}、分析 ${ids.length}`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyTrending().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
