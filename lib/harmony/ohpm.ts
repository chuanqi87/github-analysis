// ohpm 中心仓查询(最权威的鸿蒙化辅助信号)。
// GET https://ohpm.openharmony.cn/ohpm/<包名> → 200(已上架)/ 404(无)。
import { ohpmLimiter, withRetry } from '@/lib/ratelimit/limiter';

const OHPM = 'https://ohpm.openharmony.cn/ohpm';

export interface OhpmResult {
  pkg: string;
  exists: boolean;
  repository: string | null; // 反查到的源码仓(多为 SIG 适配仓)
}

interface OhpmMeta {
  'dist-tags'?: { latest?: string };
  versions?: Record<string, { repository?: string | { url?: string } }>;
}

function extractRepository(meta: OhpmMeta): string | null {
  const latest = meta['dist-tags']?.latest;
  const ver = latest ? meta.versions?.[latest] : undefined;
  const repo = ver?.repository ?? Object.values(meta.versions ?? {})[0]?.repository;
  if (!repo) return null;
  return typeof repo === 'string' ? repo : repo.url ?? null;
}

export async function ohpmPackageExists(pkg: string): Promise<OhpmResult> {
  return withRetry(() =>
    ohpmLimiter.schedule(async () => {
      const res = await fetch(`${OHPM}/${pkg}`, { headers: { Accept: 'application/json' } });
      if (res.status === 404) return { pkg, exists: false, repository: null };
      if (!res.ok) throw new Error(`ohpm ${res.status} @ ${pkg}`);
      const meta = (await res.json()) as OhpmMeta;
      return { pkg, exists: true, repository: extractRepository(meta) };
    }),
  );
}

/** 由 GitHub 仓名猜测可能的 ohpm 包名(命中率有限,仅作候选)。 */
export function guessPackageNames(repoName: string): string[] {
  const lower = repoName.toLowerCase();
  const dashed = lower.replace(/[._\s]+/g, '-');
  const stripped = dashed.replace(/^(ohos-|harmony-|arkts-|ark-)/, '');
  const set = new Set<string>([
    `@ohos/${dashed}`,
    `@ohos/${stripped}`,
    `@ohos/${lower}`,
  ]);
  return Array.from(set);
}

/** 依次尝试候选包名,命中即返回。 */
export async function findOhpmPackage(repoName: string): Promise<OhpmResult | null> {
  for (const pkg of guessPackageNames(repoName)) {
    const r = await ohpmPackageExists(pkg);
    if (r.exists) return r;
  }
  return null;
}
