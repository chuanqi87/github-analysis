import 'dotenv/config';
import { appendFile } from 'node:fs/promises';
import { registerGitHubRepositories } from '@/lib/github/register';
import { parseGitHubRepositories } from '@/lib/github/repository-ref';

async function writeGitHubOutput(ids: number[], fullNames: string[]): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(
    outputPath,
    `repo_ids=${ids.join(',')}\nregistered_repos=${fullNames.join(',')}\n`,
    'utf8',
  );
}

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ').trim();
  const repositories = parseGitHubRepositories(input);
  const registered = await registerGitHubRepositories(repositories);
  await writeGitHubOutput(
    registered.map((repo) => repo.id),
    registered.map((repo) => repo.fullName),
  );
  console.log(`已登记 ${registered.length} 个仓库：${registered.map((repo) => `${repo.fullName} (#${repo.id})`).join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
