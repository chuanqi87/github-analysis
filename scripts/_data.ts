// 阶段间共享的数据加载器(repositories / harmony_signals / deepwiki_analysis)。
import { getAdminClient } from '@/lib/supabase/admin';
import type { CollectedSignals } from '@/lib/harmony/signals';
import {
  HARMONY_SCOPES,
  PROJECT_TYPES,
  type DeepwikiFacts,
  type HarmonyScope,
  type ProjectType,
} from '@/lib/deepwiki';
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
  is_archived: boolean;
  archived_reason: string | null;
  /** 最近一次 commit 时间;DeepWiki 阶段用作幂等键(仓库没新提交就不必重问) */
  pushed_at: string | null;
}

export async function loadStageRepos(opts: StageOpts): Promise<StageRepo[]> {
  const client = getAdminClient();
  let q = client
    .from('repositories')
    .select('id, full_name, owner, name, description, primary_language, topics, stars, license, readme_text, is_archived, archived_reason, pushed_at')
    .order('stars', { ascending: false });
  if (opts.ids?.length) q = q.in('id', opts.ids);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`加载 repositories 失败:${error.message}`);
  return (data ?? []).map((r) => ({
    ...(r as StageRepo),
    topics: (r as StageRepo).topics ?? [],
    is_archived: (r as any).is_archived ?? false,
    archived_reason: (r as any).archived_reason ?? null,
    pushed_at: (r as any).pushed_at ?? null,
  }));
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
  gitcode_matched: boolean;
  gitcode_repo_url: string | null;
  gitcode_repo_name: string | null;
  deepwiki_scope: string | null;
}

export async function loadSignalsMap(ids: number[]): Promise<Map<number, CollectedSignals>> {
  const client = getAdminClient();
  const map = new Map<number, CollectedSignals>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('harmony_signals')
      .select(
        'repository_id, ohpm_matched, ohpm_packages, has_oh_package, has_build_profile, has_module_json5, has_hvigor, has_entry_dir, has_ets, in_registry, registry_source, source_repo_url, keyword_score, auto_state_hint, gitcode_matched, gitcode_repo_url, gitcode_repo_name, deepwiki_scope',
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
        gitcode_matched: r.gitcode_matched ?? false,
        gitcode_repo_url: r.gitcode_repo_url ?? null,
        gitcode_repo_name: r.gitcode_repo_name ?? null,
        deepwiki_scope:
          r.deepwiki_scope && (HARMONY_SCOPES as readonly string[]).includes(r.deepwiki_scope)
            ? (r.deepwiki_scope as HarmonyScope)
            : null,
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
  gitcode_matched: false,
  gitcode_repo_url: null,
  gitcode_repo_name: null,
  deepwiki_scope: null,
};

export function signalsFor(map: Map<number, CollectedSignals>, id: number): CollectedSignals {
  return map.get(id) ?? EMPTY_SIGNALS;
}

// ─── DeepWiki 代码事实 ───────────────────────────────────────────────────────

interface DeepwikiRow {
  repository_id: number;
  indexed: boolean;
  wiki_toc: string | null;
  harmony_scope: string | null;
  harmony_paths: string[] | null;
  harmony_quote: string | null;
  harmony_declares_support: boolean | null;
  ohos_imports: string[] | null;
  project_type: string | null;
  languages: string[] | null;
  native_code_ratio: number | null;
  has_platform_abstraction: boolean | null;
  platform_layer_paths: string[] | null;
  existing_platform_backends: string[] | null;
  portable_core_paths: string[] | null;
  blocking_deps: { name: string; why: string }[] | null;
  platform_apis_used: string[] | null;
  conditional_compilation: string[] | null;
}

/**
 * 加载 DeepWiki 事实。
 *
 * 注意不取 raw_answers / extra —— 它们体积大(单仓可达数十 KB)且 prompt 用不上,
 * 全量拉会把这个查询变成瓶颈。需要原文时单独按 id 查。
 */
export async function loadDeepwikiMap(ids: number[]): Promise<Map<number, DeepwikiFacts>> {
  const client = getAdminClient();
  const map = new Map<number, DeepwikiFacts>();
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    const { data, error } = await client
      .from('deepwiki_analysis')
      .select(
        'repository_id, indexed, wiki_toc, harmony_scope, harmony_paths, harmony_quote, harmony_declares_support, ohos_imports, project_type, languages, native_code_ratio, has_platform_abstraction, platform_layer_paths, existing_platform_backends, portable_core_paths, blocking_deps, platform_apis_used, conditional_compilation',
      )
      .in('repository_id', chunk);
    // DeepWiki 是可选依赖:表不存在或查询失败都只降级,不阻断管道
    if (error) {
      console.warn(`[_data] 加载 deepwiki_analysis 失败(降级为无代码事实):${error.message}`);
      return map;
    }
    for (const r of (data ?? []) as DeepwikiRow[]) {
      const scope: HarmonyScope | null =
        r.harmony_scope && (HARMONY_SCOPES as readonly string[]).includes(r.harmony_scope)
          ? (r.harmony_scope as HarmonyScope)
          : null;
      const projectType: ProjectType | null =
        r.project_type && (PROJECT_TYPES as readonly string[]).includes(r.project_type)
          ? (r.project_type as ProjectType)
          : null;
      const hasHarmony = scope !== null || (r.harmony_paths?.length ?? 0) > 0;
      const hasPorting =
        r.project_type !== null ||
        (r.platform_layer_paths?.length ?? 0) > 0 ||
        (r.languages?.length ?? 0) > 0;

      map.set(r.repository_id, {
        indexed: r.indexed,
        wiki_toc: r.wiki_toc,
        harmony: hasHarmony
          ? {
              harmony_scope: scope,
              harmony_paths: r.harmony_paths ?? [],
              harmony_quote: r.harmony_quote,
              declares_harmony_support: r.harmony_declares_support,
              ohos_imports: r.ohos_imports ?? [],
            }
          : null,
        porting: hasPorting
          ? {
              project_type: projectType,
              languages: r.languages ?? [],
              native_code_ratio: r.native_code_ratio,
              has_platform_abstraction: r.has_platform_abstraction,
              platform_layer_paths: r.platform_layer_paths ?? [],
              existing_platform_backends: r.existing_platform_backends ?? [],
              portable_core_paths: r.portable_core_paths ?? [],
              blocking_deps: r.blocking_deps ?? [],
              platform_apis_used: r.platform_apis_used ?? [],
              conditional_compilation: r.conditional_compilation ?? [],
            }
          : null,
        extra: null,
        raw_answers: {},
      });
    }
  }
  return map;
}

export function deepwikiFor(
  map: Map<number, DeepwikiFacts>,
  id: number,
): DeepwikiFacts | null {
  return map.get(id) ?? null;
}
