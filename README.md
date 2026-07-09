# 鸿蒙生态适配分析看板

分析 GitHub 上 **Star ≥ 10000** 的项目(约 5,370 个)以及**每日热点项目**,对每个项目产出:分类、鸿蒙(HarmonyOS / OpenHarmony)适配点、当前鸿蒙化状态、**适配价值优先级评分**,并给出「最适合快速做鸿蒙化适配」的排序榜单。鸿蒙化状态由你在管理台**逐个人工审核标记**,自动信号仅作辅助。

## 架构:完全 GitHub 闭环 + Supabase 后端

```
GitHub Actions(计算)                Supabase(数据 + Auth)          GitHub Pages(展示)
─────────────────────────           ────────────────────           ────────────────────
fetch-top → enrich → signals   ──▶  Postgres 表 / 视图        ◀──   Next.js 静态站点
→ readme → LLM 分析 → score          RLS 公开只读                    (antd + ProComponents)
daily-trending(每日)                harmony_overrides(人工)  ◀──   /admin 登录后直接写
```

- **计算**:GitHub Actions 跑管道脚本(service-role key 写库)。
- **数据**:Supabase Postgres,自动 PostgREST API;看板用 anon key 读(RLS 保护)。
- **人工审核**:`/admin` 经 Supabase Auth 登录后直接写 `harmony_overrides`,**即时生效**,无需重建。
- **展示**:Next.js `output: 'export'` 静态导出 → GitHub Pages。
- **LLM**:阿里百炼 / DashScope(OpenAI 兼容),`DASHSCOPE_API_KEY` 自行配置。

## 前置准备

### 1. Supabase 项目
1. 在 [supabase.com](https://supabase.com) 新建免费项目。
2. 打开 SQL Editor,依次执行 `supabase/migrations/0001_init.sql`、`0002_views.sql`(或用 CLI:`supabase link` 后 `supabase db push`)。
3. **Auth**:创建一个管理员账户(Authentication → Users → Add user,设邮箱+密码);并在 Auth 设置中**关闭公开注册**(Providers → Email → 关掉 "Enable sign ups"),确保只有你能登录写标记。
4. 记下 Project URL、anon key(Settings → API)、service_role key(仅用于 Actions)。

### 2. 百炼 API Key
在 [百炼控制台](https://bailian.console.aliyun.com) 获取 API Key(`DASHSCOPE_API_KEY`)。默认模型 `qwen-plus`(粗分类)/ `qwen-max`(深评),可改。

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
| `GITHUB_TOKEN` / `GH_PAT` | 抓取配额 | Secret(可选) |
| `NEXT_PUBLIC_ADMIN_EMAIL` | 管理台邮箱校验 | Variable(deploy) + .env |
| `NEXT_PUBLIC_BASE_PATH` | Pages 子路径 | deploy workflow 自动注入 |

## 本地运行

```bash
pnpm install

# 看板(需先配好 .env 的 NEXT_PUBLIC_SUPABASE_*)
pnpm dev            # http://localhost:3000

# 管道(需 .env 的 SUPABASE_* 与 DASHSCOPE_API_KEY)
pnpm pipeline --stage=build-registry            # 验证鸿蒙底表解析
pnpm pipeline --stage=all --limit=500           # MVP 切片:全流程 top 500
pnpm pipeline --stage=llm-classify --force      # 单阶段 / 强制重算
pnpm pipeline --stage=daily-trending            # 每日热点
```

管道阶段:`fetch-top → enrich → build-registry → harmony-signals → fetch-readme → llm-classify → llm-evaluate → score`,`--stage=all` 顺序执行。`--limit=N` 取 top N;`--ids=1,2` 仅处理指定仓库;`--force` 忽略幂等重算。

### 推荐的 MVP 验证顺序(先小切片)
1. `--stage=fetch-top --limit=500` → `--stage=enrich --limit=500`
2. `--stage=build-registry` + `--stage=harmony-signals --limit=500`,抽查 axios / lottie 等已知已适配项目信号是否命中。
3. `--stage=fetch-readme --limit=500` + `--stage=llm-classify --limit=500`,验证百炼分类质量。
4. 打开 `/admin` 登录标记几条,确认看板即时更新(人工权威闭环)。
5. `--stage=llm-evaluate --limit=100` + `--stage=score`,人工看 top 50 排序是否符合直觉,再放大到全量。

## 部署到 GitHub Pages

1. 推送到 GitHub;Settings → Pages → Source 选 **GitHub Actions**。
2. 配置仓库 Secrets:`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`DASHSCOPE_API_KEY`(及可选 `GH_PAT`);Variables:`NEXT_PUBLIC_ADMIN_EMAIL`(及可选模型名)。
3. `deploy-pages` workflow 在 push 时自动构建部署;`analyze-full`(手动/每周)与 `analyze-daily`(每日)负责数据。
4. 每日 workflow 会顺带给 Supabase 免费项目保活(避免 7 天闲置暂停)。

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
