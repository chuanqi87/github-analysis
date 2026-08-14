-- DeepWiki 同一仓库只保留一行，因此必须记录缓存深度并保证 deep 不被后续 evidence/toc 覆盖。
alter table deepwiki_analysis add column if not exists depth text not null default 'evidence'
  check (depth in ('toc', 'evidence', 'deep'));
alter table deepwiki_analysis add column if not exists source_pushed_at timestamptz;

update deepwiki_analysis d
set depth = case
  when d.extra is not null and d.extra <> '{}'::jsonb then 'deep'
  when d.harmony_scope is not null or d.project_type is not null then 'evidence'
  else 'toc'
end,
source_pushed_at = r.pushed_at
from repositories r
where r.id = d.repository_id and d.source_pushed_at is null;

comment on column deepwiki_analysis.depth is 'toc < evidence < deep；高深度缓存不得被低深度任务覆盖';
comment on column deepwiki_analysis.source_pushed_at is '取证时仓库最新提交时间；提交未变化时可复用不低于请求深度的缓存';
