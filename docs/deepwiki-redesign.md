# 引入 DeepWiki 重构鸿蒙化分析管道

> 状态:设计稿 · 目标分支 `claude/harmonyos-feasibility-redesign-ud2ciz`

## 1. 背景与动机

当前项目判断一个仓库「能不能鸿蒙化」,靠的是三类输入:

| 层 | 来源 | 问题 |
|---|---|---|
| 元数据 | GitHub API(star/language/topics) | 与「能否移植」几乎无关 |
| README | `04-fetch-readme` 截断后喂 LLM | README 讲的是**项目做什么**,不是**代码长什么样** |
| 鸿蒙信号 | ohpm / GitCode / registry / 关键词 | 只能发现**已经**鸿蒙化的,发现不了「移植难度」 |
| tier-3 | `scripts/agent/` Python Agent 下载 tarball 后阅读 | 慢、贵、只能采样(30 轮),且与 TS 管道割裂 |

核心矛盾:**判断可移植性需要读代码,但读代码很贵。**
tier-1/tier-2 实际上是在「靠 README 猜代码结构」,tier-3 能读代码但成本高到只能覆盖极少数仓库。

DeepWiki(Devin/Cognition 出品)已经把 GitHub 上绝大多数高星仓库**全量索引**并生成了结构化文档,且开放了免登录免费的 MCP 接口。这正好补上我们最贵的那一环。

## 2. 可行性验证(已实测)

对 `https://mcp.deepwiki.com/mcp` 做了实测,结论如下。

### 2.1 接口形态

无鉴权、无 session,直接 POST JSON-RPC,响应是 SSE 帧(`data: {...}`)。三个工具:

| 工具 | 入参 | 实测耗时 | 实测体积 |
|---|---|---|---|
| `read_wiki_structure` | `repoName` | ~0.8s | ~2 KB |
| `read_wiki_contents` | `repoName` | ~1s | **685 KB**(小项目 `sindresorhus/ky`) |
| `ask_question` | `repoName`(支持数组,≤10)、`question` | 7~14s | 5~9 KB |

> ⚠️ `read_wiki_contents` 体积失控,**不可直接喂 LLM**。设计上只用 `read_wiki_structure`(廉价目录)+ `ask_question`(定向提问)。

### 2.2 索引覆盖率

抽样 16 个高星仓库:**16/16 命中**。
初测有 2 个 MISS(`ggerganov/llama.cpp`、`koush/scrcpy`),原因是仓库改名后 owner 变了;用规范名(`ggml-org/llama.cpp`、`Genymobile/scrcpy`)重试全部命中。

→ 我们的 `repositories.full_name` 来自 GitHub API,本来就是规范名,覆盖率可视为接近 100%。
未索引时返回明确文案 `Repository not found. Visit https://deepwiki.com/{repo} to index it.`,可稳定识别并降级。

### 2.3 回答质量 —— 关键发现

以「鸿蒙移植面」为题做结构化提问,实测:

**证据类字段(文件路径 / 代码引文 / 依赖名)极其可靠。**
`Tencent/MMKV` 一次提问(7.3s)就精准定位了它已有的 OpenHarmony 实现:

```
OpenHarmony/MMKV/src/main/ets/utils/MMKV.ets
OpenHarmony/MMKV/src/main/cpp/native_bridge.cpp
OpenHarmony/MMKV/oh-package.json5
OpenHarmony/build-profile.json5
```

这正是 tier-3 Python Agent 花「下载 tarball + 30 轮 qwen3-max」才能得到的东西。

**判断类字段(枚举 / 难度分级)不可靠。** 三个反例:

1. `vercel/next.js` 报 `has_harmony_code: true, effort: low`,依据是 rspack binding 里一句 `process.platform === 'openharmony'` ——引文**是真的**,但把它判成「已鸿蒙化」是严重高估。
2. `sqlite/sqlite` 报 `platform_abstraction: "none"` —— 错得离谱,SQLite 的 VFS(`os_unix.c`/`os_win.c`)是教科书级平台抽象层。
3. `flutter/flutter` 返回了 schema 之外的枚举值 `"not_applicable"`(我只允许 `none|partial|strong`)。

