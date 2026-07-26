// DeepWiki 回答的宽松解析。
//
// 实测的三个坑(见 docs/deepwiki-redesign.md §2.3):
//   1. 有时裹 ```json 围栏,有时直接给裸 JSON
//   2. 结尾总会附加 "Wiki pages you might want to explore:" 和一条 search URL
//   3. 会返回 schema 之外的枚举值(要 none|partial|strong,它给 "not_applicable")
//
// 因此:先剥壳,再用 zod 宽松校验 —— 非法枚举归一到 null 而不是整条丢弃,
// 解析失败也只降级为"这个字段没有",绝不让管道挂掉。
import { z } from 'zod';
import { HARMONY_SCOPES, type HarmonyScope } from '@/lib/types';

/** DeepWiki 在正文后追加推荐内容的分隔标记。 */
const TRAILER_MARKERS = [
  'Wiki pages you might want to explore:',
  'View this search on DeepWiki:',
];

/**
 * 从 DeepWiki 回答中剥离出 JSON 文本。
 * 处理:围栏、尾部推荐块、前后散字。
 */
export function extractJsonText(answer: string): string | null {
  let text = answer;

  // 1. 砍掉尾部推荐块
  for (const marker of TRAILER_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1) text = text.slice(0, idx);
  }

  // 2. 优先取 ``` 围栏里的内容
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim() || null;

  // 3. 无围栏:取第一个 { 到最后一个 } 之间的片段
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1).trim() || null;
}

/** 解析为普通对象;失败返回 null(调用方保留原文以便排查)。 */
export function parseJsonAnswer(answer: string): Record<string, unknown> | null {
  const text = extractJsonText(answer);
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── 宽松字段工具 ─────────────────────────────────────────────────────────────
// DeepWiki 不受 schema 约束,所以每个字段都要能容忍缺失/类型不符。

/** 字符串数组:过滤掉空串与非字符串项;非数组输入返回 []。 */
const looseStringArray = z
  .any()
  .transform((v): string[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  });

const looseString = z
  .any()
  .transform((v): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null));

const looseBool = z
  .any()
  .transform((v): boolean | null => (typeof v === 'boolean' ? v : null));

/** 0-1 实数;越界钳制,非数字归 null。 */
const looseRatio = z.any().transform((v): number | null => {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return Math.max(0, Math.min(1, v));
});

/** 枚举:不在白名单内(如 flutter 返回的 "not_applicable")一律归 null,而不是让整条校验失败。 */
function looseEnum<T extends readonly string[]>(allowed: T) {
  return z.any().transform((v): T[number] | null => {
    if (typeof v !== 'string') return null;
    const norm = v.trim().toLowerCase();
    return (allowed as readonly string[]).includes(norm) ? (norm as T[number]) : null;
  });
}

// ── Q1 鸿蒙证据 ──────────────────────────────────────────────────────────────

export { HARMONY_SCOPES };
export type { HarmonyScope };

export const harmonyEvidenceSchema = z.object({
  harmony_paths: looseStringArray,
  harmony_quote: looseString,
  harmony_scope: looseEnum(HARMONY_SCOPES),
  declares_harmony_support: looseBool,
  ohos_imports: looseStringArray,
});
export type HarmonyEvidence = z.infer<typeof harmonyEvidenceSchema>;

// ── Q2 移植面 ────────────────────────────────────────────────────────────────

export const PROJECT_TYPES = [
  'library',
  'framework',
  'application',
  'tool',
  'docs',
  'other',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

const blockingDepSchema = z
  .any()
  .transform((v): { name: string; why: string }[] => {
    if (!Array.isArray(v)) return [];
    return v
      .map((d) => {
        if (typeof d === 'string') return { name: d.trim(), why: '' };
        if (d && typeof d === 'object') {
          const name = (d as Record<string, unknown>).name;
          const why = (d as Record<string, unknown>).why;
          if (typeof name === 'string' && name.trim()) {
            return { name: name.trim(), why: typeof why === 'string' ? why.trim() : '' };
          }
        }
        return null;
      })
      .filter((d): d is { name: string; why: string } => d !== null);
  });

export const portingSurfaceSchema = z.object({
  project_type: looseEnum(PROJECT_TYPES),
  languages: looseStringArray,
  native_code_ratio: looseRatio,
  has_platform_abstraction: looseBool,
  platform_layer_paths: looseStringArray,
  existing_platform_backends: looseStringArray,
  portable_core_paths: looseStringArray,
  blocking_deps: blockingDepSchema,
  platform_apis_used: looseStringArray,
  conditional_compilation: looseStringArray,
});
export type PortingSurface = z.infer<typeof portingSurfaceSchema>;

/**
 * 用给定 schema 宽松解析一条回答。
 * 因为所有字段都是 transform 且带兜底,safeParse 实际不会失败;
 * 真正的失败只发生在「压根不是 JSON」,此时返回 null。
 */
export function parseWith<T extends z.ZodTypeAny>(
  schema: T,
  answer: string,
): z.infer<T> | null {
  const obj = parseJsonAnswer(answer);
  if (!obj) return null;
  const result = schema.safeParse(obj);
  return result.success ? result.data : null;
}
