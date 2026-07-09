'use client';
import { useRef, useState } from 'react';
import { ProTable, type ProColumns, type ActionType } from '@ant-design/pro-components';
import { Space, Switch, Tag, Tooltip, Typography } from 'antd';
import Link from 'next/link';
import { CATEGORY_LABELS, HARMONY_STATE_LABELS, REPO_CATEGORIES, HARMONY_STATES } from '@/lib/types';
import { fetchBoard, type BoardRow } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import HarmonyBadge from '@/components/HarmonyBadge';
import ScoreBar from '@/components/ScoreBar';
import NotConfigured from '@/components/NotConfigured';

const categoryEnum = Object.fromEntries(
  REPO_CATEGORIES.map((c) => [c, { text: CATEGORY_LABELS[c] }]),
);
const stateEnum = Object.fromEntries(HARMONY_STATES.map((s) => [s, { text: HARMONY_STATE_LABELS[s] }]));

export default function BoardPage() {
  const actionRef = useRef<ActionType>();
  const [excludeAdapted, setExcludeAdapted] = useState(true);

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
          <Link href={{ pathname: '/repo', query: { full: r.full_name } }}>
            <Typography.Text strong>{r.full_name}</Typography.Text>
          </Link>
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
      render: (_, r) => (r.category ? CATEGORY_LABELS[r.category] : '-'),
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
          <span>只看未鸿蒙化</span>
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
