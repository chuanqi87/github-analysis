// LLM prompt 模板(带版本号,用于幂等键)。
import { REPO_CATEGORIES, CATEGORY_LABELS } from '@/lib/types';
import type { CollectedSignals } from '@/lib/harmony/signals';

export const PROMPT_VERSION = 'p1';

const CATEGORY_LIST = REPO_CATEGORIES.map((c) => `${c}(${CATEGORY_LABELS[c]})`).join('、');

export function systemPrompt(tier: 1 | 2): string {
  const base = `你是鸿蒙(OpenHarmony / HarmonyOS Next)生态适配分析专家,熟悉 ArkTS、ArkUI、ohpm 三方库中心仓、NAPI(C/C++ 封装)、以及 React Native / Flutter 等跨端框架向鸿蒙的迁移路径。

你的任务:对给定的 GitHub 开源项目,判断其分类,并评估把它适配到鸿蒙生态的价值与可行性。

分类只能从以下枚举中选择:${CATEGORY_LIST}。

重要:输出中的 harmony_suggestion 必须与"已知鸿蒙信号"事实一致 —— 若信号显示已在 ohpm 上架,则应为 ADAPTED;若有鸿蒙工程文件但未上架,倾向 PARTIAL;若毫无鸿蒙痕迹,则为 NOT_ADAPTED;对内核 / 纯服务端 / 桌面 GUI 等对鸿蒙无意义者用 NOT_APPLICABLE。不要臆造未提供的信息。

评分口径:mobile_relevance=对移动/跨端场景价值;feasibility=技术上适配到鸿蒙是否可行且有意义(纯 JS/TS 库高,重度依赖特定 OS/内核者低)。`;

  const tier2 = `

此外给出:effort_estimate(工作量,0 易 1 难,纯 TS 库偏 0,大量 C/C++ 原生或深 OS 依赖偏 1)、ecosystem_gap(该品类鸿蒙生态空白程度)、adaptation_points(最多 6 个具体适配点)、recommended_approach(推荐迁移路径)、reasoning(中文理由)。`;

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
  return [
    `- 已在 ohpm 中心仓上架:${sig.ohpm_matched ? '是' : '否'}`,
    `- 存在 oh-package.json5:${sig.has_oh_package ? '是' : '否'}`,
    `- 存在鸿蒙工程标志(build-profile/module/hvigor/entry):${
      sig.has_build_profile || sig.has_module_json5 || sig.has_hvigor || sig.has_entry_dir ? '是' : '否'
    }`,
    `- 含 ArkTS/.ets 源码:${sig.has_ets ? '是' : '否'}`,
    `- 命中鸿蒙三方库底表:${sig.in_registry ? '是' : '否'}`,
    `- 鸿蒙关键词得分:${sig.keyword_score.toFixed(2)}`,
  ].join('\n');
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
