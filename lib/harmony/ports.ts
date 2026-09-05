// 鸿蒙生态移植仓发现：统一承载 GitCode、Gitee 等平台的高置信度映射。
// 数据库暂时保留 gitcode_* 兼容字段，但判断和提示词不得再把它们解释成单一平台。
import { searchGitCode, type GitCodeResult } from '@/lib/harmony/gitcode';

export type HarmonyPortSource = 'gitee' | 'gitcode' | 'unknown';

export interface HarmonyPortResult extends GitCodeResult {
  source: HarmonyPortSource;
  trusted: boolean;
  verified_capabilities: string[];
  evidence_urls: string[];
}

const TRUSTED_PORT_ORG_RE =
  /(?:gitcode\.com|gitee\.com)\/(?:openharmony-sig|openharmony-tpc|openharmony)\//i;

export function harmonyPortSource(url: string | null | undefined): HarmonyPortSource {
  if (!url) return 'unknown';
  if (/^https?:\/\/(?:www\.)?gitee\.com\//i.test(url)) return 'gitee';
  if (/^https?:\/\/(?:www\.)?gitcode\.com\//i.test(url)) return 'gitcode';
  return 'unknown';
}

export function isTrustedHarmonyPortOrg(url: string | null | undefined): boolean {
  return Boolean(url && TRUSTED_PORT_ORG_RE.test(url));
}

/**
 * 人工核验过的“GitHub 上游 → 鸿蒙生态移植仓”关系。
 * key 一律小写，兼容仓库更名；这里表达的是来源关系，不代表覆盖完整度。
 */
interface KnownHarmonyPort {
  url: string;
  name: string;
  verified_capabilities?: string[];
  evidence_urls?: string[];
}

const REACT_NATIVE_OPENHARMONY: KnownHarmonyPort = {
  url: 'https://gitee.com/openharmony-sig/ohos_react_native',
  name: 'OpenHarmony-SIG/ohos_react_native',
  verified_capabilities: [
    '基于 React Native 新架构实现 Fabric',
    '支持 ArkTS TurboModule 与 C++ TurboModule',
    '支持 ArkTS/C-API 自定义 Fabric 组件',
    '提供 codegen-harmony，可为 TurboModule/Fabric Component 生成 C++ 与 ArkTS 胶水代码',
    '提供 Hermes 运行库与构建产物',
    '通过 ohpm 发布 @rnoh/react-native-openharmony',
    '提供 Metro、hdc 端口转发和 DevEco Studio 调试流程',
    '已有独立的 React Native OpenHarmony 三方库适配目录，但具体库覆盖仍需逐项核验',
  ],
  evidence_urls: [
    'https://gitee.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/%E6%9E%B6%E6%9E%84%E4%BB%8B%E7%BB%8D.md',
    'https://gitee.com/openharmony-sig/ohos_react_native/blob/master/docs/Samples/FabricComponentSample/README.md',
    'https://gitee.com/openharmony-sig/ohos_react_native/blob/master/docs/Samples/using_turboModule/README.md',
    'https://gitee.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Codegen.md',
    'https://gitee.com/openharmony-sig/ohos_react_native/blob/master/docs/Samples/RootTagSample/README.md',
    'https://gitee.com/react-native-oh-library/usage-docs',
  ],
};

export const KNOWN_HARMONY_PORTS: Record<string, KnownHarmonyPort> = {
  'flutter/flutter': {
    url: 'https://gitcode.com/openharmony-sig/flutter_flutter',
    name: 'openharmony-sig/flutter_flutter',
  },
  'react/react-native': REACT_NATIVE_OPENHARMONY,
  // React Native 旧 owner，避免历史数据和旧链接漏掉同一个上游。
  'facebook/react-native': REACT_NATIVE_OPENHARMONY,
  'vuejs/vue': { url: 'https://gitcode.com/openharmony-sig/vue', name: 'openharmony-sig/vue' },
  'tensorflow/tensorflow': { url: 'https://gitcode.com/openharmony-sig/tensorflow', name: 'openharmony-sig/tensorflow' },
  'pytorch/pytorch': { url: 'https://gitcode.com/openharmony-sig/pytorch', name: 'openharmony-sig/pytorch' },
  'opencv/opencv': { url: 'https://gitcode.com/openharmony-sig/opencv', name: 'openharmony-sig/opencv' },
  'grpc/grpc': { url: 'https://gitcode.com/openharmony-sig/grpc', name: 'openharmony-sig/grpc' },
  'protocolbuffers/protobuf': { url: 'https://gitcode.com/openharmony-sig/protobuf', name: 'openharmony-sig/protobuf' },
  'nlohmann/json': { url: 'https://gitcode.com/openharmony-sig/json', name: 'openharmony-sig/json' },
  'fmtlib/fmt': { url: 'https://gitcode.com/openharmony-sig/fmt', name: 'openharmony-sig/fmt' },
  'catchorg/catch2': { url: 'https://gitcode.com/openharmony-sig/Catch2', name: 'openharmony-sig/Catch2' },
  'boostorg/boost': { url: 'https://gitcode.com/openharmony-sig/boost', name: 'openharmony-sig/boost' },
  'openssl/openssl': { url: 'https://gitcode.com/openharmony-sig/openssl', name: 'openharmony-sig/openssl' },
  'curl/curl': { url: 'https://gitcode.com/openharmony-sig/curl', name: 'openharmony-sig/curl' },
  'sqlite/sqlite': { url: 'https://gitcode.com/openharmony-sig/sqlite', name: 'openharmony-sig/sqlite' },
};

export async function findHarmonyPort(fullName: string, repoName: string): Promise<HarmonyPortResult> {
  const known = KNOWN_HARMONY_PORTS[fullName.toLowerCase()];
  const result = known
    ? {
        matched: true,
        repo_url: known.url,
        repo_name: known.name,
        description: '人工核验的鸿蒙生态移植仓',
      }
    : await searchGitCode(repoName);
  return {
    ...result,
    source: harmonyPortSource(result.repo_url),
    trusted: isTrustedHarmonyPortOrg(result.repo_url),
    verified_capabilities: known?.verified_capabilities ?? [],
    evidence_urls: known?.evidence_urls ?? [],
  };
}
