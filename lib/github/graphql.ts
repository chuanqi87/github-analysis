// GitHub GraphQL:一次批量取元数据 + 探测鸿蒙工程文件存在性(alias)。
// 把 N×文件数 次 REST 压成 ~N/BATCH 次 GraphQL,规避配额。
import { githubApiLimiter, withRetry } from '@/lib/ratelimit/limiter';
import { githubHeaders } from '@/lib/github/rest';

const GRAPHQL = 'https://api.github.com/graphql';
const BATCH = 40;

export interface EnrichResult {
  full_name: string;
  found: boolean;
  id: number | null;
  owner: string | null;
  name: string | null;
  description: string | null;
  homepage: string | null;
  primary_language: string | null;
  languages: string[];
  stars: number;
  forks: number;
  license: string | null;
  pushed_at: string | null;
  repo_created_at: string | null;
  topics: string[];
  // 归档状态
  is_archived: boolean;
  latest_release_at: string | null;
  // 工程文件信号
  has_oh_package: boolean;
  has_build_profile: boolean;
  has_module_json5: boolean;
  has_hvigor: boolean;
  has_entry_dir: boolean;
  has_ets: boolean;
}

interface RepoNode {
  databaseId: number | null;
  owner: { login: string };
  name: string;
  nameWithOwner: string;
  description: string | null;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  createdAt: string | null;
  primaryLanguage: { name: string } | null;
  languages: { nodes: { name: string }[] } | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: { topic: { name: string } }[] } | null;
  isArchived: boolean;
  latestRelease: { nodes: { publishedAt: string | null }[] } | null;
  ohPackage: { __typename: string } | null;
  buildProfile: { __typename: string } | null;
  moduleJson: { __typename: string } | null;
  hvigor: { __typename: string } | null;
  entryDir: { __typename: string } | null;
}

function buildQuery(batch: { owner: string; name: string }[]): string {
  const parts = batch.map((r, i) => {
    const owner = JSON.stringify(r.owner);
    const name = JSON.stringify(r.name);
    return `
      r${i}: repository(owner: ${owner}, name: ${name}) {
        databaseId
        owner { login }
        name
        nameWithOwner
        description
        homepageUrl
        stargazerCount
        forkCount
        pushedAt
        createdAt
        primaryLanguage { name }
        languages(first: 15, orderBy: { field: SIZE, direction: DESC }) { nodes { name } }
        licenseInfo { spdxId }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        isArchived
        latestRelease: releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { publishedAt } }
        ohPackage: object(expression: "HEAD:oh-package.json5") { __typename }
        buildProfile: object(expression: "HEAD:build-profile.json5") { __typename }
        moduleJson: object(expression: "HEAD:module.json5") { __typename }
        hvigor: object(expression: "HEAD:hvigorfile.ts") { __typename }
        entryDir: object(expression: "HEAD:entry") { __typename }
      }`;
  });
  return `query {${parts.join('\n')}\n}`;
}

async function runGraphql(query: string): Promise<Record<string, RepoNode | null>> {
  return withRetry(() =>
    githubApiLimiter.schedule(async () => {
      const res = await fetch(GRAPHQL, {
        method: 'POST',
        headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: Record<string, RepoNode | null>;
        errors?: { message: string; type?: string }[];
      };
      // NOT_FOUND 之类的按仓库级错误容忍(该 alias 的 data 为 null)。
      if (!json.data) {
        throw new Error(`GraphQL 无 data:${JSON.stringify(json.errors)?.slice(0, 200)}`);
      }
      return json.data;
    }),
  );
}

function mapNode(fullName: string, node: RepoNode | null): EnrichResult {
  if (!node) {
    return {
      full_name: fullName,
      found: false,
      id: null,
      owner: null,
      name: null,
      description: null,
      homepage: null,
      primary_language: null,
      languages: [],
      stars: 0,
      forks: 0,
      license: null,
      pushed_at: null,
      repo_created_at: null,
      topics: [],
      is_archived: false,
      latest_release_at: null,
      has_oh_package: false,
      has_build_profile: false,
      has_module_json5: false,
      has_hvigor: false,
      has_entry_dir: false,
      has_ets: false,
    };
  }
  const languages = (node.languages?.nodes ?? []).map((n) => n.name);
  const hasEts = languages.some((l) => /^(ets|arkts)$/i.test(l));
  const spdx = node.licenseInfo?.spdxId;
  return {
    full_name: node.nameWithOwner,
    found: true,
    id: node.databaseId,
    owner: node.owner?.login ?? null,
    name: node.name,
    description: node.description,
    homepage: node.homepageUrl || null,
    primary_language: node.primaryLanguage?.name ?? null,
    languages,
    stars: node.stargazerCount,
    forks: node.forkCount,
    license: spdx && spdx !== 'NOASSERTION' ? spdx : null,
    pushed_at: node.pushedAt,
    repo_created_at: node.createdAt,
    topics: (node.repositoryTopics?.nodes ?? []).map((n) => n.topic.name),
    is_archived: node.isArchived ?? false,
    latest_release_at: node.latestRelease?.nodes?.[0]?.publishedAt ?? null,
    has_oh_package: !!node.ohPackage,
    has_build_profile: !!node.buildProfile,
    has_module_json5: !!node.moduleJson,
    has_hvigor: !!node.hvigor,
    has_entry_dir: !!node.entryDir,
    has_ets: hasEts,
  };
}

/** 批量富化;输入 owner/name 列表,返回与之对应的富化结果。 */
export async function batchEnrich(
  repos: { owner: string; name: string; full_name: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<EnrichResult[]> {
  const results: EnrichResult[] = [];
  for (let i = 0; i < repos.length; i += BATCH) {
    const batch = repos.slice(i, i + BATCH);
    const data = await runGraphql(buildQuery(batch));
    batch.forEach((r, idx) => {
      results.push(mapNode(r.full_name, data[`r${idx}`] ?? null));
    });
    onProgress?.(Math.min(i + BATCH, repos.length), repos.length);
  }
  return results;
}
