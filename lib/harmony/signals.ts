// 汇总鸿蒙化自动信号(仅辅助人工审核,不做最终判定)。
import type { HarmonyState } from '@/lib/types';
import { keywordHits, keywordScore } from '@/lib/harmony/keywords';
import { findOhpmPackage } from '@/lib/harmony/ohpm';
import { matchRegistry, type RegistryIndex } from '@/lib/harmony/registry';
import { searchGitCodeWithKnown, isTrustedGitcodeOrg } from '@/lib/harmony/gitcode';
import type { DeepwikiFacts, HarmonyScope } from '@/lib/deepwiki';

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
  // GitCode 搜索结果
  gitcode_matched: boolean;
  gitcode_repo_url: string | null;
  gitcode_repo_name: string | null;
  // DeepWiki 代码级检索出的鸿蒙证据分级(仅 dedicated_port 构成适配证据)
  deepwiki_scope: HarmonyScope | null;
}

function decideHint(s: {
  ohpm: boolean;
  project: boolean;
  registry: boolean;
  ets: boolean;
  kw: number;
  gitcode: boolean;
  gitcodeTrusted: boolean;
  /** DeepWiki 代码级证据分级;只有 dedicated_port 算数 */
  deepwikiPort: boolean;
}): { state: HarmonyState; suspected: boolean } {
  if (s.ohpm) return { state: 'ADAPTED', suspected: false };
  // GitCode 官方组织(SIG/TPC)适配仓才提示 ADAPTED;其余搜索命中可信度低,降级 PARTIAL
  if (s.gitcode && s.gitcodeTrusted) return { state: 'ADAPTED', suspected: true };
  if (s.project) return { state: 'PARTIAL', suspected: false };
  // DeepWiki 在仓库里找到了专门的鸿蒙实现(独立目录/ArkTS 源码/oh-package 工程)。
  // 与 project 同级:是代码事实,但没有"已发包"那么硬,所以到 PARTIAL 为止。
  // 注意 build_target_only / incidental_mention 在调用处就被挡掉了,不会走到这里 ——
  // 否则 next.js 那种"构建矩阵里带一个 openharmony 目标"会被误判为已适配。
  if (s.deepwikiPort) return { state: 'PARTIAL', suspected: false };
  if (s.registry) return { state: 'PARTIAL', suspected: false };
  if (s.gitcode) return { state: 'PARTIAL', suspected: true };
  if (s.ets || s.kw >= 0.5) return { state: 'NOT_ADAPTED', suspected: true };
  return { state: 'NOT_ADAPTED', suspected: false };
}

export async function collectHarmonySignals(
  repo: SignalRepo,
  files: HarmonyFileFlags,
  registry: RegistryIndex,
  readmeText?: string | null,
  opts: { checkOhpm?: boolean; checkGitCode?: boolean } = {},
  /** DeepWiki 代码事实(可选);未取数或未索引时降级为不参与判定 */
  facts?: DeepwikiFacts | null,
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

  // GitCode 搜索:查找是否有鸿蒙适配版本
  let gitcodeMatched = false;
  let gitcodeRepoUrl: string | null = null;
  let gitcodeRepoName: string | null = null;
  
  const shouldGitCode = opts.checkGitCode ?? true;
  if (shouldGitCode) {
    try {
      const gitResult = await searchGitCodeWithKnown(repo.full_name, repo.name);
      gitcodeMatched = gitResult.matched;
      gitcodeRepoUrl = gitResult.repo_url;
      gitcodeRepoName = gitResult.repo_name;
    } catch {
      // GitCode 搜索失败不影响整体流程
    }
  }

  // 只有 dedicated_port 构成适配证据;build_target_only / incidental_mention 一律不算。
  const deepwikiScope = (facts?.indexed && facts.harmony?.harmony_scope) || null;
  const deepwikiPort = deepwikiScope === 'dedicated_port';

  const hint = decideHint({
    ohpm: ohpmMatched,
    project,
    registry: reg.hit,
    ets: hasEts,
    kw: kwScore,
    gitcode: gitcodeMatched,
    gitcodeTrusted: isTrustedGitcodeOrg(gitcodeRepoUrl),
    deepwikiPort,
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
      gitcode_searched: shouldGitCode,
      gitcode_org_trusted: gitcodeMatched && isTrustedGitcodeOrg(gitcodeRepoUrl),
      deepwiki_indexed: facts?.indexed ?? false,
      deepwiki_harmony_paths: facts?.harmony?.harmony_paths ?? [],
    },
    gitcode_matched: gitcodeMatched,
    gitcode_repo_url: gitcodeRepoUrl,
    gitcode_repo_name: gitcodeRepoName,
    deepwiki_scope: deepwikiScope,
  };
}
