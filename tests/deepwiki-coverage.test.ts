import test from 'node:test';
import assert from 'node:assert/strict';
import { deepEvidenceCoverage, EMPTY_FACTS, type DeepwikiFacts } from '@/lib/deepwiki';

function facts(extra: Record<string, unknown> | null): DeepwikiFacts {
  return {
    ...EMPTY_FACTS,
    indexed: true,
    harmony: {
      harmony_paths: [],
      harmony_quote: null,
      harmony_scope: 'none',
      declares_harmony_support: false,
      ohos_imports: [],
    },
    porting: {
      project_type: 'library',
      languages: ['TypeScript'],
      native_code_ratio: 0,
      has_platform_abstraction: false,
      platform_layer_paths: [],
      existing_platform_backends: [],
      portable_core_paths: ['src/'],
      blocking_deps: [],
      platform_apis_used: [],
      conditional_compilation: [],
    },
    extra,
  };
}

test('代码深析至少需要两个核心事实和四个子系统事实', () => {
  assert.equal(deepEvidenceCoverage(facts({ build_system: {}, native_bridge: {}, ui_layer: {} })).complete, false);
  assert.equal(
    deepEvidenceCoverage(facts({ build_system: {}, native_bridge: {}, ui_layer: {}, io_layer: {} })).complete,
    true,
  );
});
