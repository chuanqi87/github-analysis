-- ============================================================================
-- 动态二级分类体系:用数据库管理分类,替代硬编码 repo_category 枚举。
-- 支持两级分类(大类 → 子类),每级不超过 30 个。
-- LLM 分析时可从已有分类中选取,也可主动提议新分类。
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. categories 表:邻接表(parent_id)实现二级分类
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists categories (
  id          bigserial primary key,
  parent_id   bigint references categories (id) on delete cascade,
  slug        text not null,                       -- 英文标识(LLM 输出用)
  name_cn     text not null,                       -- 中文显示名
  name_en     text,                                -- 英文显示名(可选)
  description text,                                -- 分类说明(给 LLM 做上下文)
  sort_order  integer not null default 0,
  is_active   boolean not null default true,       -- 停用而非删除
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (parent_id, slug)                         -- 同层级 slug 唯一
);

-- 顶层分类 slug 唯一(parent_id IS NULL)
create unique index if not exists idx_categories_top_slug
  on categories (slug) where parent_id is null;

create index if not exists idx_categories_parent on categories (parent_id);
create index if not exists idx_categories_active on categories (is_active) where is_active = true;

drop trigger if exists trg_categories_updated on categories;
create trigger trg_categories_updated before update on categories
  for each row execute function set_updated_at();

