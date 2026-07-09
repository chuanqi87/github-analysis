// GitHub REST 基座:鉴权、限流、重试、README、单文件存在性。
import { githubApiLimiter, githubSearchLimiter, withRetry, sleep } from '@/lib/ratelimit/limiter';

const API = 'https://api.github.com';

export function githubHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'harmony-adapt-analytics',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

interface RestOpts {
  accept?: string;
  search?: boolean; // 走 search 限流器(30/min)
  allow404?: boolean;
}

export async function restFetch(path: string, opts: RestOpts = {}): Promise<Response> {
  const limiter = opts.search ? githubSearchLimiter : githubApiLimiter;
  const url = path.startsWith('http') ? path : `${API}${path}`;
  return withRetry(
    () =>
      limiter.schedule(async () => {
        const res = await fetch(url, { headers: githubHeaders(opts.accept) });
        // 主动处理二级限流 / 配额耗尽
        if (res.status === 403 || res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const remaining = Number(res.headers.get('x-ratelimit-remaining'));
          if (retryAfter > 0) await sleep(retryAfter * 1000);
          else if (remaining === 0) {
            const reset = Number(res.headers.get('x-ratelimit-reset'));
            const waitMs = Math.max(0, reset * 1000 - Date.now()) + 1000;
            await sleep(Math.min(waitMs, 60_000));
          }
          throw new Error(`GitHub 限流 ${res.status} @ ${url}`);
        }
        if (!res.ok && !(opts.allow404 && res.status === 404)) {
          throw new Error(`GitHub ${res.status} @ ${url}`);
        }
        return res;
      }),
    { label: url },
  );
}

/** 拉取 README 原文(截断);404 返回 null。 */
export async function getReadme(
  owner: string,
  name: string,
  maxChars = 8000,
): Promise<string | null> {
  const res = await restFetch(`/repos/${owner}/${name}/readme`, {
    accept: 'application/vnd.github.raw',
    allow404: true,
  });
  if (res.status === 404) return null;
  const text = await res.text();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** 单文件/目录是否存在(GraphQL 兜底)。 */
export async function contentExists(owner: string, name: string, path: string): Promise<boolean> {
  const res = await restFetch(
    `/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`,
    { allow404: true },
  );
  return res.status === 200;
}
