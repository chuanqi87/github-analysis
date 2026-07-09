// 鸿蒙相关关键词打分(仅作加权信号,不单独判定)。
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /openharmony/i, label: 'OpenHarmony' },
  { re: /harmonyos/i, label: 'HarmonyOS' },
  { re: /鸿蒙/, label: '鸿蒙' },
  { re: /\barkts\b/i, label: 'ArkTS' },
  { re: /\barkui\b/i, label: 'ArkUI' },
  { re: /\bohpm\b/i, label: 'ohpm' },
  { re: /@ohos\//i, label: '@ohos/' },
  { re: /\bhvigor\b/i, label: 'hvigor' },
  { re: /harmony\s*next/i, label: 'HarmonyOS Next' },
];

export function keywordHits(text: string | null | undefined): string[] {
  if (!text) return [];
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
}

/** 命中不同关键词越多分越高,最多 1.0。 */
export function keywordScore(text: string | null | undefined): number {
  const hits = keywordHits(text).length;
  if (hits === 0) return 0;
  return Math.min(1, hits / 4);
}
