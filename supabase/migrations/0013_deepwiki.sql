-- ============================================================================
-- DeepWiki 代码事实层
--
-- 背景:tier-1/tier-2 此前只能靠 README 猜代码结构,唯一真正读代码的 tier-3
-- 要下载 tarball + 30 轮采样,只能覆盖极少数仓库。DeepWiki 已全量索引高星仓库,
-- 免费开放 MCP 接口,补上这一环。
--
-- 定位:**只存事实,不存判断**。DeepWiki 的枚举结论实测不可靠
-- (next.js 因一句 process.platform 被判"已鸿蒙化"),分级一律交给我们的 LLM。
-- 详见 docs/deepwiki-redesign.md
-- ============================================================================

create table if not exists deepwiki_analysis (
  repository_id            bigint primary key references repositories (id) on delete cascade,
  -- false = DeepWiki 尚未索引;这类仓库交给 scripts/agent/ 的 tarball 兜底路径
  indexed                  boolean not null default false,

  -- read_wiki_structure 原文(模块地图,~2KB)。
  -- 注意不存 read_wiki_contents:实测小项目就 685KB,无法喂 LLM。
  wiki_toc                 text,

  -- ---- Q1 鸿蒙证据 --------------------------------------------------------
  -- scope 四分:dedicated_port(真适配)/ build_target_only(仅构建矩阵一项)
  --           / incidental_mention(只在文档注释里出现)/ none
  -- 这个区分正是防止 next.js 型误判的关键,不要退化成 boolean。
  harmony_scope            text,
  harmony_paths            text[],
  harmony_quote            text,
  harmony_declares_support boolean,
  ohos_imports             text[],

  -- ---- Q2 移植面 ----------------------------------------------------------
  project_type             text,
  languages                text[],
  native_code_ratio        real,
  has_platform_abstraction boolean,
  platform_layer_paths     text[],
  existing_platform_backends text[],
  portable_core_paths      text[],
  blocking_deps            jsonb,       -- [{name, why}]
  platform_apis_used       text[],
  conditional_compilation  text[],

  -- ---- tier-3 深度问询的追加结果 ------------------------------------------
  extra                    jsonb,

  -- 原始回答:解析规则变了可离线重跑,不必再打一遍 DeepWiki
  raw_answers              jsonb,

  question_version         text not null,
  input_hash               text not null,
  fetched_at               timestamptz not null default now()
);

create index if not exists idx_deepwiki_indexed on deepwiki_analysis (indexed);
create index if not exists idx_deepwiki_scope on deepwiki_analysis (harmony_scope);

comment on column deepwiki_analysis.harmony_scope is
  'dedicated_port | build_target_only | incidental_mention | none — 只描述证据强度,不等于适配状态';
comment on column deepwiki_analysis.indexed is
  'false 表示 DeepWiki 未索引,后续阶段须降级为 README-only';

-- ---- harmony_signals:记下这次汇总用到的 DeepWiki 证据分级 -------------------
-- 落库而非只在内存里算,是为了让 auto_state_hint 可追溯:
-- 看板/管理台能直接回答"这个 PARTIAL 是凭什么给的"。
alter table harmony_signals add column if not exists deepwiki_scope text;
comment on column harmony_signals.deepwiki_scope is
  'DeepWiki 证据分级快照;只有 dedicated_port 会抬升 auto_state_hint';

-- ---- RLS:公开只读(与其它数据表一致) --------------------------------------
alter table deepwiki_analysis enable row level security;
drop policy if exists "public_read" on deepwiki_analysis;
create policy "public_read" on deepwiki_analysis for select using (true);

-- ============================================================================
-- 清理:旧 tier-3 Python Agent 的分析行
-- tier-3 换引擎为 DeepWiki 深度问询,旧 agent-v1 行不再有对照价值,直接覆盖。
-- ============================================================================
delete from analysis where tier = 3 and prompt_version = 'agent-v1';

-- ============================================================================
-- 重建 repo_board:并入 DeepWiki 事实 + evidence_level
-- (本视图历来是 drop + 全量重建,沿用同一写法)
-- ============================================================================

drop view if exists repo_board;

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
  -- ---- DeepWiki 代码事实 --------------------------------------------------
  d.indexed                    as deepwiki_indexed,
  d.wiki_toc                   as deepwiki_toc,
  d.harmony_scope              as deepwiki_harmony_scope,
  d.harmony_paths              as deepwiki_harmony_paths,
  d.harmony_quote              as deepwiki_harmony_quote,
  d.project_type               as deepwiki_project_type,
  d.languages                  as deepwiki_languages,
  d.native_code_ratio          as deepwiki_native_code_ratio,
  d.has_platform_abstraction   as deepwiki_has_platform_abstraction,
  d.platform_layer_paths       as deepwiki_platform_layer_paths,
  d.existing_platform_backends as deepwiki_platform_backends,
  d.portable_core_paths        as deepwiki_portable_core_paths,
  d.blocking_deps              as deepwiki_blocking_deps,
  -- 证据强度:这条结论是基于什么得出的,供前端如实标注(不进评分公式)
  case
    when d.platform_layer_paths is not null and array_length(d.platform_layer_paths, 1) > 0 then 'wiki'
    when d.harmony_paths is not null and array_length(d.harmony_paths, 1) > 0 then 'wiki'
    when d.indexed then 'toc'
    when r.readme_text is not null then 'readme'
    else 'none'
  end                          as evidence_level,
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
left join harmony_overrides o on o.repository_id = r.id
left join deepwiki_analysis d on d.repository_id = r.id;

grant select on repo_board to anon, authenticated;
