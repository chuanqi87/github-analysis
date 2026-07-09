// OSS Insight Trending API(免鉴权)。
// 返回 { data: { columns: [...], rows: [ {repo_name, ...} ] } } 信封,需按行对象取值。
import { withRetry } from '@/lib/ratelimit/limiter';

export type TrendingPeriod = 'past_24_hours' | 'past_week' | 'past_month';

export interface TrendingItem {
  repo_name: string;
  primary_language: string | null;
  description: string | null;
  stars: number | null;
  forks: number | null;
  total_score: number | null;
  rank: number;
}

interface OssInsightEnvelope {
  data?: {
    columns?: { col: string }[];
    rows?: Record<string, string>[];
  };
}

function num(v: string | undefined | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchTrending(
  period: TrendingPeriod = 'past_24_hours',
  language = 'All',
): Promise<TrendingItem[]> {
  const url = `https://api.ossinsight.io/v1/trends/repos/?period=${period}&language=${encodeURIComponent(language)}`;
  return withRetry(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`OSS Insight ${res.status}`);
    const json = (await res.json()) as OssInsightEnvelope;
    const rows = json.data?.rows ?? [];
    return rows.map((row, i) => ({
      repo_name: row.repo_name ?? '',
      primary_language: row.primary_language || null,
      description: row.description || null,
      stars: num(row.stars),
      forks: num(row.forks),
      total_score: num(row.total_score),
      rank: i + 1,
    })).filter((r) => r.repo_name.includes('/'));
  });
}
