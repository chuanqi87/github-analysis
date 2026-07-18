'use client';
import { useEffect, useState } from 'react';
import { fetchBoard, type BoardRow } from '@/lib/queries';

interface UseBoardDataArgs {
  page: number;
  pageSize: number;
  orderBy?: string;
  orderAsc?: boolean;
  filters: import('@/lib/queries').BoardFilters;
}

/**
 * 移动端列表数据加载:随入参变化重新拉取,内建 loading 与竞态取消。
 * reloadToken 变更也会强制刷新(用于外部触发,如标记后重载)。
 */
export function useBoardData(
  args: UseBoardDataArgs,
  reloadToken?: number,
): { data: BoardRow[]; total: number; loading: boolean } {
  const [data, setData] = useState<BoardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const key = `${JSON.stringify(args)}|${reloadToken ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchBoard(args);
        if (!cancelled) {
          setData(res.data);
          setTotal(res.total);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // key 已聚合全部依赖(args 的 JSON 快照 + reloadToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, total, loading };
}
