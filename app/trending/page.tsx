'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Tag, Typography, Spin, Empty, Input, Select, Segmented, Space, Tooltip, List, Flex } from 'antd';
import Link from 'next/link';
import { fetchLatestTrendingDate, fetchTrending, type TrendingRow } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import NotConfigured from '@/components/NotConfigured';

function TrendingCard({ r }: { r: TrendingRow }) {
  const colors = ['gold', 'silver', '#cd7f32'];
  return (
    <List.Item style={{ padding: 0, borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ padding: '10px 4px', width: '100%' }}>
        <Flex align="center" gap={6} wrap>
          {r.rank != null && (
            <Typography.Text strong style={r.rank <= 3 ? { color: colors[r.rank - 1] } : undefined}>
              #{r.rank}
            </Typography.Text>
          )}
          <Link href={{ pathname: '/repo', query: { full: r.repo_name } }}>
            <Typography.Text strong>{r.repo_name}</Typography.Text>
          </Link>
        </Flex>
        {r.description && (
          <Typography.Text
            type="secondary"
            style={{ display: 'block', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}
          >
            {r.description.length > 100 ? r.description.slice(0, 100) + '...' : r.description}
          </Typography.Text>
        )}
        <Flex align="center" gap={4} wrap style={{ marginTop: 6 }}>
          {r.primary_language && <Tag>{r.primary_language}</Tag>}
          {r.source.split(',').map((s) => (
            <Tag key={s.trim()} color={s.trim() === 'ossinsight' ? 'blue' : 'purple'}>
              {s.trim()}
            </Tag>
          ))}
          {r.repository_id == null ? (
            <Tag color="default">新</Tag>
          ) : r.analysis_tier == null ? (
            <Tag color="default">在库·未分析</Tag>
          ) : (
            <Tag color="green">
              已分析{r.category_name && <span style={{ opacity: 0.8 }}> · {r.category_name}</span>}
            </Tag>
          )}
        </Flex>
        <Flex align="center" justify="space-between" style={{ marginTop: 6 }}>
          <Typography.Text strong style={{ color: '#faad14', fontSize: 13 }}>
            ⭐ {r.stars != null ? (r.stars >= 1000 ? `${(r.stars / 1000).toFixed(1)}k` : r.stars.toLocaleString()) : '-'}
          </Typography.Text>
          <Space size={8}>
            {r.weeks_on_trending != null && r.weeks_on_trending > 0 && (
              <Tag color={r.weeks_on_trending >= 4 ? 'red' : r.weeks_on_trending >= 2 ? 'orange' : 'default'}>
                {r.weeks_on_trending} 周
              </Tag>
            )}
            {r.total_score != null && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                热度 {r.total_score.toFixed(3)}
              </Typography.Text>
            )}
          </Space>
        </Flex>
      </div>
    </List.Item>
  );
}

