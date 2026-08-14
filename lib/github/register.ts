import { batchEnrich, type EnrichResult } from '@/lib/github/graphql';
import type { GitHubRepositoryRef } from '@/lib/github/repository-ref';
import { getAdminClient, upsertBatched } from '@/lib/supabase/admin';

interface ExistingArchiveState {
  id: number;
  is_archived: boolean;
  archived_reason: string | null;
}

export interface RegisteredRepository {
  id: number;
  fullName: string;
}

async function loadArchiveStates(ids: number[]): Promise<Map<number, ExistingArchiveState>> {
  const { data, error } = await getAdminClient()
    .from('repositories')
    .select('id,is_archived,archived_reason')
    .in('id', ids);
  if (error) throw new Error(`加载已有仓库状态失败：${error.message}`);
  return new Map(
    ((data ?? []) as ExistingArchiveState[]).map((row) => [row.id, row]),
  );
}

function repositoryRow(repo: EnrichResult, existing?: ExistingArchiveState) {
  const derivedArchived = existing?.is_archived === true && existing.archived_reason !== 'github_archived';
  return {
    id: repo.id!,
    full_name: repo.full_name,
    owner: repo.owner!,
    name: repo.name!,
    description: repo.description,
    homepage: repo.homepage,
    primary_language: repo.primary_language,
    stars: repo.stars,
    forks: repo.forks,
    license: repo.license,
    pushed_at: repo.pushed_at,
    repo_created_at: repo.repo_created_at,
    topics: repo.topics,
    latest_release_at: repo.latest_release_at,
    is_archived: repo.is_archived || derivedArchived,
    archived_reason: repo.is_archived
      ? 'github_archived'
      : derivedArchived
        ? existing?.archived_reason ?? null
        : null,
  };
}

function signalRow(repo: EnrichResult) {
  return {
    repository_id: repo.id!,
    has_oh_package: repo.has_oh_package,
    has_build_profile: repo.has_build_profile,
    has_module_json5: repo.has_module_json5,
    has_hvigor: repo.has_hvigor,
    has_entry_dir: repo.has_entry_dir,
    has_ets: repo.has_ets,
  };
}

/** 从 GitHub 获取指定仓库的真实 ID 和元数据，并幂等登记到现有分析数据模型。 */
export async function registerGitHubRepositories(
  repositories: GitHubRepositoryRef[],
): Promise<RegisteredRepository[]> {
  const enriched = await batchEnrich(repositories.map((repository) => ({
    owner: repository.owner,
    name: repository.name,
    full_name: repository.fullName,
  })));
  const missing = enriched.filter((repo) => !repo.found || repo.id == null || !repo.owner || !repo.name);
  if (missing.length) {
    throw new Error(`GitHub 仓库不存在或当前 Token 无权访问：${missing.map((repo) => repo.full_name).join(', ')}`);
  }

  const valid = enriched as Array<EnrichResult & { id: number; owner: string; name: string }>;
  const archiveStates = await loadArchiveStates(valid.map((repo) => repo.id));
  await upsertBatched(
    'repositories',
    valid.map((repo) => repositoryRow(repo, archiveStates.get(repo.id))),
    { onConflict: 'id' },
  );
  await upsertBatched('harmony_signals', valid.map(signalRow), { onConflict: 'repository_id' });

  return valid.map((repo) => ({ id: repo.id, fullName: repo.full_name }));
}