**输出格式不稳定**:有时裹 ```json 围栏有时不裹;结尾总会附加 `Wiki pages you might want to explore:` 和一条 search URL。

### 2.4 由此推导出的设计原则

> **DeepWiki 负责「事实」,我们的 LLM 负责「判断」,人工标记依然是「权威」。**

这与项目现有哲学(`harmony_overrides` 覆盖一切自动判断)完全同构,只是在自动侧多插了一层更硬的证据。绝不能让 DeepWiki 的枚举结论直接写进 `harmony_suggestion`。

## 3. 目标架构

```
                    ┌─ GitHub API ────── 元数据
                    ├─ README ────────── 项目意图
证据层(facts)  ────┼─ ohpm/GitCode ──── 已鸿蒙化的产物证据
                    └─ DeepWiki ──────── 代码结构 / 平台抽象层 / 阻塞依赖  ★新增
                             │
判断层(scores) ─────────── qwen tier-1/tier-2/tier-3(打分、定级、给路径)
                             │
权威层(truth)  ─────────── harmony_overrides(人工标记)
```

## 4. 详细设计

### 4.1 新增 `lib/deepwiki/`

```
lib/deepwiki/
  client.ts      # MCP JSON-RPC over HTTP + SSE 帧解析(~60 行,不引 SDK)
  questions.ts   # 提问模板 + QUESTION_VERSION
  parse.ts       # 去围栏 / 去尾部推荐 / 宽松 JSON 解析 / 枚举归一化
  index.ts       # collectDeepwiki(repo) → DeepwikiFacts
```

**`client.ts`** —— 实测无需 `initialize` 握手即可直接 `tools/call`,是无状态的。要点:
- POST 时 `Accept: application/json, text/event-stream`,逐行取 `data: ` 后 JSON.parse,读 `result.structuredContent.result`。
- 「未索引」返回的是**正常响应**(`isError: false`),靠文案 `Repository not found` 判定,不能靠 HTTP 状态码。
- 复用 `lib/ratelimit/limiter.ts` 模式新增 `deepwikiLimiter`(Bottleneck,`maxConcurrent: 5`)与 `withRetry`。实测 16 并发无异常,但官方未公布限额,保守取 5。
- 硬超时 60s(`ask_question` 实测 7~14s)。

**`parse.ts`** —— 针对 2.3 的三个坑:
- 剥离 ```json 围栏;截断 `Wiki pages you might want to explore:` 及其后内容。
- zod `safeParse` + 枚举 `catch()` 兜底,非法值(如 `not_applicable`)归一到 `null` 而非整条丢弃。
- 解析失败保留 `raw_answers`,不阻塞管道。

### 4.2 新增管道阶段 `04b-deepwiki.ts`

放在 `04-fetch-readme` 之后、`05-llm-classify` 之前(命名用 `04b` 而非重编号,避免大面积改动既有文件)。照 CLAUDE.md 约定:导出 `runDeepwiki(opts: StageOpts)`,`startRun/finishRun` 包裹写 `pipeline_runs`,用 `input_hash` 幂等跳过,注册进 `scripts/pipeline.ts` 的 `STAGES` / `FULL_ORDER` / `SYNC_ORDER`。仓库列表用 `scripts/_data.ts` 的 `loadStageRepos`。

**两档取数,控制成本(时间成本,DeepWiki 本身免费):**

| 档 | 覆盖范围 | 调用 | 单仓耗时 |
|---|---|---|---|
| A 目录档 | 全部候选仓库 | `read_wiki_structure` ×1 | ~1s |
| B 证据档 | tier-2 候选(与现有 `06-llm-evaluate` 同一批) | `ask_question` ×2 | ~15s |

B 档的两问:
1. **鸿蒙证据问**:仓库内是否存在 OpenHarmony/HarmonyOS/ohos/ArkTS/`.ets`/`oh-package.json5`/`build-profile.json5` 痕迹,给出路径与原文引文;明确要求「没有就填空数组,不要编造路径」——实测这句有效,4/5 反例正确返回空。
2. **移植面问**:平台抽象层在哪(路径)、原生代码占比、阻塞依赖清单、可移植核心在哪。

**幂等键** `input_hash = stableHash({ full_name, pushed_at, QUESTION_VERSION })`。
挂 `pushed_at` 的含义:仓库没有新提交就不重问,DeepWiki 的索引也不会变。

**降级**:未索引 → 写 `indexed: false` 并继续,后续阶段行为与今天完全一致(README-only)。DeepWiki 挂了 → 整阶段可跳过,不阻塞管道。