-- RLS:公开只读,service_role 写入(pipeline 自动绕过 RLS)
alter table categories enable row level security;
drop policy if exists "public_read" on categories;
create policy "public_read" on categories for select using (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 种子数据:17 个顶层分类 + 二级子类
-- ═══════════════════════════════════════════════════════════════════════════

-- ---- 顶层分类(与旧 repo_category 枚举一一对应) ----------------------------
insert into categories (slug, name_cn, name_en, description, sort_order) values
  ('ui_framework',    'UI 框架',      'UI Framework',    'UI 组件库、布局系统、设计系统等前端界面框架', 1),
  ('cross_platform',  '跨端框架',     'Cross Platform',  'React Native / Flutter / Electron 等跨平台方案', 2),
  ('network_lib',     '网络库',       'Network',         'HTTP 客户端、WebSocket、RPC 等网络通信', 3),
  ('database',        '数据存储',     'Database',        '关系/NoSQL 数据库、缓存、ORM 等数据层', 4),
  ('ai_ml',           'AI/ML',        'AI/ML',           '机器学习、NLP、计算机视觉、大模型等 AI 相关', 5),
  ('dev_tool',        '开发工具',     'Dev Tools',       'IDE 插件、代码质量、测试、调试等开发效率工具', 6),
  ('cli',             '命令行工具',   'CLI',             '终端应用、CLI 框架、Shell 工具', 7),
  ('build_tool',      '构建工具',     'Build Tools',     '打包器、编译器、包管理器、CI/CD 等构建链', 8),
  ('utility_lib',     '通用工具库',   'Utility',         '通用功能库、日期/数学/字符串处理等', 9),
  ('media',           '多媒体',       'Media',           '图片/视频/音频/3D 等多媒体处理', 10),
  ('graphics_game',   '图形/游戏',    'Graphics & Game', '图形渲染引擎、游戏框架、动画系统', 11),
  ('security',        '安全',         'Security',        '认证授权、加密、安全审计、权限管理', 12),
  ('mobile_app',      '移动应用',     'Mobile App',      'iOS/Android/鸿蒙移动应用', 13),
  ('desktop_app',     '桌面应用',     'Desktop App',     'Electron/Tauri/原生桌面应用', 14),
  ('server_backend',  '服务端/后端',  'Server & Backend','Web 框架、微服务、API 服务等后端基础设施', 15),
  ('learning_docs',   '学习/文档',    'Learning & Docs', '教程、书籍、课程、文档站等学习资源', 16),
  ('other',           '其它',         'Other',           '不属于以上任何分类的项目', 17)
on conflict (slug) where parent_id is null do nothing;

-- ---- 二级子类 ---------------------------------------------------------------
-- UI 框架
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('ui_components',    'UI 组件库',    '按钮、表单、弹窗等基础/复合组件库', 1),
  ('state_mgmt',       '状态管理',     'Redux / MobX / Zustand 等应用状态管理', 2),
  ('forms',            '表单/校验',    '表单构建、数据校验、表单 UI', 3),
  ('charts',           '图表/可视化',  '数据可视化图表库', 4),
  ('animation',        '动效/动画',    '动画引擎、过渡效果、Lottie 等', 5),
  ('design_system',    '设计系统/主题','设计 Token、主题切换、CSS-in-JS', 6)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'ui_framework' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 跨端框架
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('rn_like',          'RN 系框架',    'React Native / Expo 等 RN 生态', 1),
  ('flutter',          'Flutter',      'Flutter 框架及其插件生态', 2),
  ('web_framework',    'Web 框架',     'Next.js / Nuxt / SvelteKit 等全栈 Web 框架', 3),
  ('desktop_fw',       '桌面跨端',     'Electron / Tauri 等桌面跨端方案', 4),
  ('mini_program',     '小程序',       '微信/支付宝小程序框架及工具', 5),
  ('compose_multi',    'Compose 跨端', 'JetBrains Compose Multiplatform', 6)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'cross_platform' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 网络库
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('http_client',      'HTTP 客户端',  'Axios / Fetch / OkHttp 等 HTTP 请求库', 1),
  ('realtime',         '实时通信',     'WebSocket / WebRTC / SSE 等实时通信', 2),
  ('rpc_grpc',         'RPC/gRPC',     'gRPC / tRPC / JSON-RPC 等远程调用', 3),
  ('protocol',         '协议实现',     'MQTT / AMQP / 自定义协议等', 4)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'network_lib' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 数据存储
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('relational',       '关系型数据库', 'MySQL / PostgreSQL / SQLite 等', 1),
  ('nosql',            'NoSQL',        'MongoDB / Redis / DynamoDB 等', 2),
  ('orm',              'ORM/查询构建', 'Prisma / TypeORM / Sequelize 等', 3),
  ('cache',            '缓存',         'Redis / Memcached / 本地缓存', 4),
  ('file_storage',     '文件/对象存储','S3 / MinIO / 本地文件存储', 5),
  ('search_engine',    '搜索引擎',     'Elasticsearch / Meilisearch 等', 6)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'database' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- AI/ML
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('ml_framework',     '机器学习框架', 'scikit-learn / XGBoost 等传统 ML', 1),
  ('deep_learning',    '深度学习',     'PyTorch / TensorFlow 等 DL 框架', 2),
  ('nlp',              'NLP',          '自然语言处理、分词、文本分析', 3),
  ('cv',               '计算机视觉',   '图像识别、目标检测、OpenCV 等', 4),
  ('llm_agent',        'LLM/Agent',    '大语言模型、RAG、Agent 框架', 5),
  ('data_processing',  '数据处理',     'pandas / NumPy / 数据管道', 6)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'ai_ml' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 开发工具
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('ide_plugin',       'IDE 插件',     'VS Code / JetBrains 等 IDE 扩展', 1),
  ('code_quality',     '代码质量',     'Lint / Format / 静态分析 / Code Review', 2),
  ('testing',          '测试工具',     'Jest / Vitest / Cypress / Playwright', 3),
  ('debug',            '调试工具',     'Debugger / Profiler / 性能分析', 4),
  ('devops',           'DevOps',       'Docker / K8s / Terraform / CI 配置', 5),
  ('ai_assist',        'AI 编程辅助',  'Copilot / Cursor / AI 代码生成', 6)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'dev_tool' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 命令行工具
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('cli_app',          '终端应用',     '独立终端应用程序', 1),
  ('cli_framework',    'CLI 框架',     'Commander / Click / Cobra 等 CLI 构建库', 2),
  ('terminal_ui',      '终端 UI',      'Ink / Blessed / TUI 组件库', 3),
  ('shell_util',       'Shell 工具',   'Shell 脚本增强、终端效率工具', 4)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'cli' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 构建工具
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('bundler',          '打包器',       'Webpack / Vite / Rollup / esbuild', 1),
  ('compiler',         '编译器/转译器','Babel / SWC / TypeScript 编译器', 2),
  ('pkg_manager',      '包管理器',     'npm / pnpm / yarn / ohpm 等', 3),
  ('task_runner',      '任务/CI',      'Make / Gulp / GitHub Actions 等', 4),
  ('code_generator',   '代码生成',     '模板引擎、脚手架、代码生成器', 5)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'build_tool' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 通用工具库
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('general_util',     '通用功能',     'lodash / ramda 等通用工具集', 1),
  ('fp',               '函数式编程',   'fp-ts / Effect 等函数式编程库', 2),
  ('date_math',        '日期/数学',    'dayjs / mathjs / BigNumber 等', 3),
  ('i18n',             '国际化',       'i18next / 多语言 / 本地化', 4),
  ('validation',       '校验/类型',    'zod / yup / Joi 等数据校验', 5)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'utility_lib' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 多媒体
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('image',            '图片处理',     'Sharp / ImageMagick / 图像处理库', 1),
  ('video',            '视频处理',     'FFmpeg 封装、视频编辑/播放', 2),
  ('audio',            '音频处理',     '音频播放/录制/处理', 3),
  ('media_player',     '播放器',       '媒体播放器组件/引擎', 4)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'media' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 图形/游戏
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('rendering',        '渲染引擎',     'Three.js / WebGL / Vulkan 等渲染', 1),
  ('game_engine',      '游戏引擎',     'Unity / Godot / 自研引擎', 2),
  ('game_lib',         '游戏框架',     'Phaser / PixiJS 等轻量游戏库', 3),
  ('svg_canvas',       'SVG/Canvas',   'D3 / Snap.svg / Canvas 绑定库', 4)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'graphics_game' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 安全
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('auth',             '认证/授权',    'OAuth / JWT / SSO / Passport', 1),
  ('crypto',           '加密/签名',    'AES / RSA / 哈希 / 数字签名', 2),
  ('vulnerability',    '安全审计',     '漏洞扫描、依赖检查、SAST', 3),
  ('access_control',   '权限管理',     'RBAC / ABAC / ACL 等权限模型', 4)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'security' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 移动应用
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('ios_app',          'iOS 应用',     'iOS / SwiftUI 应用', 1),
  ('android_app',      'Android 应用', 'Android / Jetpack Compose 应用', 2),
  ('harmony_app',      '鸿蒙应用',     'HarmonyOS Next 原生应用', 3),
  ('cross_app',        '跨平台应用',   'RN / Flutter 跨平台移动应用', 4)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'mobile_app' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 桌面应用
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('electron_app',     'Electron 应用','基于 Electron 的桌面应用', 1),
  ('native_desktop',   '原生桌面',     'Qt / GTK / Cocoa 原生桌面应用', 2),
  ('tauri_app',        'Tauri 应用',   '基于 Tauri 的轻量桌面应用', 3)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'desktop_app' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 服务端/后端
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('web_framework',    'Web 框架',     'Express / FastAPI / Spring 等', 1),
  ('microservice',     '微服务',       '服务网格、服务发现、分布式系统', 2),
  ('api_service',      'API 服务',     'REST / GraphQL / tRPC API', 3),
  ('mq',               '消息队列',     'Kafka / RabbitMQ / NATS 等', 4),
  ('serverless',       'Serverless',   '云函数 / Edge Function / Workers', 5)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'server_backend' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 学习/文档
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('tutorial',         '教程/课程',    '在线教程、视频课程、训练营', 1),
  ('book',             '技术书籍',     '开源技术书籍、电子书', 2),
  ('doc_site',         '文档站',       'API 文档、Wiki、知识库', 3),
  ('awesome_list',     'Awesome List', '资源收集列表', 4),
  ('algorithm',        '算法/数据集',  '算法题集、LeetCode、数据集', 5),
  ('language_learn',   '语言学习',     '编程语言学习资源', 6)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'learning_docs' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- 其它
insert into categories (parent_id, slug, name_cn, description, sort_order)
select id, sub.slug, sub.name_cn, sub.description, sub.sort_order
from categories, (values
  ('config',           '配置/模板',    'dotfiles / 项目模板 / boilerplate', 1),
  ('misc',             '其他杂项',     '无法归入已有子类的项目', 2)
) as sub(slug, name_cn, description, sort_order)
where categories.slug = 'other' and categories.parent_id is null
on conflict (parent_id, slug) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. analysis 表:新增 FK 列,回填旧枚举数据
-- ═══════════════════════════════════════════════════════════════════════════

alter table analysis add column if not exists category_id    bigint references categories (id);
alter table analysis add column if not exists subcategory_id bigint references categories (id);

create index if not exists idx_analysis_category    on analysis (category_id);
create index if not exists idx_analysis_subcategory on analysis (subcategory_id);

-- 回填:把旧 category 枚举值映射到新 categories.id
update analysis a
set category_id = c.id
from categories c
where a.category_id is null
  and c.parent_id is null
  and c.slug = lower(a.category::text);

-- 回填:尝试匹配旧 subcategory 文本到已有二级分类 slug(name_cn)
update analysis a
set subcategory_id = c.id
from categories c
where a.subcategory_id is null
  and a.category_id is not null
  and c.parent_id = a.category_id
  and a.subcategory is not null
  and a.subcategory != ''
  and (c.slug = lower(a.subcategory) or c.name_cn = a.subcategory);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 重建视图:使用 category_id / subcategory_id
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists v_category_stats;
drop view if exists v_harmony_stats;
drop view if exists repo_board;

-- ---- repo_board:单仓看板行 -----------------------------------------------
create view repo_board
with (security_invoker = on) as
select
  r.id,
  r.full_name,
  r.owner,
  r.name,
  r.description,
  r.homepage,
  r.primary_language,
  r.stars,
  r.forks,
  r.topics,
  r.license,
  r.pushed_at,
  r.is_archived,
  r.archived_reason,
  pr.priority_score,
  pr.rank,
  pr.breakdown,
  -- 分类:优先用新 FK,兜底旧枚举(迁移过渡期)
  coalesce(pc.slug, lower(a.category::text))  as category,
  coalesce(sc.slug, a.subcategory)            as subcategory,
  pc.name_cn                                  as category_name,
  sc.name_cn                                  as subcategory_name,
  a.tier               as analysis_tier,
  a.harmony_suggestion,
  a.harmony_adapted_repo_url,
  a.mobile_relevance,
  a.feasibility,
  a.effort_estimate,
  a.ecosystem_gap,
  a.adaptation_points,
  a.recommended_approach,
  a.reasoning,
  hs.auto_state_hint,
  hs.ohpm_matched,
  hs.ohpm_packages,
  hs.has_oh_package,
  hs.has_build_profile,
  hs.has_ets,
  hs.in_registry,
  hs.registry_source,
  hs.source_repo_url,
  hs.keyword_score,
  hs.gitcode_matched,
  hs.gitcode_repo_url,
  hs.gitcode_repo_name,
  o.state              as override_state,
  o.note               as override_note,
  o.marked_by,
  o.marked_at,
  coalesce(o.state, hs.auto_state_hint) as effective_state,
  (o.state is not null) as reviewed
from repositories r
left join priority_rankings pr on pr.repository_id = r.id
left join lateral (
  select * from analysis a2
  where a2.repository_id = r.id
  order by a2.tier desc, a2.created_at desc
  limit 1
) a on true
left join categories pc on pc.id = a.category_id
left join categories sc on sc.id = a.subcategory_id
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id;

-- ---- v_category_stats:按顶层分类聚合 -------------------------------------
create view v_category_stats
with (security_invoker = on) as
select
  coalesce(pc.slug, lower(a.category::text), 'other') as category,
  coalesce(pc.name_cn, '其它')                         as category_name,
  count(*)                                             as total,
  avg(pr.priority_score)                               as avg_priority,
  count(*) filter (where coalesce(o.state, hs.auto_state_hint) = 'ADAPTED')     as adapted,
  count(*) filter (where coalesce(o.state, hs.auto_state_hint) = 'NOT_ADAPTED') as not_adapted
from repositories r
left join lateral (
  select category_id, category from analysis a2
  where a2.repository_id = r.id
  order by a2.tier desc, a2.created_at desc
  limit 1
) a on true
left join categories pc on pc.id = a.category_id
left join priority_rankings pr on pr.repository_id = r.id
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id
where not r.is_archived
group by 1, 2;

-- ---- v_harmony_stats:不变 -------------------------------------------------
create view v_harmony_stats
with (security_invoker = on) as
select
  coalesce(o.state, hs.auto_state_hint, 'NOT_ADAPTED') as effective_state,
  count(*)                              as total,
  count(*) filter (where o.state is not null) as reviewed
from repositories r
left join harmony_signals hs on hs.repository_id = r.id
left join harmony_overrides o on o.repository_id = r.id
where not r.is_archived
group by 1;

grant select on repo_board, v_category_stats, v_harmony_stats to anon, authenticated;
grant select on categories to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 辅助视图:分类树(前端下拉/筛选用)
-- ═══════════════════════════════════════════════════════════════════════════
drop view if exists v_category_tree;
create view v_category_tree
with (security_invoker = on) as
select
  c.id,
  c.parent_id,
  c.slug,
  c.name_cn,
  c.name_en,
  c.description,
  c.sort_order,
  c.is_active,
  p.slug       as parent_slug,
  p.name_cn    as parent_name_cn,
  p.sort_order as parent_sort_order
from categories c
left join categories p on p.id = c.parent_id
where c.is_active = true
order by coalesce(p.sort_order, c.sort_order), c.sort_order;

grant select on v_category_tree to anon, authenticated;
