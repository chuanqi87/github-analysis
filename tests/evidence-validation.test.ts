import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentEvidenceReference } from '@/lib/llm/evidence';

const CURRENT_CORPUS = `
reactcommon/react/renderer/core/shadownode.cpp
packages/react-native/react-native.config.js
https://gitee.com/openharmony-sig/ohos_react_native
`.toLowerCase();

test('当前材料中逐字出现的路径和 URL 可以作为证据', () => {
  assert.equal(
    isCurrentEvidenceReference('ReactCommon/react/renderer/core/ShadowNode.cpp', CURRENT_CORPUS),
    true,
  );
  assert.equal(
    isCurrentEvidenceReference('https://gitee.com/openharmony-sig/ohos_react_native', CURRENT_CORPUS),
    true,
  );
});

test('历史仓路径和标为推断的路径不能混入当前仓库证据', () => {
  assert.equal(isCurrentEvidenceReference('scripts/cxx-api/config.yml', CURRENT_CORPUS), false);
  assert.equal(
    isCurrentEvidenceReference('推断路径: ReactCommon/platform/ohos/backend.cpp', CURRENT_CORPUS),
    false,
  );
});