### 4.3 新增表 `deepwiki_analysis`(`supabase/migrations/0013_deepwiki.sql`)

```sql
create table if not exists deepwiki_analysis (
  repository_id          bigint primary key references repositories (id) on delete cascade,
  indexed                boolean not null default false,
  wiki_toc               text,        -- read_wiki_structure 原文(~2KB)
  harmony_evidence_paths text[],
  harmony_evidence_quote text,
  platform_layer_paths   text[],
  portable_core_paths    text[],
  blocking_deps          jsonb,       -- [{name, why}]
  native_code_ratio      real,
  facts                  jsonb,       -- 解析后的完整结构
  raw_answers            jsonb,       -- 原始回答,便于调试与复现
  question_version       text not null,
  input_hash             text not null,
  fetched_at             timestamptz not null default now()
);
```

RLS 公开只读(照 `0001_init.sql` 既有模式),并把关键列并进 `repo_board` 视图 —— 注意 `repo_board` 历来是 `drop view` + 全量重建,新迁移沿用同一写法。

同时新增 `evidence_level` 派生列,用于前端标注这条结论的证据强度:

```sql
case
  when d.harmony_evidence_paths is not null or d.platform_layer_paths is not null then 'wiki'
  when r.readme_text is not null then 'readme'
  else 'none'
end as evidence_level
```

### 4.4 喂给 LLM(`lib/llm/`)

- `prompts.ts` `buildUserPrompt` 增加 `【DeepWiki 代码事实】` 段:
  - tier-1 只注入 `wiki_toc`(便宜,~2KB,但已经能看出项目模块构成);
  - tier-2 注入完整证据(路径 / 引文 / 阻塞依赖 / 平台抽象层)。
- 系统提示需显式声明:**DeepWiki 提供的是事实,等级判定仍由你按判定表给出**,并针对 2.3 的 next.js 型误判加一条约束——「单个 `process.platform === 'openharmony'` 之类的字符串命中不构成 ADAPTED」。
- `PROMPT_VERSION` `p5` → `p6`。按 CLAUDE.md 的坑位提示,这会让所有 `input_hash` 失效触发全量重跑 LLM,**必须先 `--stage=llm-classify --limit=20` 小切片验证输出质量再放量**。
- `evaluate.ts` 的 `evaluateInputHash` 增加 DeepWiki 指纹(`indexed` + 证据路径数 + `question_version`)。
- `schema.ts` `evaluateSchema` 的 `adaptation_points[].evidence` 描述改为「优先引用 DeepWiki 给出的真实文件路径」。

### 4.5 收敛 `auto_state_hint`(`lib/harmony/signals.ts`)

给 `decideHint` 增加入参 `deepwikiEvidence`,但**分级要克制**:

| 证据 | 贡献 |
|---|---|
| ohpm 有已发布包 / 可信 GitCode 组织 | 维持现状,最强 |
| DeepWiki 命中 `oh-package.json5` / `build-profile.json5` / `.ets` 目录 | 等同现有 `project`/`ets` 信号 |
| DeepWiki 仅命中零散关键词(next.js 型) | 只加 `keyword_score`,**不得单独推到 ADAPTED** |

### 4.6 重构 tier-3:换引擎,不换定位

这是收益最大的一处。现状 `scripts/agent/`(Python + OpenAI Agents SDK)对每个仓库要:下载 tarball(`torvalds/linux`、`tensorflow` 是灾难级体积)→ 30 轮 qwen3-max 工具调用采样代码。DeepWiki 用 7 秒、零 token、**全量索引**给出同等甚至更好的证据(见 2.3 的 MMKV 实证)。

**方案:tier-3 改为 DeepWiki 深度问询 + 一次 qwen 结构化定级。**

- 新增 `scripts/09-deepwiki-deep.ts`(TS,进主管道),对 top-N 候选发 6~8 个定向问题(构建系统 / 原生桥接 / UI 层 / 网络层 / 存储层 / 条件编译 / 许可证 / 已有移植分支),汇总后**一次** `generateObject` 产出 tier-3 结论。
- 收益:消除 CLAUDE.md 里记录的 TS/Python 割裂;tier-3 从「只能覆盖极少数」变成「可覆盖全部候选」。
- `scripts/agent/` **保留为未索引仓库的兜底**,由 `04b` 标记的 `indexed = false` 列表驱动 `code-analysis.yml`。这样两条路径各司其职,而不是删掉一条能力。

