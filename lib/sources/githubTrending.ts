// GitHub Trending 页面抓取(无官方 API,best-effort 解析 HTML)。
//
// 每个 article.Box-row 里有两个不同语义的 star 数,别搞混:
//   - `<a href="/owner/repo/stargazers">12,345</a>`      → 仓库总 star 数
//   - `<span class="float-sm-right">1,234 stars this week</span>` → 周期内新增 star 数
// 页面结构会变,两者都取不到时返回 null,由上层决定回退到哪个来源。
import * as cheerio from 'cheerio';
import { withRetry } from '@/lib/ratelimit/limiter';

export type TrendingSince = 'daily' | 'weekly' | 'monthly';

export interface GhTrendingItem {
  repo_name: string; // owner/name
  primary_language: string | null;
  description: string | null;
  /** 仓库总 star 数(stargazers 链接文本)。 */
  stars: number | null;
  /** 仓库总 fork 数(forks 链接文本)。 */
  forks: number | null;
  /** 周期内新增 star 数(「N stars this week」)。 */
  stars_delta: number | null;
  rank: number;
}

/** 解析 GitHub 页面上的计数文本:"12,345" / "1.2k" → number。 */
function parseCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.trim().match(/^([\d.,]+)\s*([km])?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = m[2]?.toLowerCase();
  if (unit === 'k') return Math.round(n * 1_000);
  if (unit === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

export async function fetchGithubTrending(
  since: TrendingSince = 'daily',
): Promise<GhTrendingItem[]> {
  const url = `https://github.com/trending?since=${since}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'harmony-adapt-analytics', Accept: 'text/html' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub Trending ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: GhTrendingItem[] = [];
    $('article.Box-row').each((i, el) => {
      const row = $(el);
      const href = row.find('h2 a').attr('href') ?? '';
      const repo_name = href.replace(/^\//, '').trim();
      if (!repo_name.includes('/')) return;
      const description = row.find('p').first().text().trim() || null;
      const primary_language =
        row.find('[itemprop="programmingLanguage"]').first().text().trim() || null;

      // 总量:stargazers / forks 链接
      const stars = parseCount(row.find(`a[href="/${repo_name}/stargazers"]`).first().text());
      const forks = parseCount(row.find(`a[href="/${repo_name}/forks"]`).first().text());

      // 增量:「N stars this week」。float-sm-right 是当前 class,取不到时回退到整行正则。
      const deltaText =
        row.find('span.float-sm-right').first().text().trim() || row.text();
      const deltaMatch = deltaText.match(/([\d.,]+)\s*stars?\s+(?:today|this\s+week|this\s+month)/i);
      const stars_delta = deltaMatch ? parseCount(deltaMatch[1]) : null;

      items.push({ repo_name, primary_language, description, stars, forks, stars_delta, rank: i + 1 });
    });
    return items;
  });
}
