// LLM prompt 模板(带版本号,用于幂等键)。
// p5: 状态判定改为按信号可信度分级的优先级表;评分维度加锚点标尺拉开区分度;
//     强制证据引用与项目特定性,禁止万金油建议;README 实际清洗截断;
//     tier-2 可注入品类适配统计以锚定 ecosystem_gap。
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { CategoryTreeNode } from '@/lib/types';
import { isTrustedGitcodeOrg } from '@/lib/harmony/gitcode';
import { formatCategoryList } from '@/lib/category/loader';

export const PROMPT_VERSION = 'p5';

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
3. 本仓库自带鸿蒙工程文件或 .ets 源码:README/描述明确宣称支持 HarmonyOS/OpenHarmony → **ADAPTED**;仅有文件无宣称 → **PARTIAL**
4. GitCode 搜索命中但**非官方组织(标注 [弱])** → **PARTIAL**(可能是镜像/个人试验仓,须在置信度上打折)
5. 命中鸿蒙三方库底表 → **PARTIAL**
6. 无以上信号:
   - 项目对鸿蒙生态有可落地的适配/贡献价值 → **PENDING_ADAPTATION**(大多数项目)
   - 纯社会倡议/非技术内容、与特定 OS 深度绑定且在鸿蒙上无意义(如 Windows 激活工具)、已废弃且无参考价值 → **NOT_APPLICABLE**

硬性纪律:
- **NOT_ADAPTED 不要输出**(它只是信号采集层的默认值)
- **harmony_adapted_repo_url 只能填信号中给出的 URL,严禁自行构造或凭记忆猜测**;无信号则填 null
- 判定与信号冲突时以信号为准;若 README 有反证(如"鸿蒙版已废弃"),在置信度中体现并说明`;

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

- **adaptation_points**(最多 6 条):每条必须挂到该项目的具体模块/依赖/功能上,evidence 字段引用给定材料中的依据(README 原文短句、信号条目、依赖名)。**禁止**输出可套用于任何项目的通用条目("翻译 README"、"提供 ArkTS 示例"),除非项目本身就是文档/教程类
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

export function buildUserPrompt(
  repo: PromptRepo,
  sig: CollectedSignals,
  readme?: string | null,
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

  if (readme) {
    parts.push('', '## README(已清洗截断)', readme);
  } else {
    parts.push('', '## README', '(无 README 可用,confidence 相应降低)');
  }

  parts.push('', '请按 schema 输出 JSON。');
  return parts.join('\n');
}
