'use client';
import { useEffect, useRef, useState } from 'react';
import { ProTable, type ProColumns, type ActionType } from '@ant-design/pro-components';
import {
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Input,
  Select,
  List,
  Pagination,
  Spin,
  Flex,
} from 'antd';
import Link from 'next/link';
import { HARMONY_STATE_LABELS, HARMONY_STATES, type HarmonyState } from '@/lib/types';
import { fetchBoard, fetchLanguages, type BoardRow } from '@/lib/queries';
import { loadCategoryTree, getTopCategories } from '@/lib/category/loader';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import { useBoardData } from '@/lib/hooks/use-board-data';
import HarmonyBadge from '@/components/HarmonyBadge';
import ArchivedTag from '@/components/ArchivedTag';
import ScoreBar from '@/components/ScoreBar';
import NotConfigured from '@/components/NotConfigured';

// ─── 移动端卡片 ────────────────────────────────────────────────────────────

function BoardCard({
  row,
  categoryNameMap,
}: {
  row: BoardRow;
  categoryNameMap: Record<string, string>;
}) {
  return (
    <List.Item style={{ padding: 0, borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ padding: '10px 4px', width: '100%' }}>
        <Flex align="center" gap={6} wrap>
          {row.rank != null && (
            <Typography.Text strong style={{ color: row.rank <= 3 ? '#fa8c16' : undefined }}>
              #{row.rank}
            </Typography.Text>
          )}
          <Link href={{ pathname: '/repo', query: { full: row.full_name } }}>
            <Typography.Text
              strong
              style={row.is_archived ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
            >
              {row.full_name}
            </Typography.Text>
          </Link>
          <ArchivedTag archived={row.is_archived} reason={row.archived_reason} />
        </Flex>
        {row.description && (
          <Typography.Text
            type="secondary"
            style={{ display: 'block', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}
          >
            {row.description}
          </Typography.Text>
        )}
        <Flex align="center" gap={4} wrap style={{ marginTop: 6 }}>
          {row.primary_language && <Tag>{row.primary_language}</Tag>}
          {(() => {
            const name = row.category_name || categoryNameMap[row.category ?? ''] || row.category;
            return name ? <Tag color="blue">{name}</Tag> : null;
          })()}
          <HarmonyBadge state={row.effective_state} reviewed={row.reviewed} />
        </Flex>
        <Flex align="center" justify="space-between" style={{ marginTop: 6 }}>
          <Typography.Text style={{ color: '#faad14', fontSize: 13 }}>
            ⭐ {row.stars.toLocaleString()}
          </Typography.Text>
          {row.priority_score != null && <ScoreBar score={row.priority_score} />}
        </Flex>
      </div>
    </List.Item>
  );
}

function MobileBoard({
  excludeAdapted,
  setExcludeAdapted,
  excludeArchived,
  setExcludeArchived,
  categoryEnum,
  categoryNameMap,
  languageEnum,
}: {
  excludeAdapted: boolean;
  setExcludeAdapted: (v: boolean) => void;
  excludeArchived: boolean;
  setExcludeArchived: (v: boolean) => void;
  categoryEnum: Record<string, { text: string }>;
  categoryNameMap: Record<string, string>;
  languageEnum: Record<string, { text: string }>;
}) {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [effectiveState, setEffectiveState] = useState<HarmonyState | undefined>();
  const [language, setLanguage] = useState<string | undefined>();
  const pageSize = 20;

  const { data, total, loading } = useBoardData({
    page,
    pageSize,
    orderBy: 'rank',
    orderAsc: true,
    filters: {
      keyword: keyword || undefined,
      category,
      effectiveState,
      language,
      excludeAdapted,
      excludeArchived,
    },
  });

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
        <Flex gap={8} wrap>
          <Select
            placeholder="分类"
            allowClear
            style={{ flex: 1, minWidth: 120 }}
            value={category}
            onChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
            options={Object.entries(categoryEnum).map(([k, v]) => ({ label: v.text, value: k }))}
          />
          <Select
            placeholder="鸿蒙状态"
            allowClear
            style={{ flex: 1, minWidth: 120 }}
            value={effectiveState}
            onChange={(v) => {
              setEffectiveState(v);
              setPage(1);
            }}
            options={HARMONY_STATES.map((s) => ({ label: HARMONY_STATE_LABELS[s], value: s }))}
          />
          <Select
            placeholder="语言"
            allowClear
            style={{ flex: 1, minWidth: 120 }}
            value={language}
            onChange={(v) => {
              setLanguage(v);
              setPage(1);
            }}
            options={Object.entries(languageEnum).map(([k, v]) => ({ label: v.text, value: k }))}
          />
        </Flex>
        <Flex align="center" gap={8} wrap>
          <Flex align="center" gap={4}>
            <Switch
              size="small"
              checked={excludeArchived}
              onChange={setExcludeArchived}
            />
            <Typography.Text style={{ fontSize: 12 }}>排除归档</Typography.Text>
          </Flex>
          <Flex align="center" gap={4}>
            <Switch
              size="small"
              checked={excludeAdapted}
              onChange={setExcludeAdapted}
            />
            <Typography.Text style={{ fontSize: 12 }}>排除已鸿蒙</Typography.Text>
          </Flex>
        </Flex>
        <List
          dataSource={data}
          locale={{ emptyText: '无数据' }}
          renderItem={(row) => (
            <BoardCard row={row} categoryNameMap={categoryNameMap} />
          )}
        />
        <Pagination
          current={page}
          total={total}
          pageSize={pageSize}
          onChange={(p) => setPage(p)}
          size="small"
          showSizeChanger={false}
          style={{ textAlign: 'center' }}
        />
      </Space>
    </Spin>
  );
}

// ─── 桌面端表格 ──────────────────────────────────────────────────────────────

function DesktopBoard({
  categoryEnum,
  categoryNameMap,
  languageEnum,
}: {
  categoryEnum: Record<string, { text: string }>;
  categoryNameMap: Record<string, string>;
  languageEnum: Record<string, { text: string }>;
}) {
  const actionRef = useRef<ActionType>();
  const keywordRef = useRef('');
  const [keyword, setKeyword] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  const onKeywordChange = (v: string) => {
    setKeyword(v);
    keywordRef.current = v;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => actionRef.current?.reload(), 300);
  };

  const columns: ProColumns<BoardRow>[] = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 70,
      sorter: true,
      render: (_, r) => r.rank ?? '-',
    },
    {
      title: '项目',
      dataIndex: 'full_name',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Link href={{ pathname: '/repo', query: { full: r.full_name } }}>
            <Typography.Text strong style={r.is_archived ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
              {r.full_name}
            </Typography.Text>
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
      filters: Object.entries(languageEnum).map(([k, v]) => ({ text: v.text, value: k })),
      filterSearch: true,
      filterMultiple: false,
      render: (_, r) => (r.primary_language ? <Tag>{r.primary_language}</Tag> : '-'),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 130,
      filters: Object.entries(categoryEnum).map(([k, v]) => ({ text: v.text, value: k })),
      filterSearch: true,
      filterMultiple: false,
      render: (_, r) => {
        const name = r.category_name || categoryNameMap[r.category ?? ''] || r.category;
        return name ? <Tag color="blue">{name}</Tag> : '-';
      },
    },
    {
      title: '鸿蒙状态',
      dataIndex: 'effective_state',
      width: 120,
      filters: HARMONY_STATES.map((s) => ({ text: HARMONY_STATE_LABELS[s], value: s })),
      filterMultiple: false,
      render: (_, r) => <HarmonyBadge state={r.effective_state} reviewed={r.reviewed} />,
    },
    {
      title: '归档',
      dataIndex: 'is_archived',
      width: 100,
      filters: [
        { text: '已归档', value: 'true' },
        { text: '未归档', value: 'false' },
      ],
      filterMultiple: false,
      render: (_, r) =>
        r.is_archived ? (
          <ArchivedTag archived={r.is_archived} reason={r.archived_reason} />
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      title: 'Star',
      dataIndex: 'stars',
      width: 100,
      sorter: true,
      defaultSortOrder: 'descend',
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
      sorter: true,
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
      scroll={{ x: 1100 }}
      search={false}
      toolBarRender={() => [
        <Input.Search
          key="keyword"
          placeholder="搜索项目名"
          allowClear
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          onSearch={() => actionRef.current?.reload()}
          style={{ width: 240 }}
        />,
      ]}
      pagination={{
        defaultPageSize: 100,
        pageSizeOptions: [100, 200, 500, 1000],
        showSizeChanger: true,
        showTotal: (t) => `共 ${t.toLocaleString()} 条`,
      }}
      request={async (params, sort, filter) => {
        try {
          const sortField = sort && Object.keys(sort).length > 0 ? Object.keys(sort)[0] : undefined;
          const sortDir = sortField ? sort[sortField] : undefined;
          const orderBy = sortField ?? 'stars';
          const orderAsc = sortDir === 'ascend';

          const language = filter?.primary_language?.[0] as string | undefined;
          const category = filter?.category?.[0] as string | undefined;
          const effectiveState = filter?.effective_state?.[0] as HarmonyState | undefined;
          const archVal = filter?.is_archived?.[0] as string | undefined;
          const archived =
            archVal === 'true' ? true
            : archVal === 'false' ? false
            : undefined;

          const { data, total } = await fetchBoard({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 100,
            orderBy,
            orderAsc,
            filters: {
              keyword: keywordRef.current || undefined,
              category,
              effectiveState,
              language,
              archived,
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

export default function BoardPage() {
  const isMobile = useIsMobile();
  const [excludeAdapted, setExcludeAdapted] = useState(true);
  const [excludeArchived, setExcludeArchived] = useState(true);
  const [categoryEnum, setCategoryEnum] = useState<Record<string, { text: string }>>({});
  const [categoryNameMap, setCategoryNameMap] = useState<Record<string, string>>({});
  const [languageEnum, setLanguageEnum] = useState<Record<string, { text: string }>>({});

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    loadCategoryTree(getSupabase()).then((tree) => {
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
    fetchLanguages().then((langs) => {
      const langMap: Record<string, { text: string }> = {};
      for (const l of langs) langMap[l] = { text: l };
      setLanguageEnum(langMap);
    }).catch(console.error);
  }, []);

  if (!isSupabaseConfigured()) return <NotConfigured />;

  if (isMobile) {
    return (
      <MobileBoard
        excludeAdapted={excludeAdapted}
        setExcludeAdapted={setExcludeAdapted}
        excludeArchived={excludeArchived}
        setExcludeArchived={setExcludeArchived}
        categoryEnum={categoryEnum}
        categoryNameMap={categoryNameMap}
        languageEnum={languageEnum}
      />
    );
  }

  return (
    <DesktopBoard
      categoryEnum={categoryEnum}
      categoryNameMap={categoryNameMap}
      languageEnum={languageEnum}
    />
  );
}
