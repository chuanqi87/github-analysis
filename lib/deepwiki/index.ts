// DeepWiki 取数入口:把 MCP 调用 + 解析封装成一次 collect。
//
// 分两档(见 docs/deepwiki-redesign.md §4.2):
//   A 目录档:只取 read_wiki_structure(~1s / ~2KB),全部候选都做
//   B 证据档:再加定向提问(~15s),只对 tier-2 候选做
//   深度档:tier-3 用,7 问全上(~50s)
import { DeepwikiNotIndexedError, askQuestion, readWikiStructure } from '@/lib/deepwiki/client';
import {
  TIER2_QUESTIONS,
  TIER3_QUESTIONS,
  QUESTION_VERSION,
  type QuestionKey,
} from '@/lib/deepwiki/questions';
import {
  harmonyEvidenceSchema,
  portingSurfaceSchema,
  parseJsonAnswer,
  parseWith,
  type HarmonyEvidence,
  type PortingSurface,
} from '@/lib/deepwiki/parse';

export { QUESTION_VERSION, DeepwikiNotIndexedError };
export type { HarmonyEvidence, PortingSurface };
export * from '@/lib/deepwiki/parse';

export interface DeepwikiFacts {
  /** false = DeepWiki 尚未索引该仓库,其余字段均为空,调用方须降级 */
  indexed: boolean;
  /** read_wiki_structure 原文(模块地图) */
  wiki_toc: string | null;
  harmony: HarmonyEvidence | null;
  porting: PortingSurface | null;
  /** tier-3 追加问题的解析结果,key → 对象 */
  extra: Record<string, unknown> | null;
  /** 每问的原始回答,便于调试与复现(解析规则变了可以离线重跑) */
  raw_answers: Record<string, string>;
}

export const EMPTY_FACTS: DeepwikiFacts = {
  indexed: false,
  wiki_toc: null,
  harmony: null,
  porting: null,
  extra: null,
  raw_answers: {},
};

const EXPECTED_TIER3_SECTIONS = 5;

/** tier-3 必须真正拿到核心移植面和大部分子系统事实，否则不应伪装成代码深析。 */
export function deepEvidenceCoverage(facts: DeepwikiFacts): {
  complete: boolean;
  core: number;
  subsystems: number;
  expectedSubsystems: number;
} {
  const core = Number(facts.harmony !== null) + Number(facts.porting !== null);
  const subsystems = Object.keys(facts.extra ?? {}).length;
  return {
    complete: facts.indexed && core === 2 && subsystems >= 4,
    core,
    subsystems,
    expectedSubsystems: EXPECTED_TIER3_SECTIONS,
  };
}

export type CollectDepth = 'toc' | 'evidence' | 'deep';

/**
 * 供 LLM input_hash 使用的粗粒度指纹。
 *
 * 刻意只取「有没有 / 有几条 / 哪一档」,不取具体路径文本 ——
 * DeepWiki 每次回答的措辞和路径顺序会有微小抖动,若把原文纳入哈希,
 * 每轮管道都会判定输入变化而全量重跑 LLM,白烧 token。
 */
export function deepwikiFingerprint(facts: DeepwikiFacts | null | undefined) {
  if (!facts || !facts.indexed) return { idx: false };
  return {
    idx: true,
    v: QUESTION_VERSION,
    scope: facts.harmony?.harmony_scope ?? null,
    hp: facts.harmony?.harmony_paths.length ?? 0,
    decl: facts.harmony?.declares_harmony_support ?? null,
    abs: facts.porting?.has_platform_abstraction ?? null,
    pl: facts.porting?.platform_layer_paths.length ?? 0,
    be: [...(facts.porting?.existing_platform_backends ?? [])].sort(),
    bd: facts.porting?.blocking_deps.length ?? 0,
    // 原生占比按 0.1 粒度取整,避免 0.70/0.72 之间的抖动触发重跑
    nat: facts.porting?.native_code_ratio == null
      ? null
      : Math.round(facts.porting.native_code_ratio * 10),
  };
}

/**
 * 采集一个仓库的 DeepWiki 事实。
 *
 * 未索引返回 `indexed: false` 而不是抛错 —— 这是预期内的正常分支,
 * 上游据此把仓库交给 scripts/agent/ 的 tarball 兜底路径。
 */
export async function collectDeepwiki(
  repoFullName: string,
  depth: CollectDepth = 'evidence',
): Promise<DeepwikiFacts> {
  let wikiToc: string;
  try {
    wikiToc = await readWikiStructure(repoFullName);
  } catch (err) {
    if (err instanceof DeepwikiNotIndexedError) return { ...EMPTY_FACTS };
    throw err;
  }

  if (depth === 'toc') {
    return { ...EMPTY_FACTS, indexed: true, wiki_toc: wikiToc };
  }

  const questions = depth === 'deep' ? TIER3_QUESTIONS : TIER2_QUESTIONS;

  // 并发提问:单问 7~14s,串行会让 tier-3 变成 1 分钟以上。
  // 外层 deepwikiLimiter 仍在兜底全局并发,这里不会打爆对方。
  const answers = await Promise.all(
    questions.map(async ({ key, question }) => {
      try {
        return { key, text: await askQuestion(repoFullName, question) };
      } catch (err) {
        // 单问失败不该拖垮整仓:留空继续,facts 里体现为该字段缺失
        if (err instanceof DeepwikiNotIndexedError) return { key, text: null };
        console.warn(`[deepwiki] ${repoFullName} 提问失败(${key}):${(err as Error).message}`);
        return { key, text: null };
      }
    }),
  );

  const raw: Record<string, string> = {};
  for (const { key, text } of answers) {
    if (text) raw[key] = text;
  }

  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(raw) as QuestionKey[]) {
    if (key === 'harmony_evidence' || key === 'porting_surface') continue;
    const parsed = parseJsonAnswer(raw[key]);
    if (parsed) extra[key] = parsed;
  }

  return {
    indexed: true,
    wiki_toc: wikiToc,
    harmony: raw.harmony_evidence
      ? parseWith(harmonyEvidenceSchema, raw.harmony_evidence)
      : null,
    porting: raw.porting_surface ? parseWith(portingSurfaceSchema, raw.porting_surface) : null,
    extra: Object.keys(extra).length > 0 ? extra : null,
    raw_answers: raw,
  };
}
