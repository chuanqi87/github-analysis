// LLM 结构化输出 schema(zod)。generateObject 依此校验并触发重试。
import { z } from 'zod';
import { REPO_CATEGORIES, HARMONY_STATES } from '@/lib/types';

const categoryEnum = z.enum(REPO_CATEGORIES);
const harmonyEnum = z.enum(HARMONY_STATES);

export const classifySchema = z.object({
  category: categoryEnum.describe('项目分类'),
  subcategory: z.string().default('').describe('更细的子分类(自由文本)'),
  harmony_suggestion: harmonyEnum.describe('鸿蒙化状态建议(须与给定事实信号一致)'),
  mobile_relevance: z.number().min(0).max(1).describe('对移动/跨端场景的价值 0-1'),
  feasibility: z.number().min(0).max(1).describe('适配到鸿蒙的技术可行性/意义 0-1'),
  confidence: z.number().min(0).max(1),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

export const evaluateSchema = z.object({
  category: categoryEnum,
  subcategory: z.string().default(''),
  harmony_suggestion: harmonyEnum,
  mobile_relevance: z.number().min(0).max(1),
  feasibility: z.number().min(0).max(1),
  effort_estimate: z.number().min(0).max(1).describe('适配工作量 0 易 1 难'),
  ecosystem_gap: z.number().min(0).max(1).describe('该品类鸿蒙生态空白程度 0-1'),
  adaptation_points: z
    .array(
      z.object({
        area: z.string().describe('适配点领域,如 UI/网络/存储/原生能力'),
        description: z.string(),
        difficulty: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(6)
    .default([]),
  recommended_approach: z
    .string()
    .describe('推荐路径,如 ArkTS 重写 / NAPI 封装 C++ / RN-ArkUI 桥接 / 不建议'),
  reasoning: z.string().describe('评估理由(中文)'),
  confidence: z.number().min(0).max(1),
});
export type EvaluateResult = z.infer<typeof evaluateSchema>;
