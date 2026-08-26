// 把仓库元数据 / LLM 产出拼成「这个项目是干什么的」中文说明。
// 优先用 LLM 的 project_summary_cn;没有时从评估理由或分类兜底,不编造功能。

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  library: '库',
  framework: '框架',
  application: '应用',
  tool: '工具',
  docs: '文档项目',
  other: '开源项目',
};

export interface ProjectIntroInput {
  name: string;
  full_name?: string;
  description: string | null;
  category_name?: string | null;
  subcategory_name?: string | null;
  primary_language?: string | null;
  project_summary_cn?: string | null;
  reasoning?: string | null;
  deepwiki_project_type?: string | null;
}

export interface ProjectIntro {
  /** 给读者看的中文说明 */
  summary: string;
  /** GitHub 原描述;与 summary 不同时才带上 */
  original?: string;
}

const CJK_RE = /[\u3400-\u9fff]/;

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/** 从 tier-2/3 评估理由里抽出「项目是什么」那一句,丢掉适配建议和取证行话。 */
export function extractFromReasoning(reasoning: string): string | null {
  const cut = reasoning
    .replace(/^\s*[①1][.、:：]?\s*(技术栈与平台耦合点[:：]?)?/, '')
    .split(/[②2][.、:：]|适配现状|推荐路径|关键风险/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!hasCjk(cut) || cut.length < 12) return null;

  const jargonAt = cut.search(/[，,。].*(?:DeepWiki|ohpm|GitCode|鸿蒙|适配|原生代码|bridge|FFI|PENDING_)/);
  const head = (jargonAt > 8 ? cut.slice(0, jargonAt) : cut).replace(/[，,、；;]+$/u, '').trim();
  if (head.length < 8 || /DeepWiki|ohpm|GitCode|PENDING_/.test(head)) return null;

  const isWhat = head.match(/^.{2,48}是.{2,40}(库|框架|工具|应用|引擎|项目|组件|平台|服务|协议)/);
  const picked = isWhat ? isWhat[0] : head.split(/[。！？]/)[0] ?? head;
  if (picked.length < 8) return null;
  return /[。！？]$/.test(picked) ? picked : `${picked}。`;
}

function typeWord(projectType: string | null | undefined): string {
  return PROJECT_TYPE_LABELS[projectType ?? ''] ?? '开源项目';
}

function composeFallback(row: ProjectIntroInput): string {
  const cat = [row.category_name, row.subcategory_name].filter(Boolean) as string[];
  const kind = typeWord(row.deepwiki_project_type);
  const name = row.name || row.full_name || '该仓库';
  const bits: string[] = [];
  if (cat.length) bits.push(`${name} 是一个「${cat.join(' / ')}」${kind}`);
  else bits.push(`${name} 是一个${kind}`);
  if (row.primary_language) bits.push(`主要使用 ${row.primary_language}`);
  return `${bits.join('，')}。`;
}

export function buildProjectIntro(row: ProjectIntroInput): ProjectIntro {
  const original = row.description?.trim() || undefined;
  const llm = row.project_summary_cn?.trim();
  if (llm) {
    return { summary: llm, original: original && original !== llm ? original : undefined };
  }

  if (original && hasCjk(original)) {
    return { summary: original };
  }

  const fromReasoning = row.reasoning ? extractFromReasoning(row.reasoning) : null;
  if (fromReasoning) {
    return { summary: fromReasoning, original };
  }

  return { summary: composeFallback(row), original };
}
