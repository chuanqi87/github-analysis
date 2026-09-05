import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSupportAssessment } from '@/lib/harmony/signals';
import {
  isConcreteOpportunity,
  scoreRepositoryOpportunities,
  verdictFromOpportunityScore,
} from '@/lib/scoring/opportunity';
import type { AdaptationPoint } from '@/lib/types';
import type { EvaluateResult } from '@/lib/llm/schema';
import { normalizeEvaluateResult } from '@/lib/llm/evaluate';

const BASE_SUPPORT = {
  ohpmMatched: false,
  upstreamProject: false,
  gitcodeMatched: false,
  gitcodeRepoUrl: null,
  registryMatched: false,
  registrySource: null,
  deepwikiScope: null,
  ohpmChecked: false,
  gitcodeChecked: true,
  deepwikiIndexed: false,
} as const;

test('缺少支持证据时保持 UNKNOWN，不把未发现误写成未适配', () => {
  const result = deriveSupportAssessment(BASE_SUPPORT);
  assert.equal(result.availability, 'UNKNOWN');
  assert.equal(result.confidence, 0.25);
});

test('构建矩阵命中只标记 BUILD_TARGET_ONLY', () => {
  const result = deriveSupportAssessment({
    ...BASE_SUPPORT,
    // 粗粒度文件探测可能同时命中，显式 build_target_only 必须优先。
    upstreamProject: true,
    deepwikiIndexed: true,
    deepwikiScope: 'build_target_only',
    deepwikiPaths: ['packages/binding/targets.ts'],
  });
  assert.equal(result.availability, 'BUILD_TARGET_ONLY');
  assert.equal(result.coverage, 'BUILD_ONLY');
});

test('ohpm 可用产物形成高置信度支持事实', () => {
  const result = deriveSupportAssessment({
    ...BASE_SUPPORT,
    ohpmMatched: true,
    ohpmChecked: true,
    ohpmPackages: [{ pkg: '@ohos/example', repository: null }],
  });
  assert.equal(result.availability, 'USABLE');
  assert.equal(result.provenance, 'OFFICIAL_ECOSYSTEM');
  assert.equal(result.evidence[0]?.reference, '@ohos/example');
});

test('OpenHarmony-SIG 的 Gitee 移植仓形成官方生态可用证据', () => {
  const result = deriveSupportAssessment({
    ...BASE_SUPPORT,
    gitcodeMatched: true,
    gitcodeRepoUrl: 'https://gitee.com/openharmony-sig/ohos_react_native',
  });
  assert.equal(result.availability, 'USABLE');
  assert.equal(result.provenance, 'OFFICIAL_ECOSYSTEM');
  assert.equal(result.coverage, 'UNKNOWN');
  assert.equal(result.evidence[0]?.source, 'gitee');
});

function opportunity(overrides: Partial<AdaptationPoint> = {}): AdaptationPoint {
  return {
    area: '平台后端',
    description: '为现有渲染抽象增加 HarmonyOS 后端',
    difficulty: 'medium',
    harmony_value: '补齐鸿蒙端侧渲染能力',
    project_assets: 'src/platform/ 中已有 Android 与 iOS 后端',
    uncovered_scope: '现有支持未包含 HarmonyOS 渲染后端',
    implementation_outline: '复用平台接口并实现 HarmonyOS surface 绑定',
    integration_form: 'platform_backend',
    target_devices: ['手机', '平板'],
    target_kits: ['ArkUI'],
    ecosystem_need: 0.9,
    project_advantage: 0.85,
    user_reach: 0.8,
    upstream_fit: 0.8,
    confidence: 0.9,
    evidence_refs: ['src/platform/android/backend.cc', 'src/platform/ios/backend.mm'],
    validation_questions: [],
    ...overrides,
  };
}

test('只有项目资产、未覆盖范围和证据齐全的机会才能进入排名', () => {
  assert.equal(isConcreteOpportunity(opportunity()), true);
  assert.equal(isConcreteOpportunity(opportunity({ evidence_refs: [] })), false);
  assert.equal(isConcreteOpportunity(opportunity({ uncovered_scope: '' })), false);
});

test('项目按最佳机会排序，不能靠堆砌低价值条目抬分', () => {
  const strong = opportunity();
  const weak = opportunity({
    area: '工程化',
    difficulty: 'low',
    ecosystem_need: 0.2,
    project_advantage: 0.2,
    user_reach: 0.2,
    upstream_fit: 0.3,
    confidence: 0.6,
  });
  const one = scoreRepositoryOpportunities([strong]);
  const withSecond = scoreRepositoryOpportunities([strong, weak]);
  assert.ok(one >= 65);
  assert.ok(withSecond > one);
  assert.ok(withSecond - one < 3);
  assert.equal(verdictFromOpportunityScore(0, true), 'NO_CLEAR_OPPORTUNITY');
});

test('已有可用移植仓但覆盖未知时，强制先核验而不是直接投资', () => {
  const result = {
    opportunities: [opportunity()],
    analysis_details: {
      architecture: { core_modules: [], runtime_and_platform_boundary: '', extension_points: [], evidence_refs: [] },
      porting: { reusable_core: [], required_changes: [], blocking_dependencies: [], build_and_test_strategy: '' },
      ecosystem: { target_users_and_scenarios: [], existing_alternatives: [], differentiated_value: '', adoption_and_maintenance_path: '' },
      decision: { recommendation: 'INVEST', why_now: '', prerequisites: [], kill_criteria: [] },
      historical_reuse: [],
      rejected_options: [],
    },
    ecosystem_gap: 0.9,
    harmony_leverage: 0.9,
    recommended_approach: '实施',
  } as unknown as EvaluateResult;
  const normalized = normalizeEvaluateResult(result, true, {
    support_availability: 'USABLE',
    support_coverage: 'UNKNOWN',
  });
  assert.equal(normalized.analysis_details.decision.recommendation, 'VALIDATE_FIRST');
  assert.equal(normalized.opportunities[0]?.confidence, 0.55);
  assert.equal(normalized.opportunities[0]?.ecosystem_need, 0.6);
});
