// 汇总鸿蒙化自动信号(仅辅助人工审核,不做最终判定)。
import type { HarmonyState } from '@/lib/types';
import { keywordHits, keywordScore } from '@/lib/harmony/keywords';
import { findOhpmPackage } from '@/lib/harmony/ohpm';
import { matchRegistry, type RegistryIndex } from '@/lib/harmony/registry';

export interface SignalRepo {
  full_name: string;
  name: string;
  description: string | null;
  topics: string[];
}

/** 鸿蒙工程文件标志(由 GraphQL enrich 探测,阶段间经 DB 传递)。 */
export interface HarmonyFileFlags {
  has_oh_package: boolean;
  has_build_profile: boolean;
  has_module_json5: boolean;
  has_hvigor: boolean;
  has_entry_dir: boolean;
  has_ets: boolean;
}

export interface CollectedSignals {
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
  auto_state_hint: HarmonyState;
  signals: Record<string, unknown>;
}

function decideHint(s: {
  ohpm: boolean;
  project: boolean;
  registry: boolean;
  ets: boolean;
  kw: number;
}): { state: HarmonyState; suspected: boolean } {
  if (s.ohpm) return { state: 'ADAPTED', suspected: false };
  if (s.project) return { state: 'PARTIAL', suspected: false };
  if (s.registry) return { state: 'PARTIAL', suspected: false };
  if (s.ets || s.kw >= 0.5) return { state: 'NOT_ADAPTED', suspected: true };
  return { state: 'NOT_ADAPTED', suspected: false };
}

export async function collectHarmonySignals(
  repo: SignalRepo,
  files: HarmonyFileFlags,
  registry: RegistryIndex,
  readmeText?: string | null,
  opts: { checkOhpm?: boolean } = {},
): Promise<CollectedSignals> {
  const hasOhPackage = files.has_oh_package;
  const hasBuildProfile = files.has_build_profile;
  const hasModuleJson = files.has_module_json5;
  const hasHvigor = files.has_hvigor;
  const hasEntry = files.has_entry_dir;
  const hasEts = files.has_ets;
  const project = hasOhPackage || hasBuildProfile || hasModuleJson || hasHvigor || hasEntry;

  const reg = matchRegistry(registry, repo);

  const kwText = [readmeText, repo.description, repo.topics.join(' ')].filter(Boolean).join('\n');
  const kwScore = keywordScore(kwText);
  const kwList = keywordHits(kwText);

  // 有任何提示才去探测 ohpm(控制请求量);默认开启。
  const shouldOhpm =
    (opts.checkOhpm ?? true) && (reg.hit || project || hasEts || kwScore >= 0.25);
  let ohpmMatched = false;
  let ohpmPackages: { pkg: string; repository: string | null }[] | null = null;
  let sourceRepoUrl: string | null = null;
  if (shouldOhpm) {
    const found = await findOhpmPackage(repo.name);
    if (found) {
      ohpmMatched = true;
      ohpmPackages = [{ pkg: found.pkg, repository: found.repository }];
      sourceRepoUrl = found.repository;
    }
  }

  const hint = decideHint({
    ohpm: ohpmMatched,
    project,
    registry: reg.hit,
    ets: hasEts,
    kw: kwScore,
  });

  return {
    ohpm_matched: ohpmMatched,
    ohpm_packages: ohpmPackages,
    has_oh_package: hasOhPackage,
    has_build_profile: hasBuildProfile,
    has_module_json5: hasModuleJson,
    has_hvigor: hasHvigor,
    has_entry_dir: hasEntry,
    has_ets: hasEts,
    in_registry: reg.hit,
    registry_source: reg.hit ? reg.source : null,
    source_repo_url: sourceRepoUrl,
    keyword_score: kwScore,
    auto_state_hint: hint.state,
    signals: {
      suspected: hint.suspected,
      keyword_hits: kwList,
      registry_match: reg,
      probed_ohpm: shouldOhpm,
    },
  };
}
