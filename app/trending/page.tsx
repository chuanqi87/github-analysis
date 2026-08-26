'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Tag, Typography, Spin, Empty, Input, Select, Segmented, Space, Tooltip, Flex } from 'antd';
import Link from 'next/link';
import { fetchLatestTrendingDate, fetchTrending, type TrendingRow } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import NotConfigured from '@/components/NotConfigured';
import ProjectIntro from '@/components/ProjectIntro';

/** 紧凑计数:1234 → 1.2k */
function formatCount(v: number | null | undefined): string {
  if (v == null) return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

/** 本周新增 star:带符号,和总量区分开 */
function StarDelta({ v, size = 13 }: { v: number | null | undefined; size?: number }) {
  if (v == null) return <Typography.Text type="secondary">-</Typography.Text>;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Typography.Text strong style={{ color: n > 0 ? '#52c41a' : '#999', fontSize: size }}>
      {n > 0 ? '+' : ''}
      {n.toLocaleString()}
    </Typography.Text>
  );
}

/** 快照周期(周一)→ 该周的起止日期,用于表头说明「近一周」到底是哪一周 */
function weekRange(monday: string): string {
  const start = new Date(`${monday}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return monday;
  const end = new Date(start.getTime() + 6 * 86400_000);
  return `${monday} ~ ${end.toISOString().slice(0, 10)}`;
}

/** 该快照是否就是当前这一周(UTC 周一为界) */
function isCurrentWeek(monday: string): boolean {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10) === monday;
}

function repoNameOf(full: string): string {
  const i = full.lastIndexOf('/');
  return i >= 0 ? full.slice(i + 1) : full;
}

function TrendingCard({ r }: { r: TrendingRow }) {
  const colors = ['gold', 'silver', '#cd7f32'];
  return (
    <div className="trending-page__item">
      <Flex align="flex-start" gap={10} style={{ width: '100%' }}>
        {r.rank != null && (
          <Typography.Text
            strong
            style={{
              fontSize: 18,
              lineHeight: '24px',
              minWidth: 36,
              color: r.rank <= 3 ? colors[r.rank - 1] : '#8c8c8c',
            }}
          >
            #{r.rank}
          </Typography.Text>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={{ pathname: '/repo', query: { full: r.repo_name } }}>
            <Typography.Text strong style={{ fontSize: 15, wordBreak: 'break-all' }}>
              {r.repo_name}
            </Typography.Text>
          </Link>
          <ProjectIntro
            row={{
              name: repoNameOf(r.repo_name),
              full_name: r.repo_name,
              description: r.description,
              category_name: r.category_name,
              subcategory_name: r.subcategory_name,
              primary_language: r.primary_language,
              project_summary_cn: r.project_summary_cn,
              reasoning: r.reasoning,
            }}
          />
          <Flex align="center" gap={4} wrap style={{ marginTop: 8 }}>
            {r.primary_language && <Tag style={{ margin: 0 }}>{r.primary_language}</Tag>}
            {r.repository_id == null ? (
              <Tag color="default" style={{ margin: 0 }}>新</Tag>
            ) : r.analysis_tier == null ? (
              <Tag color="default" style={{ margin: 0 }}>在库·未分析</Tag>
            ) : (
              <Tag color="green" style={{ margin: 0 }}>
                已分析{r.category_name && <span> · {r.category_name}</span>}
              </Tag>
            )}
            {r.weeks_on_trending != null && r.weeks_on_trending > 0 && (
              <Tag
                color={r.weeks_on_trending >= 4 ? 'red' : r.weeks_on_trending >= 2 ? 'orange' : 'default'}
                style={{ margin: 0 }}
              >
                上榜 {r.weeks_on_trending} 周
              </Tag>
            )}
          </Flex>
          <Flex align="center" justify="space-between" style={{ marginTop: 8 }}>
            <Space size={12}>
              <Typography.Text strong style={{ color: '#faad14', fontSize: 14 }}>
                ⭐ {formatCount(r.stars)}
              </Typography.Text>
              <span>
                <StarDelta v={r.stars_delta} size={14} />
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                  本周
                </Typography.Text>
              </span>
            </Space>
            {r.total_score != null && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                热度 {r.total_score.toFixed(3)}
              </Typography.Text>
            )}
          </Flex>
        </div>
      </Flex>
    </div>
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

  const titleMeta = (
    <Space wrap size={8}>
      <span>每周热点趋势</span>
      {date && (
        <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
          统计周期 {weekRange(date)}
        </Typography.Text>
      )}
      {date && !isCurrentWeek(date) && (
        <Tooltip title="最新一份快照不是本周的,可能是每周 workflow 尚未运行">
          <Tag color="warning">非本周数据</Tag>
        </Tooltip>
      )}
      {rows.length > 0 && <Tag color="orange">Top {rows.length}</Tag>}
    </Space>
  );

  const filters = isMobile ? (
    <div className="compact-filters trending-page__filters">
      <Input.Search
        placeholder="搜索项目名称"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <Flex gap={8}>
        <Select
          placeholder="语言"
          allowClear
          style={{ flex: 1, minWidth: 0 }}
          value={language}
          onChange={setLanguage}
          options={languages.map((l) => ({ label: l, value: l }))}
        />
        <Select
          value={source}
          onChange={setSource}
          style={{ flex: 1, minWidth: 0 }}
          options={[
            { label: '全部来源', value: 'all' },
            ...sources.map((s) => ({ label: s, value: s })),
          ]}
        />
      </Flex>
      <Typography.Text type="secondary">
        共 {filteredRows.length} / {rows.length} 条
      </Typography.Text>
    </div>
  ) : (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search
        placeholder="搜索项目名称"
        allowClear
        style={{ width: 240 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <Select
        placeholder="语言"
        allowClear
        style={{ width: 150 }}
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
  );

  const emptyOrLoading = !loading && rows.length === 0;

  if (isMobile) {
    return (
      <Spin spinning={loading}>
        <div className="trending-page">
          <div className="trending-page__header">{titleMeta}</div>
          {emptyOrLoading ? (
            <Empty description="暂无热点数据(等待每周 workflow 运行)" style={{ padding: 32 }} />
          ) : (
            <>
              {filters}
              <div className="trending-page__list">
                {filteredRows.length === 0 ? (
                  <Empty description="无数据" style={{ padding: 24 }} />
                ) : (
                  filteredRows.map((r) => <TrendingCard key={r.id} r={r} />)
                )}
              </div>
            </>
          )}
        </div>
      </Spin>
    );
  }

  return (
    <Spin spinning={loading}>
      <Card title={titleMeta}>
        {emptyOrLoading ? (
          <Empty description="暂无热点数据(等待每周 workflow 运行)" />
        ) : (
          <>
            {filters}
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
                      <ProjectIntro
                        row={{
                          name: repoNameOf(v),
                          full_name: v,
                          description: r.description,
                          category_name: r.category_name,
                          subcategory_name: r.subcategory_name,
                          primary_language: r.primary_language,
                          project_summary_cn: r.project_summary_cn,
                          reasoning: r.reasoning,
                        }}
                      />
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
                  title: (
                    <Tooltip title="仓库当前的总 star 数">
                      <span>Star 总数</span>
                    </Tooltip>
                  ),
                  dataIndex: 'stars',
                  width: 110,
                  sorter: (a, b) => (a.stars ?? 0) - (b.stars ?? 0),
                  render: (v) =>
                    v == null ? (
                      '-'
                    ) : (
                      <Typography.Text strong style={{ color: '#faad14' }}>
                        ⭐ {formatCount(Number(v))}
                      </Typography.Text>
                    ),
                },
                {
                  title: (
                    <Tooltip title="本周(快照周期内)新增的 star 数,来自 GitHub Trending / OSS Insight 的近一周统计">
                      <span>本周新增</span>
                    </Tooltip>
                  ),
                  dataIndex: 'stars_delta',
                  width: 110,
                  sorter: (a, b) => (a.stars_delta ?? 0) - (b.stars_delta ?? 0),
                  render: (v) => <StarDelta v={v as number | null} size={14} />,
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
          </>
        )}
      </Card>
    </Spin>
  );
}
