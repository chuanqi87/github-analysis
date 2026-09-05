import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHistoricalAnalysisContext,
  selectHistoricalReferences,
  type HistoricalAnalysisReference,
} from '@/lib/llm/history-context';

function reference(overrides: Partial<HistoricalAnalysisReference>): HistoricalAnalysisReference {
  return {
    repository_id: 2,
    full_name: 'acme/sibling',
    owner: 'acme',
    primary_language: 'TypeScript',
    topics: ['cross-platform', 'ui'],
    tier: 3,
    model: 'qwen3.8-max',
    prompt_version: 'p11-deep-q8',
    category: 'cross_platform',
    subcategory: 'ui_framework',
    project_summary_cn: '相似项目',
    opportunity_verdict: 'PROMISING',
    opportunity_score: 70,
    opportunities: [],
    recommended_approach: null,
    reasoning_excerpt: null,
    decision: null,
    analyzed_at: '2026-09-04T00:00:00Z',
    ...overrides,
  };
}

const TARGET = {
  id: 1,
  owner: 'acme',
  full_name: 'acme/current',
  primary_language: 'TypeScript',
  topics: ['cross-platform', 'rendering'],
};

test('历史上下文优先同组织，并排除当前仓库自身', () => {
  const selected = selectHistoricalReferences(TARGET, [
    reference({ repository_id: 1, full_name: 'acme/current' }),
    reference({ repository_id: 2, full_name: 'acme/sibling' }),
    reference({ repository_id: 3, full_name: 'other/close', owner: 'other', topics: ['cross-platform', 'rendering'] }),
  ]);
  assert.deepEqual(selected.map((item) => item.full_name), ['acme/sibling', 'other/close']);
});

test('只有相同语言但主题无交集的项目不会污染历史先验', () => {
  const selected = selectHistoricalReferences(TARGET, [
    reference({ repository_id: 4, full_name: 'other/unrelated', owner: 'other', topics: ['database'] }),
  ]);
  assert.equal(selected.length, 0);
});

test('历史上下文不向当前仓库泄露来源仓路径和长推理', () => {
  const formatted = formatHistoricalAnalysisContext([
    reference({
      opportunities: [{
        area: '平台后端',
        description: '修改来源仓实现',
        difficulty: 'high',
        harmony_value: '复用跨端模式',
        project_assets: 'scripts/cxx-api/config.yml',
        evidence_refs: ['scripts/cxx-api/config.yml'],
        target_devices: ['手机'],
        integration_form: 'platform_backend',
      }],
      reasoning_excerpt: '来源仓长推理 scripts/cxx-api/config.yml',
    }),
  ]);
  assert.match(formatted, /reusable_patterns_only/);
  assert.doesNotMatch(formatted, /scripts\/cxx-api\/config\.yml/);
  assert.doesNotMatch(formatted, /来源仓长推理/);
});
