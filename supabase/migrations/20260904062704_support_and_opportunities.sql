-- 支持现状与生态结合机会分轨：
-- 1) harmony_signals 保存确定性支持现状，不再把“未发现”当作“未适配”；
-- 2) analysis 保存允许为空的机会结论与确定性机会分；
-- 3) repo_board 暴露两条轨道，旧 harmony_state 仅保留给人工标记兼容。

alter table public.harmony_signals
  add column if not exists support_availability text not null default 'UNKNOWN',
  add column if not exists support_provenance text not null default 'UNKNOWN',
  add column if not exists support_coverage text not null default 'UNKNOWN',
  add column if not exists support_confidence real not null default 0.25,
  add column if not exists support_evidence jsonb not null default '[]'::jsonb;

alter table public.analysis
  add column if not exists opportunity_verdict text,
  add column if not exists opportunity_score real,
  add column if not exists screening_reason text,
  add column if not exists analysis_details jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'harmony_signals_support_availability_check'
      and conrelid = 'public.harmony_signals'::regclass
  ) then
    alter table public.harmony_signals add constraint harmony_signals_support_availability_check
      check (support_availability in ('UNKNOWN', 'NO_PUBLIC_SUPPORT_FOUND', 'BUILD_TARGET_ONLY', 'PARTIAL', 'USABLE'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'harmony_signals_support_provenance_check'
      and conrelid = 'public.harmony_signals'::regclass
  ) then
    alter table public.harmony_signals add constraint harmony_signals_support_provenance_check
      check (support_provenance in ('UNKNOWN', 'UPSTREAM', 'OFFICIAL_ECOSYSTEM', 'COMMUNITY'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'harmony_signals_support_coverage_check'
      and conrelid = 'public.harmony_signals'::regclass
  ) then
    alter table public.harmony_signals add constraint harmony_signals_support_coverage_check
      check (support_coverage in ('UNKNOWN', 'BUILD_ONLY', 'CORE_ONLY', 'SUBMODULE', 'FULL'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'harmony_signals_support_confidence_check'
      and conrelid = 'public.harmony_signals'::regclass
  ) then
    alter table public.harmony_signals add constraint harmony_signals_support_confidence_check
      check (support_confidence between 0 and 1);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'analysis_opportunity_verdict_check'
      and conrelid = 'public.analysis'::regclass
  ) then
    alter table public.analysis add constraint analysis_opportunity_verdict_check
      check (opportunity_verdict is null or opportunity_verdict in (
        'HIGH_VALUE', 'PROMISING', 'LOW_VALUE', 'NO_CLEAR_OPPORTUNITY', 'INSUFFICIENT_EVIDENCE'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'analysis_opportunity_score_check'
      and conrelid = 'public.analysis'::regclass
  ) then
    alter table public.analysis add constraint analysis_opportunity_score_check
      check (opportunity_score is null or opportunity_score between 0 and 100);
  end if;
end $$;

comment on column public.harmony_signals.support_availability is
  '证据推导的支持现状；UNKNOWN 与 NO_PUBLIC_SUPPORT_FOUND 严格区分';
comment on column public.harmony_signals.support_evidence is
  '结构化状态证据 [{source,kind,reference,strength}]';
comment on column public.analysis.opportunity_verdict is
  '鸿蒙生态结合机会结论；NO_CLEAR_OPPORTUNITY 是正常有效结果';
comment on column public.analysis.opportunity_score is
  '0-100：最佳可信机会 + 10% 第二机会；不以机会数量取胜';
comment on column public.analysis.analysis_details is
  '技术尽调正文：架构、移植面、生态替代、决策条件、历史结论复核与否决项';

drop view if exists public.repo_board;

create view public.repo_board
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
  order by (a2.prompt_version like 'p11%') desc, a2.tier desc, a2.analyzed_at desc nulls last, a2.created_at desc
  limit 1
) a on true
left join public.categories pc on pc.id = a.category_id
left join public.categories sc on sc.id = a.subcategory_id
left join public.harmony_signals hs on hs.repository_id = r.id
left join public.harmony_overrides o on o.repository_id = r.id
left join public.deepwiki_analysis d on d.repository_id = r.id;

grant select on public.repo_board to anon, authenticated;
