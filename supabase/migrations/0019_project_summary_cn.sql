-- 仓库中文简介:LLM 用 1-2 句说明「这个项目是干什么的」,供详情页展示。
-- 旧分析行该列为 null,前端会用分类 / 评估理由兜底,不必立刻全量重跑 LLM。
alter table analysis add column if not exists project_summary_cn text;

comment on column analysis.project_summary_cn is
  '1-2 句中文项目简介:这个仓库是干什么的;依据 README/描述/代码事实,不含鸿蒙适配建议';

-- 看板视图并入该列(本视图历来 drop + 全量重建)
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
  a.project_summary_cn,
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
