import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { assertAnalysisSchema } from '@/lib/pipeline/schema-check';

function mockClient(failure?: { table: string; code: string; message: string; status?: number }) {
  const requests: { table: string; method: string; columns: string | null; limit: string | null }[] = [];
  const client = createClient('https://schema-check.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').at(-1)!;
        requests.push({
          table,
          method: init?.method ?? 'GET',
          columns: url.searchParams.get('select'),
          limit: url.searchParams.get('limit'),
        });
        const failed = table === failure?.table;
        return new Response(JSON.stringify(failed ? { code: failure.code, message: failure.message } : []), {
          status: failed ? failure.status ?? 400 : 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return { client, requests };
}

test('预检查只读校验双轨分析字段，空表也能通过', async () => {
  const { client, requests } = mockClient();
  await assertAnalysisSchema(client);
  assert.deepEqual(requests, [
    { table: 'analysis', method: 'GET', columns: 'project_summary_cn,opportunity_verdict,opportunity_score,analysis_details', limit: '0' },
    { table: 'harmony_signals', method: 'GET', columns: 'support_availability,support_provenance,support_coverage', limit: '0' },
    { table: 'repo_board', method: 'GET', columns: 'project_summary_cn,opportunity_verdict,opportunity_score,analysis_details,support_availability', limit: '0' },
  ]);
});

test('缺少 analysis 字段立即阻断并提示对应迁移', async () => {
  const { client, requests } = mockClient({
    table: 'analysis', code: '42703', message: 'column analysis.project_summary_cn does not exist',
  });
  await assert.rejects(assertAnalysisSchema(client), /analysis\(project_summary_cn,opportunity_verdict,opportunity_score,analysis_details\).*support_and_opportunities\.sql/);
  assert.equal(requests.length, 1);
});

test('表字段已存在但看板视图未迁移时仍然阻断', async () => {
  const { client } = mockClient({
    table: 'repo_board', code: '42703', message: 'column repo_board.project_summary_cn does not exist',
  });
  await assert.rejects(assertAnalysisSchema(client), /repo_board\(project_summary_cn,opportunity_verdict,opportunity_score,analysis_details,support_availability\).*support_and_opportunities\.sql/);
});

test('schema cache 未更新时给出刷新提示', async () => {
  const { client } = mockClient({
    table: 'analysis', code: 'PGRST204', message: 'Could not find column in the schema cache',
  });
  await assert.rejects(assertAnalysisSchema(client), /刷新 PostgREST schema cache/);
});

test('鉴权失败也阻断，但不误报成缺少迁移', async () => {
  const { client } = mockClient({
    table: 'analysis', code: '42501', message: 'permission denied', status: 403,
  });
  await assert.rejects(assertAnalysisSchema(client), (error: Error) => {
    assert.match(error.message, /连接、凭据和权限/);
    assert.doesNotMatch(error.message, /support_and_opportunities/);
    return true;
  });
});
