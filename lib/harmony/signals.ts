// 汇总鸿蒙化自动信号(仅辅助人工审核,不做最终判定)。
import type {
  HarmonyState,
  SupportAvailability,
  SupportCoverage,
  SupportEvidence,
  SupportProvenance,
} from '@/lib/types';
import { keywordHits, keywordScore } from '@/lib/harmony/keywords';
import { findOhpmPackage } from '@/lib/harmony/ohpm';
import { matchRegistry, type RegistryIndex } from '@/lib/harmony/registry';
import {
  findHarmonyPort,
  harmonyPortSource,
  isTrustedHarmonyPortOrg,
  type HarmonyPortSource,
} from '@/lib/harmony/ports';
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
  support_availability: SupportAvailability;
  support_provenance: SupportProvenance;
  support_coverage: SupportCoverage;
  support_confidence: number;
  support_evidence: SupportEvidence[];
  signals: Record<string, unknown>;
  // GitCode 搜索结果
  gitcode_matched: boolean;
  gitcode_repo_url: string | null;
  gitcode_repo_name: string | null;
  /** 实际生态移植仓平台；gitcode_* 是历史兼容字段，URL 也可能来自 Gitee。 */
  ecosystem_port_source: HarmonyPortSource;
  ecosystem_port_capabilities: string[];
  ecosystem_port_evidence_urls: string[];
  // DeepWiki 代码级检索出的鸿蒙证据分级(仅 dedicated_port 构成适配证据)
  deepwiki_scope: HarmonyScope | null;
  /** 管理台人工标记是最终权威；分析机会时必须优先扣除其确认的支持范围。 */
  manual_override?: { state: HarmonyState; note: string | null; marked_at: string } | null;
}

export interface SupportAssessment {
  availability: SupportAvailability;
  provenance: SupportProvenance;
  coverage: SupportCoverage;
  confidence: number;
  evidence: SupportEvidence[];
}

export interface SupportAssessmentInput {
  ohpmMatched: boolean;
  ohpmPackages?: { pkg: string; repository: string | null }[] | null;
  upstreamProject: boolean;
  upstreamPaths?: string[];
  gitcodeMatched: boolean;
  gitcodeRepoUrl: string | null;
  ecosystemPortCapabilities?: string[];
  ecosystemPortEvidenceUrls?: string[];
  registryMatched: boolean;
  registrySource: string | null;
  deepwikiScope: HarmonyScope | null;
  deepwikiPaths?: string[];
  ohpmChecked: boolean;
  gitcodeChecked: boolean;
  deepwikiIndexed: boolean;
}

/**
 * 从可核验信号推导“已支持现状”。没有证据时保持 UNKNOWN；只有完成主要来源检索且
 * 代码索引明确无痕迹时，才使用 NO_PUBLIC_SUPPORT_FOUND。
 */
