import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistoricalReferences, type HistoricalAnalysisReference } from '@/lib/llm/history-context';

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
