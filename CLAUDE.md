# CLAUDE.md

面向编码 agent 的项目指南。用户安装/部署步骤见 [README.md](README.md);本文只记录**架构约定、代码放哪、易踩的坑**。

## 项目一句话

分析 GitHub 上 Star ≥ 10000 的项目 + 每日热点,为每个仓库产出「鸿蒙(HarmonyOS/OpenHarmony)适配价值优先级」榜单。鸿蒙化状态以**管理台人工标记为权威**,自动信号与 LLM 仅作辅助建议。

## 架构:三段闭环

```
GitHub Actions(计算)      →   Supabase Postgres(数据/Auth)   →   GitHub Pages(展示)
scripts/ 管道脚本               表 + 视图 + RLS 公开只读              Next.js output:'export' 静态站
service-role key 写库           harmony_overrides 人工标记 ← /admin 登录后直接写(即时生效)
```

- **计算与展示完全解耦**:前端是静态导出,不含任何服务端逻辑;所有写操作要么在 Actions(管道),要么在 `/admin`(人工标记 + 触发 workflow)。
- **人工标记是权威**:`harmony_overrides.state` 覆盖一切自动判断,改动即时反映到看板视图,无需重建。

## 常用命令

```bash
pnpm dev                                   # 本地看板 http://localhost:3000
pnpm typecheck                             # 改完必跑(tsc --noEmit)
pnpm build                                 # 静态导出到 out/,验证前端可编译
pnpm check                                 # 校验 .env 配置齐全

pnpm pipeline --stage=<stage> [--limit=N] [--ids=1,2] [--force]
pnpm pipeline --stage=all --limit=500      # 全流程小切片(推荐先验证再放量)
pnpm pipeline --stage=sync                 # 同步模式:抓新仓库+初步分析,不含 LLM
pnpm db:migrate                            # 执行 supabase/migrations/
```

## 目录职责

| 路径 | 职责 |
|---|---|
| `app/` | Next.js 页面(总榜 `/`、`/admin`、`/categories`、`/harmony`、`/trending`、`/repo` 详情)。均为 `'use client'` 组件,浏览器直连 Supabase。 |
| `components/` | 通用展示组件(`HarmonyBadge`/`ScoreBar`/`ArchivedTag`);`components/admin/` 为管理台专属子组件。 |
| `lib/config.ts` | **前端(`NEXT_PUBLIC_*`)配置唯一入口**。新增前端 env 常量一律加在这里,不要在组件里散读 `process.env`。 |
| `lib/queries.ts` | 浏览器端看板**读**查询 + 写 `harmony_overrides`。纯读查询集中于此。 |
| `lib/github/` | `search`(star 分段枚举)、`graphql`(批量富化)、`rest`、`actions`(浏览器触发 workflow_dispatch)。 |
| `lib/harmony/` | 鸿蒙信号:`ohpm`/`gitcode`/`registry` 底表、`keywords`、`signals` 汇总。 |
| `lib/llm/` | 百炼 provider + zod schema + prompts + classify(tier-1)/evaluate(tier-2)/resolve-category。 |
| `lib/scoring/priority.ts` | **纯函数**评分模型,前端与管道共用。调权重只需重跑 `--stage=score`,零 LLM 成本。 |
| `lib/supabase/` | `client.ts`=anon key(前端,受 RLS);`admin.ts`=service-role(管道,绕过 RLS)。 |
| `scripts/` | 编号管道阶段 `01~08` + `pipeline.ts` 编排 + `weekly-trending`/`build-registry`。 |
| `scripts/agent/` | **独立的** Python tier-3 深度代码分析 Agent(OpenAI Agents SDK,下载源码后阅读)。与 TS 管道分离,由 `code-analysis.yml` 触发。 |
| `supabase/migrations/` | 表结构 + RLS + 看板视图,顺序编号执行。 |

## 关键约定(改代码时遵守)

- **管道阶段统一形态**:每个 `scripts/0X-*.ts` 导出 `runXxx(opts: StageOpts): Promise<void>`,内部用 `startRun/finishRun`([lib/pipeline/runlog.ts](lib/pipeline/runlog.ts))包裹以写 `pipeline_runs` 审计,并通过 `input_hash` 做幂等跳过(`--force` 忽略)。新增阶段照此模板,并注册进 [scripts/pipeline.ts](scripts/pipeline.ts) 的 `STAGES` 与 `FULL_ORDER`/`SYNC_ORDER`。
- **共享数据加载**:阶段间读 `repositories`/`harmony_signals` 用 [scripts/_data.ts](scripts/_data.ts) 的 `loadStageRepos`/`loadSignalsMap`,不要各自重写查询。
- **两个 Supabase 客户端不能混用**:前端/管理台读写走 `client.ts`(anon);管道写库走 `admin.ts`(service-role)。**管道脚本误用 anon client 会因 RLS 静默失败**(曾发生,见 git history)。
- **前端 env 走 `lib/config.ts`**,不硬编码 repo owner、不在组件里散读 `process.env.NEXT_PUBLIC_*`。
- **移动端列表数据**用 `lib/hooks/use-board-data.ts` 的 `useBoardData`,不要重写 fetch+cancelled 样板。
- **鸿蒙状态类型** `HarmonyState` 与标签集中在 [lib/types.ts](lib/types.ts),与 DB 列一一对应(snake_case)。

## 易踩的坑

- **静态导出**:`next.config.mjs` 用 `output: 'export'`,没有 API route / SSR / 服务端 secret。任何需要密钥的操作只能在 Actions 或走 anon+RLS。
- **PostgREST 默认 1000 行上限**:全量查询要分页/分块(见 `_data.ts` 的 800/`admin.ts` 的 500 分批),否则被静默截断。
- **百炼 qwen 思考模型**:[lib/llm/provider.ts](lib/llm/provider.ts) 注入 `enable_thinking:false`(思考模式下不支持 tool_choice 且 JSON 约 1/3 不合 schema)。改 LLM 调用勿破坏这点。
- **分类体系已迁移到 `categories` 表**(动态二级分类);`lib/types.ts` 里 `REPO_CATEGORIES`/`CATEGORY_LABELS` 及 `analysis.category` 枚举列均为 `@deprecated` 过渡兼容,新代码走 `CategoryRow`/`categories` 表 + `lib/category/loader.ts`。
- **归档判定**:超过 3 年无 commit 判 `stale_repository`;归档仓库在 LLM 阶段前被 `mark-archived` 跳过以省 token。
- **改评分权重不需要跑 LLM**:改 `lib/scoring/priority.ts` 后 `--stage=score` 即可,别重跑 classify/evaluate。
- **改 LLM prompt/schema 要 bump `PROMPT_VERSION`**([lib/llm/prompts.ts](lib/llm/prompts.ts),现 p5):所有 input_hash 随之失效,下次管道会全量重跑 LLM(token 成本);先 `--stage=classify --limit=20` 小切片验证输出质量再放量。tier-2 注入的品类适配统计刻意**不进 input_hash**,避免统计微变触发全量重评。

## 部署与调度

- `deploy-pages.yml`:push 时构建并发布到 GitHub Pages。
- `analyze-full.yml`:手动/每周,全量或同步。`analyze-daily.yml`:每日热点 + 给 Supabase 免费实例保活。`code-analysis.yml`:tier-3 Python Agent。
- 前端触发这些 workflow 走 `lib/github/actions.ts`,需 `NEXT_PUBLIC_GH_TRIGGER_TOKEN`(actions:write 的细粒度 PAT)。
