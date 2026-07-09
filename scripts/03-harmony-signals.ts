// 阶段3:采集鸿蒙化辅助信号(ohpm / 底表 / 关键词),写 harmony_signals + auto_state_hint。
import 'dotenv/config';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';
import { loadRegistry } from '@/lib/harmony/registry';
import { collectHarmonySignals, type HarmonyFileFlags } from '@/lib/harmony/signals';
import { startRun, finishRun } from '@/lib/pipeline/runlog';
import { log, pMap, type StageOpts } from '@/scripts/_common';

interface RepoRow {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  topics: string[];
  readme_text: string | null;
}

async function loadRepos(opts: StageOpts): Promise<RepoRow[]> {
  const client = getAdminClient();
  let q = client
    .from('repositories')
    .select('id, full_name, name, description, topics, readme_text')
    .order('stars', { ascending: false });
  if (opts.ids?.length) q = q.in('id', opts.ids);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`加载 repositories 失败:${error.message}`);
  return (data ?? []) as RepoRow[];
}

async function loadFileFlags(ids: number[]): Promise<Map<number, HarmonyFileFlags>> {
  const client = getAdminClient();
  const map = new Map<number, HarmonyFileFlags>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('harmony_signals')
      .select('repository_id, has_oh_package, has_build_profile, has_module_json5, has_hvigor, has_entry_dir, has_ets')
      .in('repository_id', chunk);
    if (error) throw new Error(`加载 harmony_signals 失败:${error.message}`);
    for (const r of (data ?? []) as (HarmonyFileFlags & { repository_id: number })[]) {
      map.set(r.repository_id, r);
    }
  }
  return map;
}

const EMPTY_FLAGS: HarmonyFileFlags = {
  has_oh_package: false,
  has_build_profile: false,
  has_module_json5: false,
  has_hvigor: false,
  has_entry_dir: false,
  has_ets: false,
};

export async function runHarmonySignals(opts: StageOpts = {}): Promise<void> {
  const runId = await startRun('harmony-signals');
  try {
    log('加载鸿蒙三方库底表...');
    const registry = await loadRegistry();
    log(`底表条目 ${registry.entries.length} 个`);

    const repos = await loadRepos(opts);
    const flags = await loadFileFlags(repos.map((r) => r.id));
    log(`采集 ${repos.length} 个仓库的鸿蒙信号...`);

    let done = 0;
    const rows = await pMap(
      repos,
      async (repo) => {
        const files = flags.get(repo.id) ?? EMPTY_FLAGS;
        const sig = await collectHarmonySignals(
          { full_name: repo.full_name, name: repo.name, description: repo.description, topics: repo.topics ?? [] },
          files,
          registry,
          repo.readme_text,
        );
        done++;
        if (done % 200 === 0) log(`  信号进度 ${done}/${repos.length}`);
        return { repository_id: repo.id, ...sig, checked_at: new Date().toISOString() };
      },
      8,
    );

    await upsertBatched('harmony_signals', rows, { onConflict: 'repository_id' });
    await finishRun(runId, 'success', { count: rows.length });
    log(`harmony-signals 完成:${rows.length} 条`);
  } catch (err) {
    await finishRun(runId, 'failed', { error: String(err) });
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHarmonySignals().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
