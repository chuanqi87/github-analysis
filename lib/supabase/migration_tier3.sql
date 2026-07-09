-- ============================================================================
-- Tier-3 代码深度分析字段扩展
-- ============================================================================

-- 新增 tier-3 专用字段到 analysis 表
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS project_type text;
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS tech_stack jsonb;
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS dependencies_analysis jsonb;
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS key_files_analyzed text[];

-- 为 adaptation_points 添加 evidence 字段的注释说明
-- (adaptation_points 已存在为 jsonb，新结构包含 evidence 字段)

-- 添加索引优化 tier-3 查询
CREATE INDEX IF NOT EXISTS idx_analysis_tier3 ON analysis (repository_id, tier) WHERE tier = 3;

-- 更新 adaptation_points 类型注释（文档用）
COMMENT ON COLUMN analysis.adaptation_points IS 'JSON array of {area, description, difficulty, evidence}';
