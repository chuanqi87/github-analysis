import type { EnrichResult } from '@/lib/github/graphql';

interface TrendingSeedRef {
  source: string;
  repoName: string;
  rank: number;
}

export interface CanonicalizedTrendingCandidates<TSeed extends TrendingSeedRef> {
  repos: EnrichResult[];
  seeds: TSeed[];
  names: string[];
  duplicateRepositories: number;
  redirectedAliases: number;
}

function repositoryKey(fullName: string): string {
  return fullName.toLocaleLowerCase('en-US');
}

/**
 * GitHub 会把仓库旧名称透明重定向到新名称。不同热点源因此可能提供不同名称，
 * 但 GraphQL 最终返回同一个 databaseId；写库和评分前必须统一到 GitHub 的权威名称。
 */
export function canonicalizeTrendingCandidates<TSeed extends TrendingSeedRef>(
  requestedNames: string[],
  enriched: EnrichResult[],
  seeds: TSeed[],
): CanonicalizedTrendingCandidates<TSeed> {
  if (requestedNames.length !== enriched.length) {
    throw new Error(`热点富化结果数量不一致：请求 ${requestedNames.length}，返回 ${enriched.length}`);
  }

  const canonicalByRequested = new Map<string, string>();
  const repositoriesById = new Map<number, EnrichResult>();
  let validRepositories = 0;
  let redirectedAliases = 0;

  enriched.forEach((repo, index) => {
    if (!repo.found || repo.id == null || !repo.owner || !repo.name) return;

    const requestedName = requestedNames[index];
    canonicalByRequested.set(repositoryKey(requestedName), repo.full_name);
    validRepositories += 1;
    if (repositoryKey(requestedName) !== repositoryKey(repo.full_name)) redirectedAliases += 1;
    if (!repositoriesById.has(repo.id)) repositoriesById.set(repo.id, repo);
  });

  // 同一来源若同时出现仓库新旧名称，只保留排名更高的一条，避免重复增加评分权重。
  const canonicalSeeds = new Map<string, TSeed>();
  for (const seed of seeds) {
    const repoName = canonicalByRequested.get(repositoryKey(seed.repoName)) ?? seed.repoName;
    const normalizedSeed = { ...seed, repoName };
    const key = `${seed.source}\0${repositoryKey(repoName)}`;
    const current = canonicalSeeds.get(key);
    if (!current || normalizedSeed.rank < current.rank) canonicalSeeds.set(key, normalizedSeed);
  }

  const repos = Array.from(repositoriesById.values());
  return {
    repos,
    seeds: Array.from(canonicalSeeds.values()),
    names: repos.map((repo) => repo.full_name),
    duplicateRepositories: validRepositories - repos.length,
    redirectedAliases,
  };
}
