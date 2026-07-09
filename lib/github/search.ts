// GitHub Search:star 区间分段枚举,绕过每查询 1000 条上限。
import { restFetch } from '@/lib/github/rest';

export interface SearchRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  primary_language: string | null;
  stars: number;
  forks: number;
  open_issues: number | null;
  topics: string[];
  license: string | null;
  pushed_at: string | null;
  repo_created_at: string | null;
  homepage: string | null;
  archived: boolean;
}

interface RawItem {
  id: number;
  full_name: string;
  owner: { login: string };
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics?: string[];
  license?: { spdx_id: string | null } | null;
  pushed_at: string | null;
  created_at: string | null;
  homepage: string | null;
  archived: boolean;
}

function mapItem(it: RawItem): SearchRepo {
  return {
    id: it.id,
    full_name: it.full_name,
    owner: it.owner.login,
    name: it.name,
    description: it.description,
    primary_language: it.language,
    stars: it.stargazers_count,
    forks: it.forks_count,
    open_issues: it.open_issues_count,
    topics: it.topics ?? [],
    license: it.license?.spdx_id && it.license.spdx_id !== 'NOASSERTION' ? it.license.spdx_id : null,
    pushed_at: it.pushed_at,
    repo_created_at: it.created_at,
    homepage: it.homepage || null,
    archived: it.archived ?? false,
  };
}

async function searchPage(q: string, page: number): Promise<{ total: number; items: RawItem[] }> {
  const params = new URLSearchParams({
    q,
    sort: 'stars',
    order: 'desc',
    per_page: '100',
    page: String(page),
  });
  const res = await restFetch(`/search/repositories?${params}`, { search: true });
  const json = (await res.json()) as { total_count: number; items: RawItem[] };
  return { total: json.total_count, items: json.items ?? [] };
}

function rangeQuery(lo: number, hi: number | null): string {
  const range = hi == null ? `>=${lo}` : `${lo}..${hi}`;
  return `stars:${range}`;
}

/** 收集单个 star 区间(<=1000 条时翻页取全,否则二分拆分)。 */
async function collectRange(
  lo: number,
  hi: number | null,
  out: Map<number, SearchRepo>,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const q = rangeQuery(lo, hi);
  const first = await searchPage(q, 1);
  if (first.total === 0) return;

  if (first.total <= 1000) {
    for (const it of first.items) out.set(it.id, mapItem(it));
    const pages = Math.ceil(first.total / 100);
    for (let p = 2; p <= Math.min(pages, 10); p++) {
      const { items } = await searchPage(q, p);
      for (const it of items) out.set(it.id, mapItem(it));
    }
    onProgress?.(`  ${q} → ${first.total} 条`);
    return;
  }

  // >1000:二分拆分(hi 为 null 时以当前最高 star 为上界)
  const upper = hi ?? first.items[0]?.stargazers_count ?? lo * 4;
  if (upper <= lo) {
    // 同一 star 值就超过 1000(极罕见),只能取前 1000
    for (const it of first.items) out.set(it.id, mapItem(it));
    onProgress?.(`  ${q} → 超 1000 且不可再分,仅取前 1000`);
    return;
  }
  const mid = Math.floor((lo + upper) / 2);
  onProgress?.(`  ${q} (${first.total}) 拆分 @ ${mid}`);
  await collectRange(mid + 1, upper, out, onProgress); // 高段
  await collectRange(lo, mid, out, onProgress); // 低段
}

/** 枚举所有 stars >= minStars 的仓库。 */
export async function enumerateTopRepos(
  minStars = 10000,
  onProgress?: (msg: string) => void,
): Promise<SearchRepo[]> {
  const out = new Map<number, SearchRepo>();
  await collectRange(minStars, null, out, onProgress);
  return Array.from(out.values()).sort((a, b) => b.stars - a.stars);
}

/** 仅取 top N(按 star 降序,用于 MVP 切片);不做全量分段。 */
export async function fetchTopN(n: number): Promise<SearchRepo[]> {
  const out = new Map<number, SearchRepo>();
  const pages = Math.ceil(Math.min(n, 1000) / 100);
  for (let p = 1; p <= pages; p++) {
    const { items } = await searchPage('stars:>=10000', p);
    for (const it of items) out.set(it.id, mapItem(it));
  }
  return Array.from(out.values())
    .sort((a, b) => b.stars - a.stars)
    .slice(0, n);
}
