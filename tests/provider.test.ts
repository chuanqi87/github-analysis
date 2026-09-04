import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSIFY_MODEL_NAME,
  EVALUATE_MODEL_NAME,
  applyDashscopeModelOptions,
} from '@/lib/llm/provider';

test('默认分类和深评都使用 qwen3.8-max', () => {
  assert.equal(CLASSIFY_MODEL_NAME, process.env.DASHSCOPE_MODEL ?? 'qwen3.8-max');
  assert.equal(EVALUATE_MODEL_NAME, process.env.DASHSCOPE_MODEL_DEEP ?? 'qwen3.8-max');
});

test('qwen3.8-max 保留思考能力并可设置推理强度', () => {
  assert.deepEqual(
    applyDashscopeModelOptions({ model: 'qwen3.8-max', messages: [] }, 'xhigh'),
    { model: 'qwen3.8-max', messages: [], enable_thinking: true, reasoning_effort: 'xhigh' },
  );
});

test('旧模型继续关闭思考以保持 JSON 管道兼容', () => {
  assert.equal(applyDashscopeModelOptions({ model: 'qwen-plus' }).enable_thinking, false);
});