export default function TrendingPage() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<TrendingRow[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<string>('all');

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const d = await fetchLatestTrendingDate();
        setDate(d);
        if (d) setRows(await fetchTrending(d));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 提取唯一的语言列表
  const languages = useMemo(() => {
    const langs = new Set<string>();
    for (const r of rows) {
      if (r.primary_language) langs.add(r.primary_language);
    }
    return Array.from(langs).sort();
  }, [rows]);

  // 提取唯一的来源列表(处理逗号分隔的多来源)
  const sources = useMemo(() => {
    const srcs = new Set<string>();
    for (const r of rows) {
      for (const s of r.source.split(',')) {
        srcs.add(s.trim());
      }
    }
    return Array.from(srcs).sort();
  }, [rows]);

  // 过滤数据
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (keyword && !r.repo_name.toLowerCase().includes(keyword.toLowerCase())) return false;
      if (language && r.primary_language !== language) return false;
      // 来源过滤:检查逗号分隔的来源中是否包含选中的来源
      if (source !== 'all') {
        const rowSources = r.source.split(',').map((s) => s.trim());
        if (!rowSources.includes(source)) return false;
      }
      return true;
    });
  }, [rows, keyword, language, source]);

  if (!isSupabaseConfigured()) return <NotConfigured />;

  return (
    <Spin spinning={loading}>
      <Card
        title={
          <span>
            每周热点趋势{' '}
            {date && <Typography.Text type="secondary">(本周: {date})</Typography.Text>}
            {rows.length > 0 && (
              <Tag color="orange" style={{ marginLeft: 8 }}>
                Top {rows.length}
              </Tag>
            )}
          </span>
        }
      >
        {!loading && rows.length === 0 ? (
          <Empty description="暂无热点数据(等待每周 workflow 运行)" />
        ) : (
          <>
            <Space wrap style={{ marginBottom: 16 }}>
              <Input.Search
                placeholder="搜索项目名称"
                allowClear
                style={{ width: isMobile ? '100%' : 240 }}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Select
                placeholder="语言"
                allowClear
                style={{ width: isMobile ? '100%' : 150 }}
                value={language}
                onChange={setLanguage}
                options={languages.map((l) => ({ label: l, value: l }))}
              />
              <Segmented
                value={source}
                onChange={(v) => setSource(v as string)}
                options={[
                  { label: '全部来源', value: 'all' },
                  ...sources.map((s) => ({ label: s, value: s })),
                ]}
              />
              <Typography.Text type="secondary">
                共 {filteredRows.length} / {rows.length} 条
              </Typography.Text>
            </Space>
            {isMobile ? (
              <List
                dataSource={filteredRows}
                locale={{ emptyText: '无数据' }}
                renderItem={(r) => <TrendingCard r={r} />}
              />
            ) : (
            <Table<TrendingRow>
              rowKey="id"
              dataSource={filteredRows}
              pagination={false}
              columns={[
                {
                  title: '排名',
                  dataIndex: 'rank',
                  width: 70,
                  sorter: (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
                  defaultSortOrder: 'ascend',
                  render: (v: number | null) => {
                    if (v == null) return '-';
                    const colors = ['gold', 'silver', '#cd7f32'];
                    const color = v <= 3 ? colors[v - 1] : undefined;
                    return (
                      <Typography.Text strong style={color ? { color } : undefined}>
                        #{v}
                      </Typography.Text>
                    );
                  },
                },
                {
                  title: '项目',
                  dataIndex: 'repo_name',
                  render: (v: string, r) => (
                    <div>
                      <Link href={{ pathname: '/repo', query: { full: v } }}>
                        <Typography.Text strong>{v}</Typography.Text>
                      </Link>
                      {r.description && (
                        <div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {r.description.length > 80
                              ? r.description.slice(0, 80) + '...'
                              : r.description}
                          </Typography.Text>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: '语言',
                  dataIndex: 'primary_language',
                  width: 110,
                  render: (v) => (v ? <Tag>{v}</Tag> : '-'),
                  filters: languages.map((l) => ({ text: l, value: l })),
                  onFilter: (value, record) => record.primary_language === value,
                },
                {
                  title: '来源',
                  dataIndex: 'source',
                  width: 160,
                  render: (v: string) => (
                    <Space size={4} wrap>
                      {v.split(',').map((s) => (
                        <Tag
                          key={s.trim()}
                          color={s.trim() === 'ossinsight' ? 'blue' : 'purple'}
                        >
                          {s.trim()}
                        </Tag>
                      ))}
                    </Space>
                  ),
                },
                {
                  title: '分析状态',
                  width: 140,
                  render: (_, r) => {
                    // 不在库中 → 新项目
                    if (r.repository_id == null) {
                      return <Tag color="default">新</Tag>;
                    }
                    // 在库中但未分析
                    if (r.analysis_tier == null) {
                      return <Tag color="default">在库·未分析</Tag>;
                    }
                    // 已分析
                    return (
                      <Tooltip
                        title={
                          <div>
                            <div>分析层级: Tier {r.analysis_tier}</div>
                            {r.category_name && <div>分类: {r.category_name}</div>}
                            {r.effective_state && <div>状态: {r.effective_state}</div>}
                          </div>
                        }
                      >
                        <Tag color="green">
                          已分析
                          {r.category_name && (
                            <span style={{ marginLeft: 4, opacity: 0.8 }}>
                              · {r.category_name}
                            </span>
                          )}
                        </Tag>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: 'Star',
                  dataIndex: 'stars',
                  width: 100,
                  sorter: (a, b) => (a.stars ?? 0) - (b.stars ?? 0),
                  render: (v) => {
                    if (v == null) return '-';
                    const num = Number(v);
                    const formatted = num >= 1000 
                      ? `${(num / 1000).toFixed(1)}k` 
                      : num.toLocaleString();
                    return (
                      <Typography.Text strong style={{ color: '#faad14' }}>
                        ⭐ {formatted}
                      </Typography.Text>
                    );
                  },
                },
                {
                  title: '上榜周数',
                  dataIndex: 'weeks_on_trending',
                  width: 100,
                  sorter: (a, b) => (a.weeks_on_trending ?? 0) - (b.weeks_on_trending ?? 0),
                  render: (v) => {
                    if (v == null || v === 0) return '-';
                    const color = v >= 4 ? 'red' : v >= 2 ? 'orange' : 'default';
                    return (
                      <Tag color={color}>
                        {v} 周
                      </Tag>
                    );
                  },
                },
                {
                  title: '热度分',
                  dataIndex: 'total_score',
                  width: 100,
                  sorter: (a, b) => (a.total_score ?? 0) - (b.total_score ?? 0),
                  render: (v) => (v == null ? '-' : Number(v).toFixed(3)),
                },
              ]}
            />
            )}
          </>
        )}
      </Card>
    </Spin>
  );
}
