// 诊断/预热:抓取并解析鸿蒙三方库底表,打印命中规模。
import 'dotenv/config';
import { loadRegistry } from '@/lib/harmony/registry';
import { log } from '@/scripts/_common';

export async function runBuildRegistry(): Promise<void> {
  const idx = await loadRegistry();
  log(`底表条目 ${idx.entries.length};归一化库名 ${idx.names.size};仓库 URL ${idx.urls.size}`);
  log(`示例:${idx.entries.slice(0, 5).map((e) => e.name).join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBuildRegistry().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
