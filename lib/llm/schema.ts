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
    '适配状态:严格按系统提示的优先级判定表,只依据给定事实信号,不得输出 NOT_ADAPTED',
  ),
  mobile_relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('对鸿蒙生态的价值 0-1,按系统提示锚点标尺打分,用满区间拉开区分度'),
  feasibility: z
    .number()
    .min(0)
    .max(1)
    .describe('适配可行性 0-1,按锚点标尺打分,考虑平台耦合与 license'),
  harmony_adapted_repo_url: z
    .string()
    .nullable()
    .default(null)
    .describe('鸿蒙化适配仓库地址:只能取自给定信号中的 URL,严禁自行构造,无则填 null'),
  confidence: z.number().min(0).max(1).describe('结论置信度 0-1,信息不足时必须给低值'),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

// ---- tier-2 深度评估 schema ------------------------------------------------
export const evaluateSchema = z.object({
  category: z.string().describe('项目所属顶层分类 slug'),
  subcategory: z.string().describe('子分类 slug'),
  propose_new_category: z.boolean().default(false),
  new_category: newCategoryProposalSchema.nullable().default(null),
  harmony_suggestion: harmonyEnum.describe(
    '适配状态:严格按系统提示的优先级判定表,只依据给定事实信号,不得输出 NOT_ADAPTED',
  ),
  mobile_relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('对鸿蒙生态的价值 0-1,按锚点标尺打分,用满区间拉开区分度'),
  feasibility: z.number().min(0).max(1).describe('适配可行性 0-1,按锚点标尺打分'),
  effort_estimate: z.number().min(0).max(1).describe('适配工作量 0 易 1 难,按锚点标尺打分'),
  ecosystem_gap: z
    .number()
    .min(0)
    .max(1)
    .describe('该品类鸿蒙生态空白程度 0-1;若提供了品类适配现状数据则以其为准'),
  adaptation_points: z
    .array(
      z.object({
        area: z.string().describe('适配/贡献点领域,如 UI/网络/存储/原生能力/文档/工具链'),
        description: z.string().describe('具体要做什么,必须挂到该项目的具体模块/依赖/功能'),
        difficulty: z.enum(['low', 'medium', 'high']),
        harmony_value: z.string().describe('该能力补足鸿蒙生态的什么缺口，服务哪些端侧/跨设备场景'),
        project_assets: z.string().describe('可直接复用的项目模块、接口、算法或平台抽象层；必须来自证据材料'),
        target_devices: z.array(z.string()).max(5).describe('适用鸿蒙设备形态，如手机/平板/2in1/穿戴/智慧屏；不适用则空数组'),
        target_kits: z.array(z.string()).max(6).describe('可能对接的 HarmonyOS Kit/API/NAPI/ArkUI；无材料支撑时写“需验证”而非猜测具体 API'),
        integration_form: z.enum([
          'ohpm_package',
          'arkui_component',
          'napi_module',
          'platform_backend',
          'sdk_plugin',
          'app_feature',
          'docs_tooling',
        ]).describe('在鸿蒙生态中的最终交付形态'),
        evidence: z
          .string()
          .describe('依据:引用 README 原文短句、信号条目或依赖名,不得编造'),
      }),
    )
    .max(6)
    .default([]),
  recommended_approach: z
    .string()
    .describe('推荐路径:指明具体技术方案与入手点(如 NAPI 封装某模块 / ArkUI 重写 UI 层),不写空话'),
  reasoning: z
    .string()
    .describe('评估理由(中文):①技术栈与平台耦合点 ②适配现状证据 ③推荐路径依据 ④关键风险'),
  harmony_adapted_repo_url: z
    .string()
    .nullable()
    .default(null)
    .describe('鸿蒙化适配仓库地址:只能取自给定信号中的 URL,严禁自行构造,无则填 null'),
  confidence: z.number().min(0).max(1).describe('结论置信度 0-1,信息不足时必须给低值'),
});
export type EvaluateResult = z.infer<typeof evaluateSchema>;
