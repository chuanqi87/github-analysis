import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReadme } from '@/lib/llm/prompts';
import { sanitizePostgresJson, sanitizePostgresText } from '@/lib/supabase/json-safety';

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

test('README 截断不会切断 emoji 代理对', () => {
  const prepared = prepareReadme(`${'a'.repeat(1999)}😀tail`, 2000);

  assert.ok(prepared);
  assert.equal(hasUnpairedSurrogate(prepared), false);
  assert.equal(prepared.startsWith('a'.repeat(1999)), true);
  assert.equal(prepared.includes('😀'), false);
});

test('Postgres JSON 清洗替换 NUL 和孤立 surrogate，并保留合法 emoji', () => {
  assert.equal(sanitizePostgresText(`ok\0\ud83d|\udc00|😀`), 'ok��|�|😀');

  const sanitized = sanitizePostgresJson({
    prompt: `before\ud83d`,
    output: { text: `after\0` },
    values: ['😀', 1, null],
  });
  assert.deepEqual(sanitized, {
    prompt: 'before�',
    output: { text: 'after�' },
    values: ['😀', 1, null],
  });
});