### 4.7 前端

- `app/repo/`(详情页):新增「代码事实(DeepWiki)」区块 —— `wiki_toc` 折叠成模块地图、证据路径渲染成 `https://github.com/{full_name}/blob/HEAD/{path}` 可点链接、阻塞依赖表格、外链 `https://deepwiki.com/{full_name}`。
- `app/admin/`:把证据路径与引文直接摆在标记控件旁边。**这是最实际的一处收益** —— 人工标记是权威,给审核人现成的代码证据能显著提速。
- 榜单:`components/` 新增 `EvidenceBadge`,展示 `evidence_level`(none / readme / wiki),与既有 `HarmonyBadge` 并列。
- 前端新增 env 常量(如 DeepWiki 站点域名)一律加进 `lib/config.ts`,不在组件里散读 `process.env`。

### 4.8 关于「重复数据可以覆盖」

- 旧 tier-3 行(`analysis.tier = 3`、`prompt_version = 'agent-v1'`):新引擎用新的 `prompt_version`,受 `unique(repository_id, tier, prompt_version, model)` 约束会并存;迁移里直接 `delete from analysis where tier = 3 and prompt_version = 'agent-v1'` 清掉。
- `repo_board` 取 `order by tier desc, created_at desc limit 1`,新 tier-3 自动胜出,视图逻辑不用动。
- tier-1/tier-2 因 `PROMPT_VERSION` 升到 p6 会自然重跑覆盖,旧 p5 行可保留(便于对比)或一并清理。

### 4.9 评分模型:**不动**

`lib/scoring/priority.ts` 的五项权重与乘子结构保持原样。理由:DeepWiki 改善的是 `feasibility` / `effort_estimate` / `ecosystem_gap` 这些**输入的质量**,不是模型结构;2.3 已证明 DeepWiki 的难度分级本身不可靠,不该让它进权重。`evidence_level` 只做展示,不进公式,避免排名震荡。

## 5. 实施顺序

1. `lib/deepwiki/`(client + parse + questions)+ 单测(用已抓的真实响应做 fixture,含 next.js 误判样本与 flutter 非法枚举样本)
2. `0013_deepwiki.sql`(建表 + RLS + 重建 `repo_board`)
3. `scripts/04b-deepwiki.ts` + 注册进 `pipeline.ts`
4. 小切片验证:`pnpm pipeline --stage=deepwiki --limit=30`
5. `lib/llm/prompts.ts` 注入 + `PROMPT_VERSION` → p6;`--stage=llm-classify --limit=20` 验证质量
6. `lib/harmony/signals.ts` 接证据
7. `scripts/09-deepwiki-deep.ts` 替换 tier-3 引擎;`code-analysis.yml` 改为只跑未索引兜底
8. 前端:详情页 + admin + `EvidenceBadge`

## 6. 验证方式

```bash
pnpm typecheck                                   # 改完必跑
pnpm pipeline --stage=deepwiki --limit=30        # 覆盖率与降级路径
pnpm pipeline --stage=llm-evaluate --limit=20    # 证据是否真的进了 prompt、结论是否变准
pnpm build                                       # 静态导出可编译
pnpm dev                                         # /repo 详情页与 /admin 证据区块
```

重点回归三个已知易错点:
- `Tencent/MMKV` → 应稳定判 ADAPTED,且证据路径非空;
- `vercel/next.js` → **不得**因单条 `process.platform` 命中被判 ADAPTED;
- 任一未索引仓库 → `indexed = false`,后续阶段行为与改造前一致。

## 7. 风险

| 风险 | 应对 |
|---|---|
| DeepWiki 无 SLA、未公布限额,可能变更或收费 | 全部结果落库(`raw_answers`),管道对其可选依赖;失效则退回 README-only,即今天的行为 |
| 判断类字段不可靠(已实证) | 只取事实字段,判断一律由我们的 LLM 做 |
| 输出格式漂移 | 宽松解析 + zod 兜底 + 保留原文,解析失败不阻塞 |
| p5→p6 触发全量重跑 LLM 的 token 成本 | 先 `--limit=20` 小切片验证再放量(CLAUDE.md 既有约定) |
| 并发打爆对方 | `deepwikiLimiter` 保守 `maxConcurrent: 5` |
