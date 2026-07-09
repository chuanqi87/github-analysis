// 迁移执行器:应用 supabase/migrations/*.sql 并触发 PostgREST 重载。
// 二选一鉴权(.env):
//   A. SUPABASE_DB_URL      —— 直连 Postgres(Settings → Database → Session pooler,需数据库密码)
//   B. SUPABASE_ACCESS_TOKEN —— Management API(account/tokens 生成的 sbp_ 令牌,无需数据库密码)
// 运行:pnpm db:migrate
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Executor {
  run(query: string): Promise<Record<string, unknown>[]>;
  end(): Promise<void>;
}

async function directExecutor(url: string): Promise<Executor> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { ssl: 'require', prepare: false, max: 1 });
  return {
    run: (q) => sql.unsafe(q) as unknown as Promise<Record<string, unknown>[]>,
    end: () => sql.end(),
  };
}

function managementExecutor(token: string, ref: string): Executor {
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;
  return {
    async run(query: string) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()) as Record<string, unknown>[];
    },
    async end() {},
  };
}

function projectRef(): string | null {
  const u = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!u) return null;
  try {
    return new URL(u).hostname.split('.')[0];
  } catch {
    return null;
  }
}

async function pickExecutor(): Promise<Executor> {
  if (process.env.SUPABASE_DB_URL) {
    console.log('鉴权方式:直连 Postgres(SUPABASE_DB_URL)');
    return directExecutor(process.env.SUPABASE_DB_URL);
  }
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    const ref = projectRef();
    if (!ref) throw new Error('无法从 SUPABASE_URL 解析项目 ref');
    console.log(`鉴权方式:Management API(项目 ${ref})`);
    return managementExecutor(process.env.SUPABASE_ACCESS_TOKEN, ref);
  }
  throw new Error(
    '缺少鉴权:请在 .env 配置 SUPABASE_DB_URL(直连)或 SUPABASE_ACCESS_TOKEN(Management API)其一。',
  );
}

async function listTables(exec: Executor): Promise<string[]> {
  const rows = await exec.run(`select tablename from pg_tables where schemaname='public' order by 1`);
  return rows.map((r) => String(r.tablename));
}

async function main() {
  const exec = await pickExecutor();
  try {
    const before = await listTables(exec);
    console.log(`迁移前 public 表(${before.length}):`, before.join(', ') || '(空)');

    const dir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      process.stdout.write(`应用 ${f} ... `);
      await exec.run(readFileSync(join(dir, f), 'utf8'));
      console.log('OK');
    }

    console.log("触发 PostgREST 重载(notify pgrst 'reload schema')...");
    await exec.run(`notify pgrst, 'reload schema';`);

    const after = await listTables(exec);
    console.log(`迁移后 public 表(${after.length}):`, after.join(', ') || '(空)');
    console.log('完成 ✅ 等几秒让 Data API 缓存刷新,再跑 pnpm check 验证。');
  } finally {
    await exec.end();
  }
}

main().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
