import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findHarmonyPort,
  harmonyPortSource,
  isTrustedHarmonyPortOrg,
} from '@/lib/harmony/ports';

test('React Native 新旧上游名称都映射到 OpenHarmony-SIG 的实际移植仓', async () => {
  for (const upstream of ['react/react-native', 'facebook/react-native']) {
    const result = await findHarmonyPort(upstream, 'react-native');
    assert.equal(result.repo_url, 'https://gitee.com/openharmony-sig/ohos_react_native');
    assert.equal(result.source, 'gitee');
    assert.equal(result.trusted, true);
  }
});

test('官方组织信任判断同时覆盖 Gitee 与 GitCode，但不信任个人仓', () => {
  assert.equal(isTrustedHarmonyPortOrg('https://gitee.com/openharmony-sig/example'), true);
  assert.equal(isTrustedHarmonyPortOrg('https://gitcode.com/openharmony-tpc/example'), true);
  assert.equal(isTrustedHarmonyPortOrg('https://gitee.com/random-user/example'), false);
  assert.equal(harmonyPortSource('https://gitee.com/openharmony-sig/example'), 'gitee');
});
