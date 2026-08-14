export interface GitHubRepositoryRef {
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPOSITORY_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

function invalidRepository(value: string, reason: string): never {
  throw new Error(`无效的 GitHub 仓库“${value}”：${reason}`);
}

/**
 * 解析 GitHub 仓库首页地址或 owner/name 简写，并返回可安全传给工作流的规范格式。
 */
export function parseGitHubRepository(value: string): GitHubRepositoryRef {
  const input = value.trim();
  if (!input) invalidRepository(value, '请输入仓库地址');

  let path = input;
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      invalidRepository(value, '地址格式不正确');
    }
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
      invalidRepository(value, '仅支持 github.com');
    }
    path = url.pathname;
  } else if (input.includes('://') || input.startsWith('git@')) {
    invalidRepository(value, '请使用 GitHub HTTPS 地址或 owner/name');
  }

  const parts = path.split('/').filter(Boolean);
  if (parts.length !== 2) {
    invalidRepository(value, '应为仓库首页地址，例如 https://github.com/facebook/react');
  }

  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  if (!OWNER_PATTERN.test(owner)) invalidRepository(value, 'owner 格式不正确');
  if (!REPOSITORY_PATTERN.test(name) || name === '.' || name === '..') {
    invalidRepository(value, '仓库名格式不正确');
  }

  const fullName = `${owner}/${name}`;
  return { owner, name, fullName, url: `https://github.com/${fullName}` };
}

/** 解析逗号或空白分隔的仓库列表，并按 GitHub 大小写不敏感语义去重。 */
export function parseGitHubRepositories(value: string): GitHubRepositoryRef[] {
  const inputs = value.split(/[,\s]+/).filter(Boolean);
  if (!inputs.length) invalidRepository(value, '请输入至少一个仓库');

  const unique = new Map<string, GitHubRepositoryRef>();
  for (const input of inputs) {
    const repository = parseGitHubRepository(input);
    const key = repository.fullName.toLowerCase();
    if (!unique.has(key)) unique.set(key, repository);
  }
  return [...unique.values()];
}
