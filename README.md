# 鸿蒙生态适配分析看板

分析 GitHub 上 **Star ≥ 10000** 的基线项目以及**多源日榜/周榜热点项目**,通过持久候选池完成“发现 → 初筛 → 结合机会生成 → 代码级反证 → 热点持续监控”。系统把“已有鸿蒙支持事实”和“未来生态结合机会”分成两条轨道；结合机会允许为空，只把有项目资产、鸿蒙专属价值、未覆盖范围和代码证据的少量项目推到榜首。人工审核仍是支持状态的最终权威。

## 架构:完全 GitHub 闭环 + Supabase 后端

```
GitHub Actions(计算)                Supabase(数据 + Auth)          GitHub Pages(展示)
─────────────────────────           ────────────────────           ────────────────────
baseline + 4-source trending  ──▶  analysis_queue 候选池      ◀──   Next.js 静态站点
→ tier1(400) → tier2(100)            analysis / daily_metrics          (antd + ProComponents)
→ tier3(20) → score                  execution_logs / session  ◀──   /admin 可追踪执行链路
                                      harmony_overrides(人工)
```

- **计算**:GitHub Actions 跑管道脚本(service-role key 写库)。
- **数据**:Supabase Postgres,自动 PostgREST API;看板用 anon key 读(RLS 保护)。
- **人工审核**:`/admin` 经 Supabase Auth 登录后直接写 `harmony_overrides`,**即时生效**,无需重建。
- **展示**:Next.js `output: 'export'` 静态导出 → GitHub Pages。
- **LLM**:阿里百炼 / DashScope(OpenAI 兼容),`DASHSCOPE_API_KEY` 自行配置。

## 前置准备

