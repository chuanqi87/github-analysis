// 配置校验 + 连通性测试(密钥脱敏,不回显明文)。
// 运行:pnpm tsx scripts/check-config.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function mask(s?: string | null): string {
  if (!s) return '(缺失)';
  if (s.length <= 10) return `***(len ${s.length})`;
  return `${s.slice(0, 8)}…${s.slice(-4)} (len ${s.length})`;
}

function keyKind(s?: string | null): string {
  if (!s) return '缺失';
  if (s.startsWith('sb_publishable_')) return 'publishable(=anon,公开只读)';
  if (s.startsWith('sb_secret_')) return 'secret(=service role,可写)';
  if (s.startsWith('eyJ')) return 'legacy JWT(看 role 声明)';
  return '未知格式';
}

const line = (ok: boolean, label: string, detail: string) =>
  console.log(`${ok ? '✅' : '❌'} ${label}: ${detail}`);

async function checkSupabaseRead() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  console.log('\n── Supabase 前端(anon 读)──');
  console.log(`  URL: ${url ?? '(缺失)'}`);
  console.log(`  ANON_KEY: ${mask(anon)} — 类型:${keyKind(anon)}`);
  if (!url || !anon) return line(false, 'anon 连接', '缺少 URL 或 ANON_KEY');
  try {
    const sb = createClient(url, anon);
    const { error, count } = await sb.from('repositories').select('*', { count: 'exact', head: true });
    if (error) {
      if (/PGRST205|schema cache/i.test(error.message)) {
        return line(false, 'anon 读 repositories', `PostgREST 缓存无此表 → 重跑 migrations 或执行 NOTIFY pgrst,'reload schema'(${error.message})`);
      }
      if (/relation|does not exist|Could not find the table/i.test(error.message)) {
        return line(false, 'anon 读 repositories', `表不存在 → 还没跑 migrations(${error.message})`);
      }
      return line(false, 'anon 读 repositories', error.message);
    }
    line(true, 'anon 读 repositories', `成功,当前行数 ≈ ${count ?? 0}`);
  } catch (e) {
    line(false, 'anon 连接', String(e));
  }
}

async function checkSupabaseWrite() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log('\n── Supabase 管道(service role 写)──');
  console.log(`  URL: ${url ?? '(缺失)'}`);
  console.log(`  SERVICE_ROLE_KEY: ${mask(key)} — 类型:${keyKind(key)}`);
  if (key?.startsWith('sb_publishable_')) {
    return line(false, 'service role 写', '这是 publishable(anon)key,不是 service role,管道无法写库');
  }
  if (!url || !key) return line(false, 'service role 写', '缺少 URL 或 SERVICE_ROLE_KEY');
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from('pipeline_runs')
      .insert({ stage: 'config-check', status: 'success' })
      .select('id')
      .single();
    if (error) {
      if (/row-level security|violates/i.test(error.message)) {
        return line(false, 'service role 写', `被 RLS 拒绝 → 该 key 不是 service role(${error.message})`);
      }
      if (/PGRST205|schema cache/i.test(error.message)) {
        return line(false, 'service role 写', `PostgREST 缓存无此表 → 重跑 migrations 或执行 NOTIFY pgrst,'reload schema'(${error.message})`);
      }
      if (/relation|does not exist|Could not find the table/i.test(error.message)) {
        return line(false, 'service role 写', `表不存在 → 还没跑 migrations(${error.message})`);
      }
      return line(false, 'service role 写', error.message);
    }
    await sb.from('pipeline_runs').delete().eq('id', (data as { id: number }).id);
    line(true, 'service role 写', '成功(可写库,已清理测试行)');
  } catch (e) {
    line(false, 'service role 写', String(e));
  }
}

async function dashscopeCall(base: string, model: string, key: string) {
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '回复一个字:好' }],
      max_tokens: 5,
    }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function checkDashscope() {
  const key = process.env.DASHSCOPE_API_KEY;
  const base = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.DASHSCOPE_MODEL ?? 'qwen-plus';
  console.log('\n── 阿里百炼 / DashScope ──');
  console.log(`  API_KEY: ${mask(key)}`);
  console.log(`  BASE_URL: ${base}`);
  console.log(`  MODEL: ${model}`);
  if (base.includes('anthropic')) {
    console.log('  ⚠️ 当前 BASE_URL 是 Anthropic 兼容端点;本项目用 OpenAI SDK,需要 compatible-mode 端点');
  }
  if (!key || key.startsWith('YOUR-')) return line(false, '百炼调用', 'API_KEY 未填');
  if (!base.includes('compatible-mode')) {
    console.log('  ⚠️ 本项目用 OpenAI SDK,BASE_URL 建议为 .../compatible-mode/v1');
  }

  let ok = false;
  try {
    const r = await dashscopeCall(base, model, key);
    ok = r.status === 200;
    if (ok) line(true, `百炼调用(${model})`, '成功');
    else line(false, `百炼调用(${base}, ${model})`, `HTTP ${r.status} ${r.text.slice(0, 200)}`);
  } catch (e) {
    line(false, '百炼调用', String(e));
  }

  // 仅在失败时探测账号可用模型,给出建议。
  if (!ok) {
    try {
      const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 200) {
        const json = (await res.json()) as { data: { id: string }[] };
        const qwen = json.data.map((d) => d.id).filter((id) => /qwen/i.test(id)).slice(0, 15);
        console.log(`  👉 该 key 可见的 qwen 模型(部分):${qwen.join(', ') || '(无)'}`);
      }
    } catch {
      /* ignore */
    }
  }
}

async function checkGithub() {
  const token = process.env.GITHUB_TOKEN;
  console.log('\n── GitHub Token ──');
  console.log(`  GITHUB_TOKEN: ${mask(token)}`);
  if (!token || token.startsWith('YOUR-')) {
    return line(false, 'GitHub token', '未填(本地抓取会受未认证低配额限制;Actions 里会用 github.token)');
  }
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'config-check' },
    });
    if (res.status !== 200) return line(false, 'GitHub token', `HTTP ${res.status}`);
    const json = (await res.json()) as { resources: { core: { limit: number }; search: { limit: number } } };
    line(true, 'GitHub token', `有效,core=${json.resources.core.limit}/h search=${json.resources.search.limit}/min`);
  } catch (e) {
    line(false, 'GitHub token', String(e));
  }
}

async function main() {
  console.log('=== 配置校验 + 连通性测试 ===');
  await checkSupabaseRead();
  await checkSupabaseWrite();
  await checkDashscope();
  await checkGithub();
  console.log('\n其它:');
  console.log(`  NEXT_PUBLIC_ADMIN_EMAIL = ${process.env.NEXT_PUBLIC_ADMIN_EMAIL || '(未填)'}`);
  console.log(`  NEXT_PUBLIC_BASE_PATH = ${process.env.NEXT_PUBLIC_BASE_PATH || '(空,本地/自定义域名 OK)'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
