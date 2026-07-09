// ============================================================================
// 分类解析:将 LLM 输出的 category/subcategory slug 解析为数据库 ID。
// 如果 LLM 提议了新分类,则自动创建并返回新 ID。
// ============================================================================
import type { CategoryTreeNode } from '@/lib/types';
import { findBySlug, findOrCreateSubcategory, createCategory } from '@/lib/category/loader';

export interface LlmCategoryOutput {
  category: string;
  subcategory: string;
  propose_new_category: boolean;
  new_category: {
    parent_slug: string;
    subcategory_slug: string;
    subcategory_name_cn: string;
  } | null;
}

export interface ResolvedCategory {
  category_id: number | null;
  subcategory_id: number | null;
  created_new: boolean;
}

/**
 * 仅用内存分类树解析 slug → ID(不创建新分类)。
 * 适用于前端/只读场景。
 */
export function resolveCategoryFromTree(
  tree: CategoryTreeNode[],
  output: LlmCategoryOutput,
): { category_id: number | null; subcategory_id: number | null } {
  // 解析顶层分类
  const parent = findBySlug(tree, output.category);
  if (!parent || parent.parent_id !== null) {
    // slug 不匹配或不是顶层分类
    return { category_id: null, subcategory_id: null };
  }

  // 解析子分类
  if (output.subcategory) {
    const sub = findBySlug(tree, output.subcategory);
    if (sub && sub.parent_id === parent.id) {
      return { category_id: parent.id, subcategory_id: sub.id };
    }
  }

  return { category_id: parent.id, subcategory_id: null };
}

/**
 * 解析分类并处理新分类提议。需要 admin client(service_role)。
 * 适用于 pipeline 脚本。
 */
export async function resolveAndCreateCategory(
  adminClient: ReturnType<typeof import('@/lib/supabase/admin').getAdminClient>,
  tree: CategoryTreeNode[],
  output: LlmCategoryOutput,
): Promise<ResolvedCategory> {
  // 先尝试从已有分类解析
  if (!output.propose_new_category) {
    const resolved = resolveCategoryFromTree(tree, output);
    return { ...resolved, created_new: false };
  }

  // LLM 提议了新分类
  const proposal = output.new_category;
  if (!proposal) {
    // propose_new_category=true 但没给详情,回退到已有分类
    const resolved = resolveCategoryFromTree(tree, { ...output, propose_new_category: false });
    return { ...resolved, created_new: false };
  }

  // 确认顶层分类存在
  const parent = findBySlug(tree, proposal.parent_slug);
  if (!parent || parent.parent_id !== null) {
    // 无效的父分类,回退
    const resolved = resolveCategoryFromTree(tree, {
      category: proposal.parent_slug,
      subcategory: '',
      propose_new_category: false,
      new_category: null,
    });
    return { ...resolved, created_new: false };
  }

  try {
    // 尝试查找或创建子分类
    const subId = await findOrCreateSubcategory(
      adminClient,
      proposal.parent_slug,
      proposal.subcategory_slug,
      proposal.subcategory_name_cn,
    );

    // 刷新树缓存以包含新分类
    const { clearCategoryCache } = await import('@/lib/category/loader');
    clearCategoryCache();

    return {
      category_id: parent.id,
      subcategory_id: subId,
      created_new: true,
    };
  } catch (err) {
    console.error(`创建新分类失败: ${String(err)}`);
    // 回退到已有分类
    const resolved = resolveCategoryFromTree(tree, {
      category: proposal.parent_slug,
      subcategory: '',
      propose_new_category: false,
      new_category: null,
    });
    return { ...resolved, created_new: false };
  }
}