### 1. Supabase 项目
1. 在 [supabase.com](https://supabase.com) 新建免费项目。
2. 新库在 SQL Editor 按文件名顺序执行 `supabase/migrations/` 中的全部迁移；已有数据库升级时只补执行尚未应用的迁移。代码推送和 GitHub Pages 部署不会自动更新数据库结构。
3. **Auth**:创建一个管理员账户(Authentication → Users → Add user,设邮箱+密码);并在 Auth 设置中**关闭公开注册**(Providers → Email → 关掉 "Enable sign ups"),确保只有你能登录写标记。
4. 记下 Project URL、anon key(Settings → API)、service_role key(仅用于 Actions)。

### 2. 百炼 API Key
在 [百炼控制台](https://bailian.console.aliyun.com) 获取 API Key(`DASHSCOPE_API_KEY`)。CI 与本地默认模型均为 `qwen3.8-max`，并保留其推理能力；可用 `DASHSCOPE_MODEL` / `DASHSCOPE_MODEL_DEEP` 分别覆盖。推理强度按层配置：tier-1/tier-2 默认 `medium`，tier-3 默认 `xhigh`；单次请求分别限制为 5/10/25 分钟，超时会留下失败审计并继续后续候选，避免一个请求耗尽整个 CI job。

### 3. GitHub PAT(可选,提升抓取配额)
细粒度或经典 PAT(只读 public 即可)。不配则用 Actions 默认 token。

## 环境变量

本地开发复制 `.env.example` 为 `.env`;线上配置到 GitHub 仓库的 Secrets / Variables。

| 变量 | 用途 | 位置 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 前端读库 | Secret(deploy) + .env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端读库 | Secret(deploy) + .env |
| `SUPABASE_URL` | 管道写库 | Secret(analyze) + .env |
| `SUPABASE_SERVICE_ROLE_KEY` | 管道写库(绕过 RLS) | Secret(analyze) + .env |
| `DASHSCOPE_API_KEY` | 百炼 LLM | Secret(analyze) + .env |
| `DASHSCOPE_MODEL` / `DASHSCOPE_MODEL_DEEP` | 模型名 | Variable(可选) |
| `DASHSCOPE_REASONING_EFFORT_CLASSIFY/EVALUATE/DEEP` | 分层推理强度 | Variable(可选) |
| `DASHSCOPE_TIMEOUT_MS_CLASSIFY/EVALUATE/DEEP` | 分层单请求超时(ms) | Variable(可选) |
| `DEEP_ANALYSIS_RUNNER` | 长时 job 的 Runner 标签，如 `aliyun-deep-analysis` | Variable(可选) |
| `GITHUB_TOKEN` / `GH_PAT` | 抓取配额 | Secret(可选) |
| `NEXT_PUBLIC_ADMIN_EMAIL` | 管理台邮箱校验 | Variable(deploy) + .env |
| `NEXT_PUBLIC_DEEPWIKI_BASE` | DeepWiki 站点地址(可选,默认 https://deepwiki.com) | Variable(deploy) + .env |
| `NEXT_PUBLIC_BASE_PATH` | Pages 子路径 | deploy workflow 自动注入 |

## 本地运行

```bash
pnpm install

# 看板(需先配好 .env 的 NEXT_PUBLIC_SUPABASE_*)
pnpm dev            # http://localhost:3000

# 管道(需 .env 的 SUPABASE_* 与 DASHSCOPE_API_KEY)
pnpm db:check                                  # 只读校验中文简介字段及看板视图，不调用 LLM
pnpm pipeline --stage=build-registry            # 验证鸿蒙底表解析
pnpm pipeline --stage=all --limit=500           # MVP 切片:全流程 top 500
pnpm pipeline --stage=llm-classify --force      # 单阶段 / 强制重算
pnpm pipeline --stage=daily                     # 每日分层分析(默认 400/100/20)
pnpm pipeline --stage=daily --preliminary-limit=50 --deep-limit=10 --tier3-limit=2
pnpm pipeline --stage=weekly-trending            # 单独刷新多源热点
pnpm pipeline --stage=refresh-pool               # 重建候选池派生状态
pnpm audit:session <session_id>                   # 复盘逐项目 Prompt/输出/耗时/Token
```

推荐使用 `--stage=daily`。它先完成基线与热点发现，再从 `analysis_queue` 选取尚未完成当前层级的项目；已分析项目不会占住每日名额。默认预算为 tier-1 初筛 400、tier-2 深评 100、tier-3 代码深析 20，可分别用 `--preliminary-limit`、`--deep-limit`、`--tier3-limit` 调整。积压清空后，只有仍处热点且代码有变化的项目会重新入池。

`daily` / `all` 在取数前，以及各 LLM 阶段在模型调用前，会通过 Data API 校验支持现状与生态机会字段。缺少字段时会立即停止并提示 `20260904062704_support_and_opportunities.sql`；补执行迁移后刷新 PostgREST schema cache，再运行 `pnpm db:check` 确认。此检查不自动执行迁移，也不替代完整的迁移版本管理。

新的 tier-1 只做能力画像和价值初筛；tier-2 先完成架构、平台边界、依赖阻塞、生态替代与决策条件等技术尽调，再生成最多 5 个结合机会，也可以明确输出“未发现明确机会”；tier-3 会读取同组织/相似项目的历史分析作为先验，并用当前仓库代码重新核验，既能淘汰弱机会，也能补充深层代码暴露的漏项。总榜按最佳可信机会计分，第二机会只提供少量加成，Star 与热点只作温和影响力修正。

旧全量管道仍可用:`fetch-top → enrich → build-registry → deepwiki → harmony-signals → fetch-readme → mark-archived → llm-classify → llm-evaluate → score`。`--ids=1,2` 仅处理指定仓库;`--force` 忽略幂等重算。

`deepwiki` 阶段从 [DeepWiki](https://deepwiki.com) 拉取代码级事实(模块地图、鸿蒙痕迹、平台抽象层、阻塞依赖),免费且不烧 token,让后续 LLM 阶段基于真实代码结构判断而非靠 README 猜。`--evidence-limit=N` 控制多少个仓库做定向提问(默认 200,其余只取廉价的模块地图)。缓存按 `toc < evidence < deep` 分级，深层事实不会被后续浅层任务覆盖；服务端包装的 429/5xx 会错峰重试而不是写成事实。

`deepwiki-deep` 是 tier-3 深度评估(逐子系统问询 + 一次结构化定级),按需触发,不在 `--stage=all` 里。只有同时取得鸿蒙证据、移植面和至少 4/5 个子系统事实的项目才会完成深析；证据不足或失败会从后备候选继续补位。

每次管道进程都有统一 `session_id`。子阶段写入 `pipeline_runs`，逐项目 AI 调用写入 `analysis_execution_logs`（实际 System/User Prompt、结构化输出、证据覆盖、耗时、Token、失败原因）；本地同时生成 `reports/logs/<session_id>.jsonl`。管理台“最近运行记录”可直接复制 session，`pnpm audit:session <session_id>` 会生成 `reports/session-audits/` 下的 JSON 和 Markdown 质量报告。

### 推荐的 MVP 验证顺序(先小切片)
1. `--stage=fetch-top --limit=500` → `--stage=enrich --limit=500`
2. `--stage=build-registry` + `--stage=harmony-signals --limit=500`,抽查 axios / lottie 等已知已适配项目信号是否命中。
3. `--stage=deepwiki --limit=500`,抽查 `Tencent/MMKV` 应为 `dedicated_port`、`vercel/next.js` 应为 `build_target_only`(不构成适配)。
4. `--stage=fetch-readme --limit=500` + `--stage=llm-classify --limit=500`,验证百炼分类质量。
5. 打开 `/admin` 登录标记几条,确认看板即时更新(人工权威闭环)。展开行可看到 DeepWiki 的代码证据。
6. `--stage=llm-evaluate --limit=100` + `--stage=score`,人工看 top 50 排序是否符合直觉,再放大到全量。

## 部署到 GitHub Pages

1. 推送到 GitHub;Settings → Pages → Source 选 **GitHub Actions**。
2. 配置仓库 Secrets:`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`DASHSCOPE_API_KEY`(及可选 `GH_PAT`);Variables:`NEXT_PUBLIC_ADMIN_EMAIL`(及可选模型名)。
3. `deploy-pages` 在 push 时构建部署；`analyze-full.yml` 实际执行每日分层分析，`analyze-daily.yml` 每周校准热点、归档状态和全局评分。
4. 每日 workflow 会顺带给 Supabase 免费项目保活(避免 7 天闲置暂停)。

长时 tier-2/tier-3 可路由到阿里云自托管 Runner，部署与安全边界见 [docs/aliyun-actions-runner.md](docs/aliyun-actions-runner.md)。仓库未设置 `DEEP_ANALYSIS_RUNNER` 时仍使用 `ubuntu-latest`。

## 适配价值评分模型

```
weighted = 0.28·popularity + 0.12·velocity + 0.28·mobileRelevance
         + 0.18·effortInv + 0.14·ecosystemGap
priorityScore = 100 · feasibility · adaptedGate · weighted
```

- `popularity` 由 star 对数归一;`velocity` 来自热点分;`mobileRelevance` 品类先验与 LLM 加权;`effortInv = 1 − 工作量`;`ecosystemGap` 品类空白度。
- `feasibility`、`adaptedGate` 作乘子:不可行或已适配项目自然沉底。
- **`adaptedGate` 由人工标记决定**(未标记→暂用自动信号;`NOT_ADAPTED`→1.0;`PARTIAL`→0.3;`ADAPTED`/`NOT_APPLICABLE`→0.0)。
- 调权重只需重跑 `--stage=score`(零 LLM 成本)。详见 `lib/scoring/priority.ts`。

## 目录结构

```
app/            Next.js 看板(总榜 / admin / categories / harmony / trending / repo 详情)
components/      AppShell(ProLayout)+ HarmonyBadge / ScoreBar
lib/
  github/        Search 分段枚举 / GraphQL 批量富化 / REST
  sources/       OSS Insight / GitHub Trending
  harmony/       ohpm / 底表 / 关键词 / 信号汇总
  llm/           百炼 provider / zod schema / prompts / classify / evaluate
  scoring/       评分模型(纯函数,前后端共用)
  queries.ts     浏览器看板查询 + 写 overrides
  supabase/      anon client(前端)/ service-role client(管道)
scripts/         管道 01-07 + daily-trending + build-registry + pipeline 编排
supabase/migrations/  表结构 + RLS + 看板视图
.github/workflows/    analyze-full / analyze-daily / deploy-pages
```
