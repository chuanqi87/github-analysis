// 已鸿蒙化三方库底表(tpc_resource 等),用于辅助命中判断。
// 数据是分层 Markdown 列表:`- [名](URL) - 描述`。抓取解析后建名称/URL 索引。
import { withRetry } from '@/lib/ratelimit/limiter';

export interface RegistryEntry {
  name: string;
  url: string;
  source: string;
}

export interface RegistryIndex {
  names: Set<string>; // 归一化库名
  urls: Set<string>; // 归一化仓库 URL(host/owner/name)
  entries: RegistryEntry[];
}

// 底表来源(生态正从 Gitee 迁往 GitCode,两处都尝试)。
const SOURCES = [
  { url: 'https://gitee.com/openharmony-tpc/tpc_resource/raw/master/README.md', source: 'tpc_resource' },
  { url: 'https://raw.gitcode.com/openharmony-tpc/tpc_resource/raw/master/README.md', source: 'tpc_resource' },
];

const LINE_RE = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)/;

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s._-]+/g, '');
}

/** 归一化仓库 URL 到 owner/name(忽略 host / .git 后缀)。 */
export function normalizeRepoUrl(url: string): string | null {
  const m = url.match(/(?:github|gitee|gitcode)\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}/${m[2].toLowerCase()}`;
}

function parseMarkdown(md: string, source: string): RegistryEntry[] {
  const out: RegistryEntry[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(LINE_RE);
    if (m) out.push({ name: m[1].trim(), url: m[2].trim(), source });
  }
  return out;
}

/** 抓取并解析底表;任一源成功即用。失败返回空索引(信号退化为关闭)。 */
export async function loadRegistry(): Promise<RegistryIndex> {
  const entries: RegistryEntry[] = [];
  for (const src of SOURCES) {
    try {
      const md = await withRetry(
        async () => {
          const res = await fetch(src.url, { headers: { 'User-Agent': 'harmony-adapt-analytics' } });
          if (!res.ok) throw new Error(`registry ${res.status}`);
          return res.text();
        },
        { retries: 1 },
      );
      const parsed = parseMarkdown(md, src.source);
      if (parsed.length > 0) {
        entries.push(...parsed);
        break;
      }
    } catch {
      // 尝试下一个源
    }
  }

  const names = new Set<string>();
  const urls = new Set<string>();
  for (const e of entries) {
    names.add(normalizeName(e.name));
    const nu = normalizeRepoUrl(e.url);
    if (nu) urls.add(nu);
  }
  return { names, urls, entries };
}

export interface RegistryMatch {
  hit: boolean;
  source: string | null;
}

/** 判断给定仓库是否在底表(优先按 URL 精确匹配,再按库名兜底)。 */
export function matchRegistry(
  index: RegistryIndex,
  repo: { full_name: string; name: string },
): RegistryMatch {
  const byUrl = normalizeRepoUrl(`github.com/${repo.full_name}`);
  if (byUrl && index.urls.has(byUrl)) return { hit: true, source: 'url' };
  if (index.names.has(normalizeName(repo.name))) return { hit: true, source: 'name' };
  return { hit: false, source: null };
}
