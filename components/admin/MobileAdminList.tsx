'use client';
import { useState } from 'react';
import { Button, Flex, Input, List, Pagination, Segmented, Space, Spin, Tag, Typography } from 'antd';
import Link from 'next/link';
import type { BoardRow } from '@/lib/queries';
import { useBoardData } from '@/lib/hooks/use-board-data';
import HarmonyBadge from '@/components/HarmonyBadge';
import ArchivedTag from '@/components/ArchivedTag';
import SignalTags from './SignalTags';
import { buildAdminFilters, type AnalysisFilter } from './filters';

function AdminCard({ row, onMark }: { row: BoardRow; onMark: (r: BoardRow) => void }) {
  const categoryName = row.category_name || row.category;
  return (
    <List.Item style={{ padding: 0, borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ padding: '10px 4px', width: '100%' }}>
        <Space align="center" size={4} wrap>
          <Link href={{ pathname: '/repo', query: { full: row.full_name } }}>
            <Typography.Text
              strong
              style={row.is_archived ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
            >
              {row.full_name}
            </Typography.Text>
          </Link>
          <ArchivedTag archived={row.is_archived} reason={row.archived_reason} />
        </Space>
        {row.description && (
          <Typography.Text
            type="secondary"
            style={{ display: 'block', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}
          >
            {row.description}
          </Typography.Text>
        )}
        <Space size={4} wrap style={{ marginTop: 6 }}>
          {row.is_archived ? (
            <Tag color="default">📦 归档</Tag>
          ) : row.analysis_tier != null ? (
            <Tag color="green">已分析</Tag>
          ) : (
            <Tag color="default">待分析</Tag>
          )}
          <Typography.Text style={{ color: '#faad14', fontSize: 13 }}>
            ⭐ {row.stars?.toLocaleString() ?? '-'}
          </Typography.Text>
          {row.primary_language && <Tag>{row.primary_language}</Tag>}
          {categoryName ? <Tag color="blue">{categoryName}</Tag> : null}
        </Space>
        <div style={{ marginTop: 6 }}>
          <SignalTags r={row} />
        </div>
        <Flex align="center" justify="space-between" style={{ marginTop: 8 }}>
          <Space size={6} wrap>
            {row.harmony_suggestion && <HarmonyBadge state={row.harmony_suggestion} />}
            {row.override_state ? (
              <HarmonyBadge state={row.override_state} reviewed />
            ) : (
              <Tag>待审核</Tag>
            )}
            {row.source_repo_url && (
              <a href={row.source_repo_url} target="_blank" rel="noreferrer">
                适配仓
              </a>
            )}
          </Space>
          <Button type="primary" size="small" onClick={() => onMark(row)}>
            标记
          </Button>
        </Flex>
      </div>
    </List.Item>
  );
}

/** 移动端仓库审核列表(搜索 + 分析状态过滤 + 分页 + 标记入口)。 */
export default function MobileAdminList({
  analysisFilter,
  setAnalysisFilter,
  openMark,
  reloadKey,
}: {
  analysisFilter: AnalysisFilter;
  setAnalysisFilter: (v: AnalysisFilter) => void;
  openMark: (r: BoardRow) => void;
  reloadKey: number;
}) {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const pageSize = 20;

  const { data, total, loading } = useBoardData(
    {
      page,
      pageSize,
      orderBy: 'stars',
      orderAsc: false,
      filters: buildAdminFilters(analysisFilter, keyword),
    },
    reloadKey,
  );

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input.Search
          placeholder="搜索项目名"
          allowClear
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <Segmented
          block
          value={analysisFilter}
          onChange={(v) => {
            setAnalysisFilter(v as AnalysisFilter);
            setPage(1);
          }}
          options={[
            { label: '全部', value: 'all' },
            { label: '已分析', value: 'analyzed' },
            { label: '待分析', value: 'unanalyzed' },
            { label: '归档', value: 'archived' },
          ]}
        />
        <List
          dataSource={data}
          locale={{ emptyText: '无数据' }}
          renderItem={(row) => <AdminCard row={row} onMark={openMark} />}
        />
        <Pagination
          current={page}
          total={total}
          pageSize={pageSize}
          onChange={setPage}
          size="small"
          showSizeChanger={false}
          style={{ textAlign: 'center' }}
        />
      </Space>
    </Spin>
  );
}
