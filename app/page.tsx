'use client';
import { useEffect, useRef, useState } from 'react';
import { ProTable, type ProColumns, type ActionType } from '@ant-design/pro-components';
import { Space, Switch, Tag, Tooltip, Typography } from 'antd';
import Link from 'next/link';
import { HARMONY_STATE_LABELS, HARMONY_STATES, ARCHIVED_REASON_LABELS } from '@/lib/types';
import type { CategoryTreeNode } from '@/lib/types';
import { fetchBoard, type BoardRow } from '@/lib/queries';
import { loadCategoryTree, getTopCategories } from '@/lib/category/loader';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import HarmonyBadge from '@/components/HarmonyBadge';
import ScoreBar from '@/components/ScoreBar';
import NotConfigured from '@/components/NotConfigured';

const stateEnum = Object.fromEntries(HARMONY_STATES.map((s) => [s, { text: HARMONY_STATE_LABELS[s] }]));

function ArchivedTag({ row }: { row: BoardRow }) {
  if (!row.is_archived) return null;
  const reason = row.archived_reason ? ARCHIVED_REASON_LABELS[row.archived_reason as keyof typeof ARCHIVED_REASON_LABELS] : '已归档';
  return (
    <Tooltip title={reason}>
      <Tag color="default" style={{ opacity: 0.8 }}>
        📦 归档
      </Tag>
    </Tooltip>
  );
}

export default function BoardPage() {
  const actionRef = useRef<ActionType>();
  const [excludeAdapted, setExcludeAdapted] = useState(true);
  const [excludeArchived, setExcludeArchived] = useState(true);
  const [categoryEnum, setCategoryEnum] = useState<Record<string, { text: string }>>({});
  const [categoryNameMap, setCategoryNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    loadCategoryTree().then((tree) => {
      const tops = getTopCategories(tree);
      const enumMap: Record<string, { text: string }> = {};
      const nameMap: Record<string, string> = {};
      for (const c of tops) {
        enumMap[c.slug] = { text: c.name_cn };
        nameMap[c.slug] = c.name_cn;
      }
      setCategoryEnum(enumMap);
      setCategoryNameMap(nameMap);
    }).catch(console.error);
  }, []);

  if (!isSupabaseConfigured()) return <NotConfigured />;

  const columns: ProColumns<BoardRow>[] = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 70,
      hideInSearch: true,
      render: (_, r) => r.rank ?? '-',
    },
    {
      title: '项目',
      dataIndex: 'keyword',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Space align="center" size={4}>
            <Link href={{ pathname: '/repo', query: { full: r.full_name } }}>
              <Typography.Text strong style={r.is_archived ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                {r.full_name}
              </Typography.Text>
            </Link>
            <ArchivedTag row={r} />
          </Space>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 420 }}>
            {r.description}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '语言',
      dataIndex: 'primary_language',
      width: 110,
      render: (_, r) => (r.primary_language ? <Tag>{r.primary_language}</Tag> : '-'),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 130,
      valueType: 'select',
      valueEnum: categoryEnum,
      render: (_, r) => {
        const name = r.category_name || categoryNameMap[r.category ?? ''] || r.category;
        return name ? <Tag color="blue">{name}</Tag> : '-';
      },
    },
    {
      title: '鸿蒙状态',
      dataIndex: 'effective_state',
      width: 120,
      valueType: 'select',
      valueEnum: stateEnum,
      render: (_, r) => <HarmonyBadge state={r.effective_state} reviewed={r.reviewed} />,
    },
    {
      title: 'Star',
      dataIndex: 'stars',
      width: 90,
      hideInSearch: true,
      render: (_, r) => r.stars.toLocaleString(),
    },
    {
      title: (
        <Tooltip title="100 × 可行性 × 适配门控 × 加权(热度/移动相关/工作量/生态缺口)">
          <span>适配优先级</span>
        </Tooltip>
      ),
      dataIndex: 'priority_score',
      width: 160,
      hideInSearch: true,
      render: (_, r) => <ScoreBar score={r.priority_score} />,
    },
  ];

  return (
    <ProTable<BoardRow>
      headerTitle="鸿蒙适配优先级总榜"
      rowKey="id"
      actionRef={actionRef}
      columns={columns}
      cardBordered
      scroll={{ x: 1000 }}
      toolBarRender={() => [
        <Space key="toggle">
          <span>排除已归档</span>
          <Switch
            checked={excludeArchived}
            onChange={(v) => {
              setExcludeArchived(v);
              actionRef.current?.reload();
            }}
          />
          <span>排除已鸿蒙化</span>
          <Switch
            checked={excludeAdapted}
            onChange={(v) => {
              setExcludeAdapted(v);
              actionRef.current?.reload();
            }}
          />
        </Space>,
      ]}
      pagination={{ defaultPageSize: 20, showSizeChanger: true }}
      request={async (params) => {
        try {
          const { data, total } = await fetchBoard({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            filters: {
              keyword: params.keyword,
              category: params.category,
              effectiveState: params.effective_state,
              language: params.primary_language,
              excludeAdapted,
              excludeArchived,
            },
          });
          return { data, success: true, total };
        } catch (e) {
          console.error(e);
          return { data: [], success: false, total: 0 };
        }
      }}
    />
  );
}
