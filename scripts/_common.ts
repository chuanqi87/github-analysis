import 'dotenv/config';

export interface StageOpts {
  limit?: number;
  since?: string;
  force?: boolean;
  ids?: number[]; // 仅处理指定仓库 id(每日热点增量用)
  /** deepwiki 阶段专用:取多少个仓库做定向提问(其余只取廉价的目录) */
  evidenceLimit?: number;
  /** daily 阶段：每日 tier-1 初筛预算。 */
  preliminaryLimit?: number;
  /** daily 阶段：每日 tier-2 深评预算。 */
  deepLimit?: number;
  /** daily 阶段：每日 tier-3 代码级深析预算。 */
  tier3Limit?: number;
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
      case 'evidence-limit':
        out.evidenceLimit = value ? Number(value) : undefined;
        break;
      case 'preliminary-limit':
        out.preliminaryLimit = value ? Number(value) : undefined;
        break;
      case 'deep-limit':
        out.deepLimit = value ? Number(value) : undefined;
        break;
      case 'tier3-limit':
        out.tier3Limit = value ? Number(value) : undefined;
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
  // GitHub Actions 使用 UTC；业务看板按北京时间分日，避免每天 05:00 的定时任务记到前一天。
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function todayStartIso(): string {
  return new Date(`${today()}T00:00:00+08:00`).toISOString();
}
