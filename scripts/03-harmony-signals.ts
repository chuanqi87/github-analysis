// 阶段3:采集鸿蒙化辅助信号(ohpm / 底表 / 关键词 / GitCode),写 harmony_signals + auto_state_hint。
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

// PostgREST 单次查询硬上限 1000 行,全量刷新必须 range 分页。
const PAGE_SIZE = 1000;

async function loadRepos(opts: StageOpts): Promise<RepoRow[]> {
  const client = getAdminClient();
  const selectStr = 'id, full_name, name, description, topics, readme_text';
  // ids 模式:候选集小(每日热点),单次查询即可
  if (opts.ids?.length) {
    const { data, error } = await client
      .from('repositories')
      .select(selectStr)
      .in('id', opts.ids)
      .order('stars', { ascending: false });
    if (error) throw new Error(`加载 repositories 失败:${error.message}`);
    return (data ?? []) as RepoRow[];
  }
  // 全量模式:range 分页,绕过 PostgREST 1000 行上限
  const out: RepoRow[] = [];
  const cap = opts.limit ?? Number.MAX_SAFE_INTEGER;
  for (let from = 0; out.length < cap; from += PAGE_SIZE) {
    const take = Math.min(PAGE_SIZE, cap - out.length);
    const { data, error } = await client
      .from('repositories')
      .select(selectStr)
      .order('stars', { ascending: false })
      .range(from, from + take - 1);
    if (error) throw new Error(`加载 repositories 失败:${error.message}`);
    const rows = (data ?? []) as RepoRow[];
    out.push(...rows);
    if (rows.length < take) break; // 已取尽
  }
  return out;
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
    log(`采集 ${repos.length} 个仓库的鸿蒙信号(含 GitCode 搜索)...`);

    let done = 0;
    let gitcodeHits = 0;
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
        if (sig.gitcode_matched) gitcodeHits++;
        if (done % 20 === 0) log(`  信号进度 ${done}/${repos.length} (GitCode命中:${gitcodeHits})`);
        return {
          repository_id: repo.id,
          ...sig,
          checked_at: new Date().toISOString(),
          // 写入 GitCode 新字段
          gitcode_matched: sig.gitcode_matched,
          gitcode_repo_url: sig.gitcode_repo_url,
          gitcode_repo_name: sig.gitcode_repo_name,
        };
      },
      4, // 降低并发避免 GitCode 限流
    );

    await upsertBatched('harmony_signals', rows, { onConflict: 'repository_id' });
    await finishRun(runId, 'success', { count: rows.length, gitcode_hits: gitcodeHits });
    log(`harmony-signals 完成:${rows.length} 条 (GitCode命中:${gitcodeHits})`);
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