export function deriveSupportAssessment(input: SupportAssessmentInput): SupportAssessment {
  const evidence: SupportEvidence[] = [];
  if (input.ohpmMatched) {
    for (const item of input.ohpmPackages ?? []) {
      evidence.push({ source: 'ohpm', kind: 'package', reference: item.pkg, strength: 'strong' });
    }
    return {
      availability: 'USABLE',
      provenance: 'OFFICIAL_ECOSYSTEM',
      // 发包只能证明存在可消费产物，不能证明组件/API/版本覆盖范围。
      coverage: 'UNKNOWN',
      confidence: 0.95,
      evidence,
    };
  }

  if (input.gitcodeMatched && isTrustedHarmonyPortOrg(input.gitcodeRepoUrl)) {
    evidence.push({
      source: harmonyPortSource(input.gitcodeRepoUrl) === 'gitee' ? 'gitee' : 'gitcode',
      kind: 'community_port',
      reference: input.gitcodeRepoUrl ?? '鸿蒙生态官方组织移植仓',
      strength: 'strong',
    });
    for (const reference of input.ecosystemPortEvidenceUrls ?? []) {
      evidence.push({
        source: harmonyPortSource(reference) === 'gitee' ? 'gitee' : 'gitcode',
        kind: 'source_code',
        reference,
        strength: 'strong',
      });
    }
    return {
      availability: 'USABLE',
      provenance: 'OFFICIAL_ECOSYSTEM',
      // 发现独立移植仓不能据此猜测覆盖完整度；需进一步审计该仓版本与功能矩阵。
      coverage: 'UNKNOWN',
      confidence: 0.85,
      evidence,
    };
  }

  // DeepWiki 的显式 scope 比 GraphQL 的粗粒度文件标志更具体。构建矩阵里出现
  // HarmonyOS 时，即使同时命中 oh-package/entry 等弱工程标志，也不能升级成适配。
  if (input.deepwikiScope === 'build_target_only') {
    for (const path of (input.deepwikiPaths ?? []).slice(0, 10)) {
      evidence.push({ source: 'deepwiki', kind: 'build_target', reference: path, strength: 'strong' });
    }
    return {
      availability: 'BUILD_TARGET_ONLY',
      provenance: 'UPSTREAM',
      coverage: 'BUILD_ONLY',
      confidence: 0.9,
      evidence,
    };
  }

  if (input.upstreamProject || input.deepwikiScope === 'dedicated_port') {
    for (const path of [...(input.upstreamPaths ?? []), ...(input.deepwikiPaths ?? [])].slice(0, 10)) {
      evidence.push({ source: 'upstream', kind: 'project_files', reference: path, strength: 'strong' });
    }
    return {
      availability: 'PARTIAL',
      provenance: 'UPSTREAM',
      coverage: 'SUBMODULE',
      confidence: evidence.length ? 0.85 : 0.72,
      evidence,
    };
  }

  if (input.registryMatched || input.gitcodeMatched) {
    const reference = input.gitcodeRepoUrl ?? input.registrySource ?? '鸿蒙三方库底表';
    evidence.push({
      source: input.gitcodeMatched && harmonyPortSource(input.gitcodeRepoUrl) === 'gitee'
        ? 'gitee'
        : input.gitcodeMatched ? 'gitcode' : 'registry',
      kind: 'community_port',
      reference,
      strength: input.gitcodeMatched ? 'weak' : 'medium',
    });
    return {
      availability: 'PARTIAL',
      provenance: 'COMMUNITY',
      coverage: 'UNKNOWN',
      confidence: input.gitcodeMatched ? 0.45 : 0.6,
      evidence,
    };
  }

  if (
    input.ohpmChecked &&
    input.gitcodeChecked &&
    input.deepwikiIndexed &&
    input.deepwikiScope === 'none'
  ) {
    return {
      availability: 'NO_PUBLIC_SUPPORT_FOUND',
      provenance: 'UNKNOWN',
      coverage: 'UNKNOWN',
      confidence: 0.72,
      evidence,
    };
  }

  return {
    availability: 'UNKNOWN',
    provenance: 'UNKNOWN',
    coverage: 'UNKNOWN',
    confidence: 0.25,
    evidence,
  };
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
  let ecosystemPortCapabilities: string[] = [];
  let ecosystemPortEvidenceUrls: string[] = [];
  
  const shouldGitCode = opts.checkGitCode ?? true;
  if (shouldGitCode) {
    try {
      const portResult = await findHarmonyPort(repo.full_name, repo.name);
      gitcodeMatched = portResult.matched;
      gitcodeRepoUrl = portResult.repo_url;
      gitcodeRepoName = portResult.repo_name;
      ecosystemPortCapabilities = portResult.verified_capabilities;
      ecosystemPortEvidenceUrls = portResult.evidence_urls;
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
    gitcodeTrusted: isTrustedHarmonyPortOrg(gitcodeRepoUrl),
    deepwikiPort,
  });
  const upstreamPaths = [
    hasOhPackage ? 'oh-package.json5' : null,
    hasBuildProfile ? 'build-profile.json5' : null,
    hasModuleJson ? 'module.json5' : null,
    hasHvigor ? 'hvigorfile' : null,
    hasEntry ? 'entry/' : null,
    hasEts ? '*.ets' : null,
  ].filter((value): value is string => value != null);
  const support = deriveSupportAssessment({
    ohpmMatched,
    ohpmPackages,
    upstreamProject: project || hasEts,
    upstreamPaths,
    gitcodeMatched,
    gitcodeRepoUrl,
    ecosystemPortCapabilities,
    ecosystemPortEvidenceUrls,
    registryMatched: reg.hit,
    registrySource: reg.hit ? reg.source : null,
    deepwikiScope,
    deepwikiPaths: facts?.harmony?.harmony_paths ?? [],
    ohpmChecked: shouldOhpm,
    gitcodeChecked: shouldGitCode,
    deepwikiIndexed: facts?.indexed ?? false,
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
    support_availability: support.availability,
    support_provenance: support.provenance,
    support_coverage: support.coverage,
    support_confidence: support.confidence,
    support_evidence: support.evidence,
    signals: {
      suspected: hint.suspected,
      keyword_hits: kwList,
      registry_match: reg,
      probed_ohpm: shouldOhpm,
      gitcode_searched: shouldGitCode,
      ecosystem_port_source: harmonyPortSource(gitcodeRepoUrl),
      ecosystem_port_capabilities: ecosystemPortCapabilities,
      ecosystem_port_evidence_urls: ecosystemPortEvidenceUrls,
      ecosystem_port_org_trusted: gitcodeMatched && isTrustedHarmonyPortOrg(gitcodeRepoUrl),
      deepwiki_indexed: facts?.indexed ?? false,
      deepwiki_harmony_paths: facts?.harmony?.harmony_paths ?? [],
    },
    gitcode_matched: gitcodeMatched,
    gitcode_repo_url: gitcodeRepoUrl,
    gitcode_repo_name: gitcodeRepoName,
    ecosystem_port_source: harmonyPortSource(gitcodeRepoUrl),
    ecosystem_port_capabilities: ecosystemPortCapabilities,
    ecosystem_port_evidence_urls: ecosystemPortEvidenceUrls,
    deepwiki_scope: deepwikiScope,
  };
}
