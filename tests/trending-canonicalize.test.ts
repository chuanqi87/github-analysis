import test from 'node:test';
import assert from 'node:assert/strict';
import type { EnrichResult } from '@/lib/github/graphql';
import { canonicalizeTrendingCandidates } from '@/lib/trending/canonicalize';

function enriched(id: number, fullName: string): EnrichResult {
  const [owner, name] = fullName.split('/');
  return {
    full_name: fullName,
    found: true,
    id,
    owner,
    name,
    description: null,
    homepage: null,
    primary_language: null,
    languages: [],
    stars: 100,
    forks: 10,
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

test('仓库旧名称和新名称解析到同一 GitHub ID 时合并，并统一评分名称', () => {
  const requestedNames = [
    'maka-agent/maka-agent',
    'apache/maka',
    'basecamp/omarchy',
    'omacom/omarchy',
  ];
  const result = canonicalizeTrendingCandidates(
    requestedNames,
    [
      enriched(1, 'apache/maka'),
      enriched(1, 'apache/maka'),
      enriched(2, 'omacom/omarchy'),
      enriched(2, 'omacom/omarchy'),
    ],
    [
      { source: 'ossinsight-daily', repoName: 'maka-agent/maka-agent', rank: 8, weight: 1 },
      { source: 'github-daily', repoName: 'apache/maka', rank: 2, weight: 0.9 },
      { source: 'ossinsight-weekly', repoName: 'basecamp/omarchy', rank: 19, weight: 1.15 },
      { source: 'github-weekly', repoName: 'omacom/omarchy', rank: 1, weight: 1.05 },
    ],
  );

  assert.deepEqual(result.repos.map((repo) => repo.id), [1, 2]);
  assert.deepEqual(result.names, ['apache/maka', 'omacom/omarchy']);
  assert.deepEqual(result.seeds.map((seed) => seed.repoName), [
    'apache/maka',
    'apache/maka',
    'omacom/omarchy',
    'omacom/omarchy',
  ]);
  assert.equal(result.redirectedAliases, 2);
  assert.equal(result.duplicateRepositories, 2);
});

test('同一来源同时出现仓库新旧名称时只保留更高排名', () => {
  const result = canonicalizeTrendingCandidates(
    ['old-owner/project', 'new-owner/project'],
    [enriched(7, 'new-owner/project'), enriched(7, 'new-owner/project')],
    [
      { source: 'same-source', repoName: 'old-owner/project', rank: 3, weight: 1 },
      { source: 'same-source', repoName: 'new-owner/project', rank: 9, weight: 1 },
    ],
  );

  assert.deepEqual(result.seeds, [
    { source: 'same-source', repoName: 'new-owner/project', rank: 3, weight: 1 },
  ]);
});

test('富化结果与请求失去位置对应关系时立即失败', () => {
  assert.throws(
    () => canonicalizeTrendingCandidates(['owner/repo'], [], []),
    /热点富化结果数量不一致/,
  );
});
