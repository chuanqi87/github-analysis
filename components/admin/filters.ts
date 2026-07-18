import type { BoardFilters } from '@/lib/queries';

/** 管理台的分析状态过滤维度。 */
export type AnalysisFilter = 'all' | 'analyzed' | 'unanalyzed' | 'archived';

/** 把管理台的 AnalysisFilter + 关键词映射为 BoardFilters(桌面表格与移动列表共用)。 */
export function buildAdminFilters(analysisFilter: AnalysisFilter, keyword?: string): BoardFilters {
  const filters: BoardFilters = { keyword: keyword || undefined };
  if (analysisFilter === 'analyzed') filters.analysisStatus = 'analyzed';
  else if (analysisFilter === 'unanalyzed') filters.analysisStatus = 'unanalyzed';
  else if (analysisFilter === 'archived') filters.archived = true;
  return filters;
}
