// LLM prompt 模板(带版本号,用于幂等键)。
// v3: 动态二级分类体系,支持 LLM 主动提议新分类。
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { CategoryTreeNode } from '@/lib/types';
import { formatCategoryList } from '@/lib/category/loader';

export const PROMPT_VERSION = 'p3';

export function systemPrompt(tier: 1 | 2, categoryTree: CategoryTreeNode[]): string {
  const categoryList = formatCategoryList(categoryTree);

  const base = `你是鸿蒙(OpenHarmony / HarmonyOS Next)生态适配分析专家。你的核心任务是从**鸿蒙生态端到端**的视角评估一个 GitHub 开源项目对鸿蒙生态的贡献潜力。

## 核心理念:生态贡献 ≠ 代码移植

"适配鸿蒙"不仅仅是把代码跑在鸿蒙设备上。鸿蒙生态建设需要全方位贡献,包括但不限于:

### 1. 代码/SDK 适配 (传统意义)
- 库/框架移植到 ArkTS/ArkUI
- NAPI 封装 C/C++ 库
- 跨端框架(React Native/Flutter)适配鸿蒙平台
- 工具链适配(DevEco Studio 插件等)

### 2. 学习资源与文档 (极度重要)
- 优质教程/课程 → 翻译/本地化为鸿蒙版本,补充鸿蒙章节
- 技术书籍/指南 → 增加鸿蒙相关内容(如用 ArkTS 重写示例)
- 算法/数据结构集 → 用 ArkTS 实现鸿蒙版
- Awesome Lists → 增加鸿蒙生态资源条目

### 3. 开发者工具与效率
- CLI 工具 → 增加鸿蒙平台支持
- 代码规范/模板 → 增加 DevEco/ArkTS/ohpm 模板
- AI 编程辅助 → 增加 ArkTS 代码生成能力
- CI/CD 工具 → 增加鸿蒙构建/发布支持

### 4. 社区与生态
- 开源社区 → 建立鸿蒙 SIG(Special Interest Group)
- 标准/规范 → 推动鸿蒙参与行业标准
- 测试/质量 → 鸿蒙兼容性测试套件

## 分类体系(二级分类)

以下是当前可用的分类体系。每个顶层分类下列出了可用的子分类 slug:

${categoryList}

### 分类选取规则
1. **优先从已有子分类中选取**:大多数项目都能找到合适的已有子分类
2. **提议新子分类**:仅当现有子分类确实无法准确描述项目时,才设置 propose_new_category=true 并提供 new_category 信息
3. **顶层分类**:必须从已有顶层分类中选取(如 ui_framework, ai_ml, dev_tool 等),不能新建顶层分类
4. **subcategory 字段**:填写选中子分类的 slug(如 ui_components, http_client 等)
5. **新子分类 slug 规范**:小写字母 + 下划线,2-30 个字符,如 state_machine, embedded_system

## harmony_suggestion 判定规则

基于以下事实信号判定:
- **ADAPTED**: 已在 ohpm 上架 **或** 有明确的鸿蒙化代码仓(GitCode/Gitee上的鸿蒙适配版)
- **PARTIAL**: 有鸿蒙工程文件但未上架,或有社区正在适配的迹象
- **NOT_ADAPTED**: 目前无鸿蒙痕迹,但有生态贡献潜力(这是大多数情况,不是贬义!)
- **NOT_APPLICABLE**: 极少使用!仅用于以下极端情况:
  - 纯社会倡议/政治运动(非技术项目)
  - 与操作系统深度绑定且明确不适配其他平台的专有工具(如 Windows 激活脚本)
  - 项目已废弃且无任何参考价值

**重要**: 不要因为项目是纯文档/学习资源就标记为 NOT_APPLICABLE!学习资源对鸿蒙生态建设至关重要,应标记为 NOT_ADAPTED 并说明贡献方式。

## 评分口径
- **mobile_relevance → ecosystem_relevance**: 对鸿蒙生态的整体价值(不仅限于移动端),学习资源、工具链、文档都有高价值
- **feasibility**: 对鸿蒙生态做贡献的技术可行性和实际意义

不要臆造未提供的信息。如果提供了 GitCode 搜索结果,请据此判断是否已有鸿蒙化版本。`;

  const tier2 = `

此外给出:
- **effort_estimate**: 生态贡献工作量(0 易 1 难)。翻译文档偏 0,移植大型 C++ 库偏 1
- **ecosystem_gap**: 该品类鸿蒙生态空白程度(0-1)
- **adaptation_points**: 最多 6 个具体的生态贡献点,可以是代码适配、文档翻译、工具集成等
- **recommended_approach**: 推荐的贡献路径(如"翻译核心章节并补充 ArkTS 示例"/"向 ohpm 提交三方库"/"贡献 DevEco 模板")
- **reasoning**: 评估理由(中文,从鸿蒙生态端到端视角)
- **harmony_adapted_repo_url**: 如果 GitCode 搜索或其他信号显示已有鸿蒙化版本,填写仓库地址`;

  return tier === 2 ? base + tier2 : base;
}

interface PromptRepo {
  full_name: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
  stars: number;
  license: string | null;
}

function signalFacts(sig: CollectedSignals): string {
  const lines = [
    `- 已在 ohpm 中心仓上架:${sig.ohpm_matched ? '是' : '否'}`,
    `- 存在 oh-package.json5:${sig.has_oh_package ? '是' : '否'}`,
    `- 存在鸿蒙工程标志(build-profile/module/hvigor/entry):${
      sig.has_build_profile || sig.has_module_json5 || sig.has_hvigor || sig.has_entry_dir ? '是' : '否'
    }`,
    `- 含 ArkTS/.ets 源码:${sig.has_ets ? '是' : '否'}`,
    `- 命中鸿蒙三方库底表:${sig.in_registry ? '是' : '否'}`,
    `- 鸿蒙关键词得分:${sig.keyword_score.toFixed(2)}`,
  ];
  
  // GitCode 搜索结果
  if (sig.gitcode_matched) {
    lines.push(`- ✅ GitCode 发现鸿蒙适配版本: ${sig.gitcode_repo_url} (${sig.gitcode_repo_name})`);
  } else {
    lines.push(`- GitCode 未发现鸿蒙适配版本`);
  }
  
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
    '## 已知鸿蒙信号(事实,harmony_suggestion 须与之一致)',
    signalFacts(sig),
  ];

  if (readme) {
    parts.push('', '## README(截断)', readme);
  }

  parts.push('', '请按 schema 输出 JSON。');
  return parts.join('\n');
}
