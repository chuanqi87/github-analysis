// 管道端 Supabase 客户端(service_role key,绕过 RLS 批量写)。
// 仅在 GitHub Actions / 本地脚本中使用,绝不打包进前端。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY,管道无法写库。请在 .env 或 Actions Secrets 配置。',
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** 分批 upsert,避免单请求体过大。 */
export async function upsertBatched<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  opts: { onConflict?: string; chunkSize?: number } = {},
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = opts.chunkSize ?? 500;
  const client = getAdminClient();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client
      .from(table)
      .upsert(chunk as never, opts.onConflict ? { onConflict: opts.onConflict } : undefined);
    if (error) {
      throw new Error(`upsert ${table} 失败(第 ${i / chunkSize + 1} 批):${error.message}`);
    }
  }
}
