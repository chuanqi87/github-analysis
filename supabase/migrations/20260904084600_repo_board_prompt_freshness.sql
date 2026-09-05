-- 最新 prompt 世代必须优先于旧世代的更高 tier；否则规则升级后，旧 tier-3 会永久压住新 tier-2。
-- 同一 prompt 世代内仍然优先选择更深 tier，再按分析时间排序。

create or replace view public.repo_board
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
  coalesce(pc.slug, lower(a.category::text)) as category,
  coalesce(sc.slug, a.subcategory) as subcategory,
  pc.name_cn as category_name,
  sc.name_cn as subcategory_name,
  a.tier as analysis_tier,
  a.harmony_suggestion,
  a.harmony_adapted_repo_url,
  a.mobile_relevance,
  a.feasibility,
  a.effort_estimate,
  a.ecosystem_gap,
  a.harmony_leverage,
  a.opportunity_verdict,
  a.opportunity_score,
  a.screening_reason,
  a.confidence,
  a.adaptation_points,
  a.analysis_details,
  a.recommended_approach,
  a.reasoning,
  a.project_summary_cn,
  hs.auto_state_hint,
  hs.support_availability,
  hs.support_provenance,
  hs.support_coverage,
  hs.support_confidence,
  hs.support_evidence,
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
  d.indexed as deepwiki_indexed,
  d.wiki_toc as deepwiki_toc,
  d.harmony_scope as deepwiki_harmony_scope,
  d.harmony_paths as deepwiki_harmony_paths,
  d.harmony_quote as deepwiki_harmony_quote,
  d.project_type as deepwiki_project_type,
  d.languages as deepwiki_languages,
  d.native_code_ratio as deepwiki_native_code_ratio,
  d.has_platform_abstraction as deepwiki_has_platform_abstraction,
  d.platform_layer_paths as deepwiki_platform_layer_paths,
  d.existing_platform_backends as deepwiki_platform_backends,
  d.portable_core_paths as deepwiki_portable_core_paths,
  d.blocking_deps as deepwiki_blocking_deps,
  case
    when d.platform_layer_paths is not null and array_length(d.platform_layer_paths, 1) > 0 then 'wiki'
    when d.harmony_paths is not null and array_length(d.harmony_paths, 1) > 0 then 'wiki'
    when d.indexed then 'toc'
    when r.readme_text is not null then 'readme'
    else 'none'
  end as evidence_level,
  o.state as override_state,
  o.note as override_note,
  o.marked_by,
  o.marked_at,
  coalesce(
    o.state,
    case hs.support_availability
      when 'USABLE' then 'ADAPTED'::harmony_state
      when 'PARTIAL' then 'PARTIAL'::harmony_state
      else null
    end,
    hs.auto_state_hint
  ) as effective_state,
  (o.state is not null) as reviewed
from public.repositories r
left join public.priority_rankings pr on pr.repository_id = r.id
left join lateral (
  select * from public.analysis a2
  where a2.repository_id = r.id
  order by
    coalesce(substring(a2.prompt_version from '^p([0-9]+)')::integer, 0) desc,
    a2.tier desc,
    a2.analyzed_at desc nulls last,
    a2.created_at desc
  limit 1
) a on true
left join public.categories pc on pc.id = a.category_id
left join public.categories sc on sc.id = a.subcategory_id
left join public.harmony_signals hs on hs.repository_id = r.id
left join public.harmony_overrides o on o.repository_id = r.id
left join public.deepwiki_analysis d on d.repository_id = r.id;

grant select on public.repo_board to anon, authenticated;
