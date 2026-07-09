import 'dotenv/config';

export interface StageOpts {
  limit?: number;
  since?: string;
  force?: boolean;
  ids?: number[]; // 仅处理指定仓库 id(每日热点增量用)
}

export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export function parseArgs(argv: string[]): { stage?: string } & StageOpts {
  const out: { stage?: string } & StageOpts = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case 'stage':
        out.stage = value;
        break;
      case 'limit':
        out.limit = value ? Number(value) : undefined;
        break;
      case 'since':
        out.since = value;
        break;
      case 'force':
        out.force = value !== 'false';
        break;
      case 'ids':
        out.ids = (value ?? '').split(',').map(Number).filter((n) => Number.isFinite(n));
        break;
    }
  }
  return out;
}

/** 简单并发映射(限制同时进行的 promise 数量)。 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
