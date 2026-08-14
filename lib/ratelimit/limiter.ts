// 各数据源限流器(仅管道脚本使用)。
import Bottleneck from 'bottleneck';

// GitHub Search API:认证 30 req/min。留余量 → reservoir 每 60s 补满 28。
export const githubSearchLimiter = new Bottleneck({
  reservoir: 28,
  reservoirRefreshAmount: 28,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 1,
  minTime: 250,
});

// GitHub GraphQL / REST:5000/hr,主要靠低并发控制。
export const githubApiLimiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 80,
});

// ohpm 中心仓:无官方限额说明,自我克制。
export const ohpmLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 120,
});

// LLM(百炼):控制并发,避免触发 provider QPS 限制。
export const llmLimiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 100,
});

// DeepWiki MCP:免费无鉴权,官方未公布限额。实测 16 并发无异常,
// 但既然对方没承诺,就按 5 并发自我克制(ask_question 单次 7~14s,并发才是吞吐关键)。
export const deepwikiLimiter = new Bottleneck({
  // 本轮 5 并发实测会被服务端以 HTTP 200 包装的 429 限流；3 并发约 18 req/min，
  // 能稳定完成 400 项目的两问取证，准确性优先于几分钟的吞吐收益。
  maxConcurrent: 3,
  minTime: 250,
});

/** 通用重试:指数退避 + 抖动;对 429/5xx/网络错误重试。 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const wait = baseMs * 2 ** attempt + Math.floor(sudoRandom(attempt + labelSeed(opts.label)) * baseMs);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 无 Math.random 依赖的确定性抖动(足够打散重试节奏)。
function sudoRandom(seed: number): number {
  const x = Math.sin(seed * 99991 + 7) * 10000;
  return x - Math.floor(x);
}

function labelSeed(label: string | undefined): number {
  if (!label) return 0;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(hash % 10_000);
}
