import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRepositories, parseGitHubRepository } from '@/lib/github/repository-ref';

test('解析标准 GitHub 仓库地址并移除查询参数和 .git 后缀', () => {
  assert.deepEqual(parseGitHubRepository('https://github.com/facebook/react.git?tab=readme'), {
    owner: 'facebook',
    name: 'react',
    fullName: 'facebook/react',
    url: 'https://github.com/facebook/react',
  });
});

test('兼容 owner/name 简写并去重', () => {
  const repositories = parseGitHubRepositories('facebook/react, FACEBOOK/react vuejs/core');
  assert.deepEqual(repositories.map((repo) => repo.fullName), ['facebook/react', 'vuejs/core']);
});

test('拒绝非 GitHub 地址和仓库子页面', () => {
  assert.throws(() => parseGitHubRepository('https://gitlab.com/facebook/react'), /仅支持 github\.com/);
  assert.throws(() => parseGitHubRepository('https://github.com/facebook/react/issues'), /仓库首页地址/);
});
