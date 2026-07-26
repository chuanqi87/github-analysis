// LLM prompt 模板(带版本号,用于幂等键)。
// p5: 状态判定改为按信号可信度分级的优先级表;评分维度加锚点标尺拉开区分度;
//     强制证据引用与项目特定性,禁止万金油建议;README 实际清洗截断;
//     tier-2 可注入品类适配统计以锚定 ecosystem_gap。
// p6: 注入 DeepWiki 代码事实(模块地图 / 鸿蒙证据分级 / 平台抽象层 / 阻塞依赖),
//     判定规则相应加入"构建矩阵命中不等于已适配"的反误判条款。
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { CategoryTreeNode } from '@/lib/types';
import type { DeepwikiFacts } from '@/lib/deepwiki';
import { isTrustedGitcodeOrg } from '@/lib/harmony/gitcode';
import { formatCategoryList } from '@/lib/category/loader';

export const PROMPT_VERSION = 'p6';

/** tier-1 只看 README 头部;tier-2 看更长片段。 */
export const README_CHARS_TIER1 = 2000;
export const README_CHARS_TIER2 = 6000;

/**
 * 清洗并截断 README:去徽章/图片/HTML注释等对判断无用的噪音,再按上限截断。
 * 返回 null 表示无有效内容。
 */
export function prepareReadme(readme: string | null | undefined, maxChars: number): string | null {
  if (!readme) return null;
  const cleaned = readme
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}\n…(已截断)` : cleaned;
}

const STATE_RULES = `## A. 适配状态判定(harmony_suggestion)——事实题

只依据下方「已知鸿蒙信号」和 README 中的明确证据判定,按优先级从上到下,命中即停:

1. 信号显示 ohpm 中心仓已上架 → **ADAPTED**
2. 信号显示 GitCode **官方组织(标注 [强])** 存在适配仓 → **ADAPTED**
3. 本仓库自带鸿蒙工程文件或 .ets 源码,或 DeepWiki 证据分级为 \`dedicated_port\`:
   README/描述明确宣称支持 HarmonyOS/OpenHarmony → **ADAPTED**;仅有文件无宣称 → **PARTIAL**
4. GitCode 搜索命中但**非官方组织(标注 [弱])** → **PARTIAL**(可能是镜像/个人试验仓,须在置信度上打折)
5. 命中鸿蒙三方库底表 → **PARTIAL**
6. 无以上信号:
   - 项目对鸿蒙生态有可落地的适配/贡献价值 → **PENDING_ADAPTATION**(大多数项目)
   - 纯社会倡议/非技术内容、与特定 OS 深度绑定且在鸿蒙上无意义(如 Windows 激活工具)、已废弃且无参考价值 → **NOT_APPLICABLE**

硬性纪律:
- **NOT_ADAPTED 不要输出**(它只是信号采集层的默认值)
- **harmony_adapted_repo_url 只能填信号中给出的 URL,严禁自行构造或凭记忆猜测**;无信号则填 null
- 判定与信号冲突时以信号为准;若 README 有反证(如"鸿蒙版已废弃"),在置信度中体现并说明
- **反误判**:DeepWiki 证据分级为 \`build_target_only\`(鸿蒙只是构建/平台矩阵里的一项)或
  \`incidental_mention\`(只在文档、注释、changelog、单条平台字符串比较里出现)时,
  **不构成适配证据**,不得据此判 ADAPTED 或 PARTIAL。典型反例:某大型前端框架的
  napi 产物列表里带一个 openharmony 目标,这只说明它的构建工具支持该 ABI,
  不代表项目本身做过鸿蒙适配`;

