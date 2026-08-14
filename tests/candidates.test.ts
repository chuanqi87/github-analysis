import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCandidateScores, deriveCandidateState, TIER3_MIN_SCORE } from '@/lib/pipeline/candidates';

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

test('鸿蒙专属增量高的项目优先于仅仅容易接入的通用库', () => {
  const generic = deriveCandidateScores({
    stars: 100_000,
    pushedAt: new Date().toISOString(),
    hotScore: 0,
    sourceCount: 0,
    mobileRelevance: 0.5,
    feasibility: 0.98,
    ecosystemGap: 0.3,
    harmonyLeverage: 0.15,
    confidence: 0.95,
  });
  const harmonyBackend = deriveCandidateScores({
    stars: 10_000,
    pushedAt: new Date().toISOString(),
    hotScore: 0,
    sourceCount: 0,
    mobileRelevance: 0.85,
    feasibility: 0.55,
    ecosystemGap: 0.75,
    harmonyLeverage: 0.9,
    confidence: 0.85,
  });
  assert.ok(harmonyBackend.deepScore > generic.deepScore);
  assert.ok(harmonyBackend.deepScore >= TIER3_MIN_SCORE);
  assert.ok(generic.deepScore < TIER3_MIN_SCORE);
});
