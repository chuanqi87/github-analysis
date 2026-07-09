// LLM 结构化输出 schema(zod)。generateObject 依此校验并触发重试。
// v3: 支持动态二级分类体系,LLM 可从已有分类选取或提议新分类。
import { z } from 'zod';
import { HARMONY_STATES } from '@/lib/types';

const harmonyEnum = z.enum(HARMONY_STATES);

/**
 * 新分类提议:当现有分类无法准确描述项目时,LLM 可主动定义新分类。
 * 仅当 propose_new_category=true 时使用。
 */
export const newCategoryProposalSchema = z.object({
  parent_slug: z.string().describe('新分类所属的顶层分类 slug(必须是已有顶层分类之一)'),
  subcategory_slug: z
    .string()
    .describe('新子类英文 slug,小写+下划线,如 `state_machine`, `embedded_system`'),
  subcategory_name_cn: z.string().describe('新子类中文名,如 `状态机`, `嵌入式系统`'),
});

// ---- tier-1 粗分类 schema --------------------------------------------------
export const classifySchema = z.object({
  // 分类:输出已有分类的 slug
  category: z.string().describe('项目所属顶层分类 slug(从给定列表选取,如 ui_framework, ai_ml)'),
  subcategory: z
    .string()
    .describe('子分类 slug(从给定列表选取)。若 propose_new_category=true 则填新子类的 slug'),
  // 新分类提议:仅当现有子类确实无法覆盖时设为 true
  propose_new_category: z
    .boolean()
    .default(false)
    .describe('是否需要创建新子分类。仅当现有子类都不合适时设为 true'),
  new_category: newCategoryProposalSchema
    .nullable()
    .default(null)
    .describe('当 propose_new_category=true 时,填写新分类详情'),
  // 鸿蒙化评估
  harmony_suggestion: harmonyEnum.describe(
    '鸿蒙化状态建议:对鸿蒙生态的贡献潜力评估,须与给定事实信号一致',
  ),
  mobile_relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('对鸿蒙生态的价值 0-1 (不仅限于移动端,包括学习资源、工具链等生态贡献)'),
  feasibility: z.number().min(0).max(1).describe('对鸿蒙生态贡献的可行性/意义 0-1'),
  harmony_adapted_repo_url: z
    .string()
    .nullable()
    .default(null)
    .describe('已知的鸿蒙化适配仓库地址(GitCode/Gitee等),若无则填null'),
  confidence: z.number().min(0).max(1),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

// ---- tier-2 深度评估 schema ------------------------------------------------
export const evaluateSchema = z.object({
  category: z.string().describe('项目所属顶层分类 slug'),
  subcategory: z.string().describe('子分类 slug'),
  propose_new_category: z.boolean().default(false),
  new_category: newCategoryProposalSchema.nullable().default(null),
  harmony_suggestion: harmonyEnum,
  mobile_relevance: z.number().min(0).max(1).describe('对鸿蒙生态的价值 0-1'),
  feasibility: z.number().min(0).max(1).describe('对鸿蒙生态贡献的可行性/意义 0-1'),
  effort_estimate: z.number().min(0).max(1).describe('生态贡献工作量 0 易 1 难'),
  ecosystem_gap: z.number().min(0).max(1).describe('该品类鸿蒙生态空白程度 0-1'),
  adaptation_points: z
    .array(
      z.object({
        area: z.string().describe('适配/贡献点领域,如 UI/网络/存储/原生能力/文档/学习资源/工具链'),
        description: z.string(),
        difficulty: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(6)
    .default([]),
  recommended_approach: z
    .string()
    .describe('推荐路径,如 ArkTS 重写 / NAPI 封装 C++ / 翻译本地化 / 贡献鸿蒙模板 / 不建议'),
  reasoning: z.string().describe('评估理由(中文,从鸿蒙生态端到端视角分析)'),
  harmony_adapted_repo_url: z
    .string()
    .nullable()
    .default(null)
    .describe('已知的鸿蒙化适配仓库地址,若无则填null'),
  confidence: z.number().min(0).max(1),
});
export type EvaluateResult = z.infer<typeof evaluateSchema>;