const SCORE_RUBRIC_BASE = `## B. 价值评估——分析题,用锚点标尺打分

打分必须落到该项目的具体技术栈/依赖/功能上,**用满区间、拉开区分度**,不要挤在 0.6~0.8。

### mobile_relevance(对鸿蒙生态的价值)
- 0.9~1.0:端侧应用会直接依赖的核心库——UI 组件/框架、跨端框架、移动端网络/图片/存储/动画库、知名移动 App 本身
- 0.6~0.8:端侧可复用的通用能力——通用算法/工具库、媒体编解码、端侧 AI 推理、图形渲染
- 0.35~0.55:间接价值——开发工具链/构建/CI(可加鸿蒙支持)、带官方客户端 SDK 的服务(只评其 SDK 部分)、移动/客户端主题的教程课程
- 0.15~0.3:弱关联——纯服务端框架/基础设施、桌面专属应用、通用 CS 学习资源(仅能做本地化)
- 0~0.1:无关——纯运维/云平台内部组件、特定 OS 专属 hack、非技术内容

**反膨胀规则**:如果该项目唯一的"贡献路径"是翻译文档/补鸿蒙章节/加 ArkTS 示例这类放在任何项目上都成立的通用动作,mobile_relevance 不得超过 0.3。

### feasibility(适配可行性)
- 0.85~1.0:纯 TS/JS/纯逻辑代码无平台绑定;或上游已有清晰的多平台抽象层
- 0.6~0.8:平台耦合有限且集中(网络/存储/权限调用点可替换);中小型 C/C++ 库可 NAPI 封装
- 0.35~0.55:大量原生代码、深度依赖 Android/iOS 系统服务、或 UI 层需整体重写为 ArkUI
- 0.1~0.3:绑定特定 OS 内核/桌面窗口系统/专有硬件;或 license(如 GPL 用于闭源集成场景)构成实质障碍
- 学习资源类:feasibility 反映"产出鸿蒙版内容"的可行性(通常较高),但受上面 relevance 反膨胀规则约束

### confidence(结论置信度)
- ≥0.8:信号明确且 README 信息充分
- 0.5~0.7:信息可用但有关键盲点(如看不到依赖清单/原生代码占比)
- <0.5:缺 README、描述为空、或信号相互矛盾——必须如实给低置信度`;

const SCORE_RUBRIC_TIER2 = `
### effort_estimate(工作量,0 易 1 难)
- ≤0.2:可直接向 ohpm 发包或只需少量 shim
- 0.3~0.4:替换分散的平台 API 调用(网络/存储/权限等)
- 0.5~0.6:中型原生库 NAPI 封装,或 UI 组件层移植到 ArkUI
- 0.7~0.8:框架级适配(渲染后端、平台通道、插件体系)
- ≥0.9:引擎/运行时级移植(浏览器内核、游戏引擎、语言 VM)

### ecosystem_gap(品类生态空白度)
- 若提供了「品类适配现状」数据,以它为准:gap ≈ 1 − 该品类已适配比例,再按品类对端侧的重要性微调
- 无数据时按你对鸿蒙三方生态的了解估计,并在 reasoning 中写明依据`;

const TIER2_OUTPUT_RULES = `
## tier-2 输出纪律(反泛泛而谈)

- **adaptation_points**(最多 6 条):每条必须挂到该项目的具体模块/依赖/功能上,evidence 字段引用给定材料中的依据。
  **有 DeepWiki 代码事实时优先引用其中的真实文件路径**(如"在 src/os_unix.c 同级新增 os_ohos.c"),
  这比引 README 原文更有说服力;但**只能引材料里出现过的路径,不得自行拼造**
- **recommended_approach**:指明具体技术路径与入手点(如"用 NAPI 封装 core/ 下的 C 解码模块,JS API 层可直接复用"),不写"建议评估后适配"这类空话
- **reasoning** 按固定结构组织:①技术栈与平台耦合点 ②适配现状证据(引用信号/README)③推荐路径依据 ④关键风险(license/原生依赖/维护状态)
- **harmony_adapted_repo_url**:同状态判定纪律,只能取自给定信号`;

function categoryRules(categoryList: string): string {
  return `## 分类体系(二级分类)

以下是当前可用的分类体系。每个顶层分类下列出了可用的子分类 slug:

${categoryList}

### 分类选取规则
1. **优先从已有子分类中选取**:大多数项目都能找到合适的已有子分类
2. **提议新子分类**:仅当现有子分类确实无法准确描述项目时,才设置 propose_new_category=true 并提供 new_category 信息
3. **顶层分类**:必须从已有顶层分类中选取,不能新建顶层分类
4. **subcategory 字段**:填写选中子分类的 slug(如 ui_components, http_client 等)
5. **新子分类 slug 规范**:小写字母 + 下划线,2-30 个字符,如 state_machine, embedded_system`;
}

export interface SystemPromptOpts {
  /** tier-2 注入的品类适配统计文本(来自 v_category_stats),用于锚定 ecosystem_gap */
  categoryStats?: string | null;
}

