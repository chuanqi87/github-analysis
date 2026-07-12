-- ============================================================================
-- trending_snapshots 去重:同一项目同一天只保留一条记录,source 可存逗号分隔多来源。
-- 管道脚本会在写入前做跨来源去重 + 热度排名 + Top-N 截断。
-- ============================================================================

-- 1. 清理已有重复数据:对于同天同 repo 的多条记录,保留 id 最小的
delete from trending_snapshots a
using trending_snapshots b
where a.captured_date = b.captured_date
  and a.repo_name = b.repo_name
  and a.id > b.id;

-- 2. 删除旧唯一约束(PostgreSQL 自动命名为 trending_snapshots_captured_date_source_repo_name_key)
alter table trending_snapshots drop constraint if exists trending_snapshots_captured_date_source_repo_name_key;

-- 3. 建立新唯一约束(去掉 source 列,因为去重后每个 repo 每天只有一条)
--    先删后建保证幂等(ADD CONSTRAINT 不支持 IF NOT EXISTS;已存在时抛 42P07)
alter table trending_snapshots drop constraint if exists trending_snapshots_captured_date_repo_name_key;
alter table trending_snapshots add constraint trending_snapshots_captured_date_repo_name_key unique (captured_date, repo_name);

-- 4. 列注释
comment on column trending_snapshots.source is '数据来源,多来源用逗号分隔(如 github-trending,ossinsight)';
comment on column trending_snapshots.total_score is '统一热度分(跨来源倒数排名聚合,越高越热)';
