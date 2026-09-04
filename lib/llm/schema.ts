// LLM 结构化输出 schema(zod)。generateObject 依此校验并触发重试。
// v3: 支持动态二级分类体系,LLM 可从已有分类选取或提议新分类。
import { z } from 'zod';
import { OPPORTUNITY_VERDICTS } from '@/lib/types';

const opportunityVerdictEnum = z.enum(OPPORTUNITY_VERDICTS);

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

const analysisDetailsSchema = z.object({
  architecture: z.object({
    core_modules: z.array(z.string()).describe('核心模块及职责，尽量带真实路径'),
    runtime_and_platform_boundary: z.string().describe('运行时、UI、系统 API、原生代码之间的边界与耦合方式'),
    extension_points: z.array(z.string()).describe('可用于新增平台实现的接口、后端、插件或条件编译入口'),
    evidence_refs: z.array(z.string()).describe('支撑架构判断的当前仓库真实路径或材料引用'),
  }),
  porting: z.object({
    reusable_core: z.array(z.string()).describe('可原样或低成本复用的核心资产'),
    required_changes: z.array(z.string()).describe('按模块拆解的必要改动，不写泛泛的“进行适配”'),
    blocking_dependencies: z.array(z.string()).describe('系统 API、原生依赖、许可证、构建或测试阻塞'),
    build_and_test_strategy: z.string().describe('可执行的构建、设备验证、回归与上游维护方案'),
  }),
  ecosystem: z.object({
    target_users_and_scenarios: z.array(z.string()).describe('具体用户、设备与业务场景'),
    existing_alternatives: z.array(z.string()).describe('材料可确认的现有鸿蒙或通用替代方案；未知则明确写未知'),
    differentiated_value: z.string().describe('相对直接复用或替代方案的增量价值'),
    adoption_and_maintenance_path: z.string().describe('发布、集成、上游接受与长期维护路径'),
  }),
  decision: z.object({
    recommendation: z.enum(['INVEST', 'VALIDATE_FIRST', 'DEFER', 'REJECT']),
    why_now: z.string().describe('支持当前决策的关键因果链，而非分数复述'),
    prerequisites: z.array(z.string()).describe('投入前必须满足或验证的前置条件'),
    kill_criteria: z.array(z.string()).describe('出现哪些事实就应停止投入'),
  }),
  historical_reuse: z.array(z.object({
    source_repo: z.string().describe('历史分析来源仓库'),
    reused_insight: z.string().describe('复用的架构模式、工程经验或生态结论'),
    applicability: z.string().describe('为何适用于当前仓库，以及不能复用的边界'),
    current_repo_evidence: z.array(z.string()).describe('在当前仓库中重新核验该结论的证据'),
  })),
  rejected_options: z.array(z.object({
    idea: z.string().describe('曾考虑但最终否决的结合方案'),
    rejection_reason: z.string().describe('否决原因及关键权衡'),
    evidence_refs: z.array(z.string()).describe('当前仓库或支持现状中的反证'),
  })),
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
  project_summary_cn: z
    .string()
    .describe(
      '用 1-2 句中文说明这个项目是干什么的,面向不熟悉该仓库的读者。只依据 README/描述/代码事实,禁止编造功能,不要写鸿蒙适配建议',
    ),
  opportunity_verdict: opportunityVerdictEnum.describe(
    '初筛结论；没有项目特定的鸿蒙专属结合价值时必须输出 NO_CLEAR_OPPORTUNITY',
  ),
  client_relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('项目能力在鸿蒙终端/应用中的直接相关度 0-1'),
  platform_integration_need: z
    .number()
    .min(0)
    .max(1)
    .describe('项目是否需要鸿蒙专属平台实现才能发挥价值 0-1；平台无关代码应低分'),
  reusable_asset_strength: z
    .number()
    .min(0)
    .max(1)
    .describe('材料中可核验、可复用的项目模块/接口/算法强度 0-1'),
  feasibility: z
    .number()
    .min(0)
    .max(1)
    .describe('适配可行性 0-1,按锚点标尺打分,考虑平台耦合与 license'),
  screening_reason: z.string().describe('用 1-3 句说明为什么进入或不进入结合机会深评，不输出实施路线'),
  confidence: z.number().min(0).max(1).describe('结论置信度 0-1,信息不足时必须给低值'),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

// ---- tier-2 深度评估 schema ------------------------------------------------
export const evaluateSchema = z.object({
  category: z.string().describe('项目所属顶层分类 slug'),
  subcategory: z.string().describe('子分类 slug'),
  propose_new_category: z.boolean().default(false),
  new_category: newCategoryProposalSchema.nullable().default(null),
  project_summary_cn: z
    .string()
    .describe(
      '用 1-2 句中文说明这个项目是干什么的,面向不熟悉该仓库的读者。只依据 README/描述/代码事实,禁止编造功能,不要写鸿蒙适配建议',
    ),
  opportunity_verdict: opportunityVerdictEnum.describe(
    '结合机会结论。允许且鼓励在没有可信机会时输出 NO_CLEAR_OPPORTUNITY 或 INSUFFICIENT_EVIDENCE',
  ),
  client_relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('项目能力在鸿蒙终端/应用中的直接相关度 0-1'),
  feasibility: z.number().min(0).max(1).describe('适配可行性 0-1,按锚点标尺打分'),
  effort_estimate: z.number().min(0).max(1).describe('适配工作量 0 易 1 难,按锚点标尺打分'),
  ecosystem_gap: z
    .number()
    .min(0)
    .max(1)
    .describe('该品类鸿蒙生态真实空白程度 0-1；适配现状只是稀缺度输入，还须考虑端侧重要性、可直接复用性与替代品'),
  harmony_leverage: z
    .number()
    .min(0)
    .max(1)
    .describe('项目能力经过鸿蒙专属集成后产生的增量生态价值 0-1；平台无关且可直接使用的通用库应低分'),
  opportunities: z
    .array(
      z.object({
        area: z.string().describe('结合机会领域,如 UI/网络/存储/原生能力/工具链'),
        description: z.string().describe('要交付什么,必须挂到该项目的具体模块/接口/功能'),
        difficulty: z.enum(['low', 'medium', 'high']),
        harmony_value: z.string().describe('该能力补足鸿蒙生态的什么缺口，服务哪些端侧/跨设备场景'),
        project_assets: z.string().describe('可直接复用的项目模块、接口、算法或平台抽象层；必须来自证据材料'),
        uncovered_scope: z.string().describe('当前已支持现状尚未覆盖的具体范围；已有支持全部覆盖时不得保留此机会'),
        implementation_outline: z.string().describe('具体实现轮廓，指出从哪个模块或平台插槽入手'),
        target_devices: z.array(z.string()).describe('适用鸿蒙设备形态，如手机/平板/2in1/穿戴/智慧屏；不适用则空数组'),
        target_kits: z.array(z.string()).describe('可能对接的 HarmonyOS Kit/API/Node-API/ArkUI；无材料支撑时写“需验证:能力”'),
        integration_form: z.enum([
          'ohpm_package',
          'arkui_component',
          'napi_module',
          'platform_backend',
          'sdk_plugin',
          'app_feature',
          'docs_tooling',
        ]).describe('在鸿蒙生态中的最终交付形态'),
        ecosystem_need: z.number().min(0).max(1).describe('具体生态需求强度；缺少独立依据时不得超过 0.5'),
        project_advantage: z.number().min(0).max(1).describe('该项目相对通用替代方案的独有优势 0-1'),
        user_reach: z.number().min(0).max(1).describe('可覆盖的终端用户和设备范围 0-1'),
        upstream_fit: z.number().min(0).max(1).describe('能否形成可维护、可上游的正式交付 0-1'),
        confidence: z.number().min(0).max(1).describe('该条机会的证据置信度 0-1'),
        evidence_refs: z
          .array(z.string())
          .min(1)
          .describe('材料中真实存在的文件路径、README 引文或信号 URL；不得拼造'),
        validation_questions: z
          .array(z.string())
          .describe('仍需人工或下一层代码深析确认的问题；没有则空数组'),
      }),
    )
    .max(5)
    .default([]),
  analysis_details: analysisDetailsSchema.describe('专业技术尽调正文；必须先形成这些判断，再给数值摘要'),
  recommended_approach: z
    .string()
    .nullable()
    .describe('推荐路径:指明具体技术方案与入手点(如 NAPI 封装某模块 / ArkUI 重写 UI 层),不写空话'),
  reasoning: z
    .string()
    .describe('评估理由(中文):项目资产、鸿蒙专属价值、为什么保留或放弃机会、关键风险'),
  confidence: z.number().min(0).max(1).describe('结论置信度 0-1,信息不足时必须给低值'),
});
export type EvaluateResult = z.infer<typeof evaluateSchema>;
