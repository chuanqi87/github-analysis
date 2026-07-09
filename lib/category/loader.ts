// ============================================================================
// 动态分类加载器:从 categories 表读取二级分类树,提供缓存和辅助函数。
// 前端(浏览器)和管道脚本(Node)共用。
// ============================================================================
import { getSupabase } from '@/lib/supabase/client';
import type { CategoryRow, CategoryTreeNode, CategoryTree } from '@/lib/types';

// ---------------------------------------------------------------------------
// 缓存:内存缓存,进程内复用(TTL 5 分钟)
// ---------------------------------------------------------------------------
let _cache: { tree: CategoryTreeNode[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

export async function loadCategoryTree(): Promise<CategoryTreeNode[]> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.tree;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('v_category_tree')
    .select('*')
    .order('parent_sort_order', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`加载分类树失败: ${error.message}`);

  _cache = { tree: (data ?? []) as CategoryTreeNode[], ts: Date.now() };
  return _cache.tree;
}

/** 清除缓存,下次调用重新加载 */
export function clearCategoryCache(): void {
  _cache = null;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 获取顶层分类列表 */
export function getTopCategories(tree: CategoryTreeNode[]): CategoryRow[] {
  return tree.filter((c) => c.parent_id === null);
}

/** 获取某个顶层分类下的子类列表 */
export function getSubCategories(tree: CategoryTreeNode[], parentSlug: string): CategoryRow[] {
  return tree.filter((c) => c.parent_slug === parentSlug);
}

/** 构建嵌套树结构 */
export function buildNestedTree(tree: CategoryTreeNode[]): CategoryTree[] {
  const parents = getTopCategories(tree);
  return parents.map((parent) => ({
    parent,
    children: tree.filter((c) => c.parent_id === parent.id),
  }));
}

/** slug → id 映射 */
export function buildSlugMap(tree: CategoryTreeNode[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of tree) {
    if (c.parent_id === null) {
      // 顶层:直接用 slug
      map.set(c.slug, c.id);
    } else {
      // 子类:用 parent_slug/subcategory_slug
      map.set(`${c.parent_slug}/${c.slug}`, c.id);
      // 也存独立 slug 以便直接查找
      map.set(c.slug, c.id);
    }
  }
  return map;
}

/** 根据 slug 查找分类 */
export function findBySlug(tree: CategoryTreeNode[], slug: string): CategoryTreeNode | undefined {
  return tree.find((c) => c.slug === slug);
}

/** 生成分类文本供 LLM prompt 使用 */
export function formatCategoryList(tree: CategoryTreeNode[]): string {
  const nested = buildNestedTree(tree);
  return nested
    .map(({ parent, children }) => {
      const subs = children.map((c) => `${c.slug}(${c.name_cn})`).join(', ');
      return `${parent.slug}(${parent.name_cn}): ${subs}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Admin 端:创建新分类(service_role,绕过 RLS)
// ---------------------------------------------------------------------------

export interface CreateCategoryInput {
  parent_slug?: string;     // 不传则创建顶层分类
  slug: string;
  name_cn: string;
  name_en?: string;
  description?: string;
}

/**
 * 创建新分类。需要 service_role 权限(通过 admin client)。
 * 返回新创建的分类 ID。
 */
export async function createCategory(
  adminClient: ReturnType<typeof getSupabase>,
  input: CreateCategoryInput,
): Promise<number> {
  let parentId: number | null = null;

  if (input.parent_slug) {
    const { data: parent, error } = await adminClient
      .from('categories')
      .select('id')
      .eq('slug', input.parent_slug)
      .is('parent_id', null)
      .maybeSingle();
    if (error) throw new Error(`查找父分类失败: ${error.message}`);
    if (!parent) throw new Error(`父分类 ${input.parent_slug} 不存在`);
    parentId = parent.id;
  }

  // 计算 sort_order:取同级最大值 + 1
  const { data: siblings } = parentId
    ? await adminClient.from('categories').select('sort_order').eq('parent_id', parentId)
    : await adminClient.from('categories').select('sort_order').is('parent_id', null);
  const maxOrder = (siblings ?? []).reduce((max, s: { sort_order: number }) => Math.max(max, s.sort_order), 0);

  const { data: inserted, error } = await adminClient
    .from('categories')
    .insert({
      parent_id: parentId,
      slug: input.slug,
      name_cn: input.name_cn,
      name_en: input.name_en ?? null,
      description: input.description ?? null,
      sort_order: maxOrder + 1,
    })
    .select('id')
    .single();
  if (error) throw new Error(`创建分类失败: ${error.message}`);

  clearCategoryCache();
  return (inserted as { id: number }).id;
}

/**
 * 查找或创建子分类。如果 slug 已存在于指定父分类下,直接返回 id。
 */
export async function findOrCreateSubcategory(
  adminClient: ReturnType<typeof getSupabase>,
  parentSlug: string,
  subSlug: string,
  subNameCn: string,
): Promise<number> {
  // 先查是否已存在
  const { data: parent } = await adminClient
    .from('categories')
    .select('id')
    .eq('slug', parentSlug)
    .is('parent_id', null)
    .maybeSingle();
  if (!parent) throw new Error(`父分类 ${parentSlug} 不存在`);

  const { data: existing } = await adminClient
    .from('categories')
    .select('id')
    .eq('parent_id', parent.id)
    .eq('slug', subSlug)
    .maybeSingle();
  if (existing) return (existing as { id: number }).id;

  // 不存在则创建
  return createCategory(adminClient, {
    parent_slug: parentSlug,
    slug: subSlug,
    name_cn: subNameCn,
  });
}
