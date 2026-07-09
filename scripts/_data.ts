// 阶段间共享的数据加载器(repositories / harmony_signals)。
import { getAdminClient } from '@/lib/supabase/admin';
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { HarmonyState } from '@/lib/types';
import type { StageOpts } from '@/scripts/_common';

export interface StageRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
  stars: number;
  license: string | null;
  readme_text: string | null;
}

export async function loadStageRepos(opts: StageOpts): Promise<StageRepo[]> {
  const client = getAdminClient();
  let q = client
    .from('repositories')
    .select('id, full_name, owner, name, description, primary_language, topics, stars, license, readme_text')
    .order('stars', { ascending: false });
  if (opts.ids?.length) q = q.in('id', opts.ids);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`加载 repositories 失败:${error.message}`);
  return (data ?? []).map((r) => ({ ...(r as StageRepo), topics: (r as StageRepo).topics ?? [] }));
}

interface SignalRow {
  repository_id: number;
  ohpm_matched: boolean;
  ohpm_packages: { pkg: string; repository: string | null }[] | null;
  has_oh_package: boolean;
  has_build_profile: boolean;
  has_module_json5: boolean;
  has_hvigor: boolean;
  has_entry_dir: boolean;
  has_ets: boolean;
  in_registry: boolean;
  registry_source: string | null;
  source_repo_url: string | null;
  keyword_score: number;
  auto_state_hint: HarmonyState | null;
}

export async function loadSignalsMap(ids: number[]): Promise<Map<number, CollectedSignals>> {
  const client = getAdminClient();
  const map = new Map<number, CollectedSignals>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('harmony_signals')
      .select(
        'repository_id, ohpm_matched, ohpm_packages, has_oh_package, has_build_profile, has_module_json5, has_hvigor, has_entry_dir, has_ets, in_registry, registry_source, source_repo_url, keyword_score, auto_state_hint',
      )
      .in('repository_id', chunk);
    if (error) throw new Error(`加载 harmony_signals 失败:${error.message}`);
    for (const r of (data ?? []) as SignalRow[]) {
      map.set(r.repository_id, {
        ohpm_matched: r.ohpm_matched,
        ohpm_packages: r.ohpm_packages,
        has_oh_package: r.has_oh_package,
        has_build_profile: r.has_build_profile,
        has_module_json5: r.has_module_json5,
        has_hvigor: r.has_hvigor,
        has_entry_dir: r.has_entry_dir,
        has_ets: r.has_ets,
        in_registry: r.in_registry,
        registry_source: r.registry_source,
        source_repo_url: r.source_repo_url,
        keyword_score: r.keyword_score,
        auto_state_hint: r.auto_state_hint ?? 'NOT_ADAPTED',
        signals: {},
      });
    }
  }
  return map;
}

const EMPTY_SIGNALS: CollectedSignals = {
  ohpm_matched: false,
  ohpm_packages: null,
  has_oh_package: false,
  has_build_profile: false,
  has_module_json5: false,
  has_hvigor: false,
  has_entry_dir: false,
  has_ets: false,
  in_registry: false,
  registry_source: null,
  source_repo_url: null,
  keyword_score: 0,
  auto_state_hint: 'NOT_ADAPTED',
  signals: {},
};

export function signalsFor(map: Map<number, CollectedSignals>, id: number): CollectedSignals {
  return map.get(id) ?? EMPTY_SIGNALS;
}