export function systemPrompt(
  tier: 1 | 2,
  categoryTree: CategoryTreeNode[],
  opts: SystemPromptOpts = {},
): string {
  const parts = [
    `你是鸿蒙(HarmonyOS NEXT / OpenHarmony)生态适配分析专家。你要对一个 GitHub 开源项目完成两类判断:
A. **适配状态判定**——事实题,只依据给定信号与 README 证据,不做推测
B. **适配价值评估**——分析题,必须落到该项目的具体技术特征,拒绝对任何项目都成立的泛泛结论

所有事实引用必须能在给定材料中找到出处;材料没有的信息就明说不知道,不要臆造。`,
    STATE_RULES,
    SCORE_RUBRIC_BASE,
  ];

  if (tier === 2) {
    parts.push(SCORE_RUBRIC_TIER2);
    if (opts.categoryStats) {
      parts.push(`## 品类适配现状(来自本平台数据库,ecosystem_gap 以此为准)

各品类「已适配 / 总数」:
${opts.categoryStats}`);
    }
    parts.push(TIER2_OUTPUT_RULES);
  }

  parts.push(categoryRules(formatCategoryList(categoryTree)));
  return parts.join('\n\n');
}

interface PromptRepo {
  full_name: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
  stars: number;
  license: string | null;
}

/** 信号事实清单:标注可信度分级([强]/[中]/[弱]),并给出可核对的细节。 */
function signalFacts(sig: CollectedSignals): string {
  const lines: string[] = [];

  if (sig.ohpm_matched) {
    const pkgs = (sig.ohpm_packages ?? []).map((p) => p.pkg).join(', ');
    const src = sig.source_repo_url ? `,源仓 ${sig.source_repo_url}` : '';
    lines.push(`- [强] ohpm 中心仓已上架:${pkgs || '包名未记录'}${src}`);
  } else {
    lines.push('- ohpm 中心仓:按 @ohos/<仓名> 猜测包名未命中(不排除以其他包名上架)');
  }

  const project =
    sig.has_oh_package || sig.has_build_profile || sig.has_module_json5 || sig.has_hvigor || sig.has_entry_dir;
  lines.push(`- [强] 本仓库含鸿蒙工程文件(oh-package/build-profile/hvigor/entry):${project ? '是' : '否'}`);
  lines.push(`- [强] 本仓库含 ArkTS(.ets) 源码:${sig.has_ets ? '是' : '否'}`);
  lines.push(
    `- [中] 命中鸿蒙三方库底表:${sig.in_registry ? `是(来源:${sig.registry_source ?? '未知'})` : '否'}`,
  );

  if (sig.gitcode_matched && sig.gitcode_repo_url) {
    lines.push(
      isTrustedGitcodeOrg(sig.gitcode_repo_url)
        ? `- [强] GitCode 官方组织适配仓:${sig.gitcode_repo_url}(${sig.gitcode_repo_name})`
        : `- [弱] GitCode 搜索命中疑似适配仓:${sig.gitcode_repo_url}(${sig.gitcode_repo_name})。非官方组织,可能是镜像/无关仓/个人试验,需结合其名称与本项目的相关性甄别`,
    );
  } else {
    lines.push('- GitCode 搜索:未发现疑似适配仓');
  }

  lines.push(`- [弱] 鸿蒙关键词得分(0-1):${sig.keyword_score.toFixed(2)}`);
  return lines.join('\n');
}

/** 鸿蒙证据分级 → 给 LLM 的可判读说明(不直接给结论,给证据强度)。 */
const SCOPE_LABEL: Record<string, string> = {
  dedicated_port: '[强] 存在专门的鸿蒙实现(独立目录/ArkTS 源码/oh-package 工程)',
  build_target_only: '[不构成适配] 鸿蒙仅作为构建或平台矩阵中的一项出现,无专门实现',
  incidental_mention: '[不构成适配] 仅在文档/注释/changelog/单条平台字符串比较中被提及',
  none: '未发现任何鸿蒙相关代码或配置',
};

/** DeepWiki 目录在 tier-1 的注入上限:控制 token,目录本身也就 1~3KB。 */
const TOC_CHARS_TIER1 = 1200;

/**
 * DeepWiki 代码事实清单。
 *
 * 只呈现事实(路径、引文、依赖名、已有平台后端),不呈现 DeepWiki 自己的难度判断 ——
 * 实测它的判断不可靠(sqlite 的 VFS 被判"无平台抽象层"),但它给的路径都是真的。
 */
