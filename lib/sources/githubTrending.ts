// GitHub Trending 页面抓取(无官方 API,best-effort 解析 HTML)。
import * as cheerio from 'cheerio';
import { withRetry } from '@/lib/ratelimit/limiter';

export type TrendingSince = 'daily' | 'weekly' | 'monthly';

export interface GhTrendingItem {
  repo_name: string; // owner/name
  primary_language: string | null;
  description: string | null;
  rank: number;
}

export async function fetchGithubTrending(
  since: TrendingSince = 'daily',
): Promise<GhTrendingItem[]> {
  const url = `https://github.com/trending?since=${since}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'harmony-adapt-analytics', Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`GitHub Trending ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: GhTrendingItem[] = [];
    $('article.Box-row').each((i, el) => {
      const href = $(el).find('h2 a').attr('href') ?? '';
      const repo_name = href.replace(/^\//, '').trim();
      if (!repo_name.includes('/')) return;
      const description = $(el).find('p').first().text().trim() || null;
      const primary_language =
        $(el).find('[itemprop="programmingLanguage"]').first().text().trim() || null;
      items.push({ repo_name, primary_language, description, rank: i + 1 });
    });
    return items;
  });
}
