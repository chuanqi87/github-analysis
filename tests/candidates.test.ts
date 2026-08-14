import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCandidateScores, deriveCandidateState } from '@/lib/pipeline/candidates';

test('热点和多源证据能让新项目优先于静态高星项目', () => {
  const hot = deriveCandidateScores({
    stars: 800,
    pushedAt: new Date().toISOString(),
    hotScore: 0.9,
    sourceCount: 3,
  });
  const legacy = deriveCandidateScores({
    stars: 100_000,
    pushedAt: '2020-01-01T00:00:00.000Z',
    hotScore: 0,
    sourceCount: 0,
  });
  assert.ok(hot.discoveryScore > legacy.discoveryScore);
});

test('正常项目沿漏斗前进，完成 tier-3 后进入监控', () => {
  assert.equal(deriveCandidateState({ archived: false, tier: 0, changedAfterAnalysis: false, hot: false }), 'discovered');
  assert.equal(deriveCandidateState({ archived: false, tier: 1, changedAfterAnalysis: false, hot: false }), 'preliminary');
  assert.equal(deriveCandidateState({ archived: false, tier: 2, changedAfterAnalysis: false, hot: false }), 'deep');
  assert.equal(deriveCandidateState({ archived: false, tier: 3, changedAfterAnalysis: false, hot: false }), 'monitoring');
});

test('只有仍是热点且代码变化的已分析项目会重新入池', () => {
  assert.equal(deriveCandidateState({ archived: false, tier: 3, changedAfterAnalysis: true, hot: true }), 'deep');
  assert.equal(deriveCandidateState({ archived: false, tier: 3, changedAfterAnalysis: true, hot: false }), 'monitoring');
  assert.equal(deriveCandidateState({ archived: true, tier: 0, changedAfterAnalysis: true, hot: true }), 'excluded');
});