function deepwikiFacts(facts: DeepwikiFacts, tier: 1 | 2): string {
  if (!facts.indexed) {
    return '(DeepWiki 未索引该仓库,无代码事实可用 —— confidence 相应降低,不要凭空推断代码结构)';
  }

  const lines: string[] = [];

  if (facts.wiki_toc) {
    const toc = tier === 1 ? facts.wiki_toc.slice(0, TOC_CHARS_TIER1) : facts.wiki_toc;
    lines.push('### 模块地图', toc.trim(), '');
  }

  const h = facts.harmony;
  if (h) {
    lines.push('### 鸿蒙痕迹(代码级检索结果)');
    lines.push(`- 证据分级:${h.harmony_scope ? SCOPE_LABEL[h.harmony_scope] ?? h.harmony_scope : '未知'}`);
    if (h.harmony_paths.length) {
      lines.push(`- 命中路径:${h.harmony_paths.slice(0, 10).join('、')}`);
    }
    if (h.harmony_quote) lines.push(`- 代码/文档原文:「${h.harmony_quote.slice(0, 200)}」`);
    if (h.ohos_imports.length) lines.push(`- @ohos.* 引用:${h.ohos_imports.slice(0, 8).join('、')}`);
    if (h.declares_harmony_support != null) {
      lines.push(`- README/官方文档是否明确宣称支持鸿蒙:${h.declares_harmony_support ? '是' : '否'}`);
    }
    lines.push('');
  }

  const p = facts.porting;
  if (p) {
    lines.push('### 移植面(代码事实)');
    if (p.project_type) lines.push(`- 项目形态:${p.project_type}`);
    if (p.languages.length) lines.push(`- 语言构成:${p.languages.slice(0, 8).join('、')}`);
    if (p.native_code_ratio != null) {
      lines.push(`- 原生代码占比:约 ${Math.round(p.native_code_ratio * 100)}%`);
    }
    if (p.has_platform_abstraction != null) {
      lines.push(
        `- 是否已有平台抽象层:${p.has_platform_abstraction ? '是' : '否'}` +
          (p.platform_layer_paths.length ? `(${p.platform_layer_paths.slice(0, 6).join('、')})` : ''),
      );
    }
    if (p.existing_platform_backends.length) {
      lines.push(
        `- 已有平台后端:${p.existing_platform_backends.join('、')}` +
          '(已有多个后端说明加一个鸿蒙后端有现成插槽,feasibility 应相应提高)',
      );
    }
    if (p.portable_core_paths.length) {
      lines.push(`- 无平台耦合的核心:${p.portable_core_paths.slice(0, 6).join('、')}`);
    }
    if (p.blocking_deps.length) {
      lines.push(
        `- 阻塞依赖:${p.blocking_deps
          .slice(0, 8)
          .map((d) => (d.why ? `${d.name}(${d.why})` : d.name))
          .join('、')}`,
      );
    }
    if (p.platform_apis_used.length) {
      lines.push(`- 直接调用的系统 API:${p.platform_apis_used.slice(0, 8).join('、')}`);
    }
    if (p.conditional_compilation.length) {
      lines.push(`- 平台条件编译宏:${p.conditional_compilation.slice(0, 8).join('、')}`);
    }
  }

  const body = lines.join('\n').trim();
  return body || '(DeepWiki 已索引但未取到有效事实)';
}

export function buildUserPrompt(
  repo: PromptRepo,
  sig: CollectedSignals,
  readme?: string | null,
  /** DeepWiki 代码事实;缺省表示本次未取数(与"未索引"不同,不额外惩罚 confidence) */
  facts?: DeepwikiFacts | null,
  tier: 1 | 2 = 2,
): string {
  const meta = [
    `仓库:${repo.full_name}`,
    `Star:${repo.stars}`,
    `主语言:${repo.primary_language ?? '未知'}`,
    `Topics:${repo.topics.slice(0, 15).join(', ') || '无'}`,
    `License:${repo.license ?? '未知'}`,
    `描述:${repo.description ?? '无'}`,
  ].join('\n');

  const parts = [
    '## 项目元数据',
    meta,
    '',
    '## 已知鸿蒙信号(事实,harmony_suggestion 须按判定规则与之一致)',
    signalFacts(sig),
  ];

  if (facts) {
    parts.push(
      '',
      '## DeepWiki 代码事实(由代码索引得出,优先于 README 的自述)',
      deepwikiFacts(facts, tier),
    );
  }

  if (readme) {
    parts.push('', '## README(已清洗截断)', readme);
  } else {
    parts.push('', '## README', '(无 README 可用,confidence 相应降低)');
  }

  parts.push('', '请按 schema 输出 JSON。');
  return parts.join('\n');
}
