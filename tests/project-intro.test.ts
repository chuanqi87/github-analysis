import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIntro, extractFromReasoning, hasCjk } from '@/lib/project-intro';

test('优先使用 LLM 中文简介', () => {
  const intro = buildProjectIntro({
    name: 'next.js',
    description: 'The React Framework',
    project_summary_cn: 'Next.js 是一个用于构建全栈 Web 应用的 React 框架。',
  });
  assert.equal(intro.summary, 'Next.js 是一个用于构建全栈 Web 应用的 React 框架。');
  assert.equal(intro.original, 'The React Framework');
});

test('GitHub 描述本身是中文时直接采用', () => {
  const intro = buildProjectIntro({
    name: 'hutool',
    description: '小而全的 Java 工具类库',
    category_name: '通用工具库',
  });
  assert.equal(intro.summary, '小而全的 Java 工具类库');
  assert.equal(intro.original, undefined);
});

test('能从评估理由抽出项目是什么', () => {
  const reasoning =
    '①技术栈与平台耦合点：SQLite 是嵌入式关系型数据库引擎，核心在 C 实现的 VFS 层。②适配现状：未发现鸿蒙移植。③推荐路径：新增 os_ohos.c。';
  assert.match(extractFromReasoning(reasoning) ?? '', /嵌入式关系型数据库/);
  const intro = buildProjectIntro({
    name: 'sqlite',
    description: 'Official Git mirror of the SQLite source tree',
    reasoning,
  });
  assert.match(intro.summary, /嵌入式关系型数据库/);
  assert.equal(intro.original, 'Official Git mirror of the SQLite source tree');
});

test('没有中文材料时用分类兜底,不丢原描述', () => {
  const intro = buildProjectIntro({
    name: 'react',
    description: 'A JavaScript library for building user interfaces',
    category_name: 'UI 框架',
    subcategory_name: '声明式 UI',
    primary_language: 'JavaScript',
    deepwiki_project_type: 'library',
  });
  assert.equal(intro.summary, 'react 是一个「UI 框架 / 声明式 UI」库，主要使用 JavaScript。');
  assert.equal(intro.original, 'A JavaScript library for building user interfaces');
});

test('hasCjk 能区分中英文', () => {
  assert.equal(hasCjk('hello world'), false);
  assert.equal(hasCjk('构建用户界面'), true);
});
