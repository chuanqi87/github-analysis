'use client';
import { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Spin, Empty } from 'antd';
import Link from 'next/link';
import { fetchLatestTrendingDate, fetchTrending, type TrendingRow } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import NotConfigured from '@/components/NotConfigured';

export default function TrendingPage() {
  const [rows, setRows] = useState<TrendingRow[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (!isSupabaseConfigured()) return <NotConfigured />;

  return (
    <Spin spinning={loading}>
      <Card
        title={
          <span>
            每日热点趋势{' '}
            {date && <Typography.Text type="secondary">({date})</Typography.Text>}
          </span>
        }
      >
        {!loading && rows.length === 0 ? (
          <Empty description="暂无热点数据(等待每日 workflow 运行)" />
        ) : (
          <Table<TrendingRow>
            rowKey="id"
            dataSource={rows}
            pagination={{ pageSize: 30 }}
            columns={[
              { title: '排名', dataIndex: 'rank', width: 70 },
              {
                title: '项目',
                dataIndex: 'repo_name',
                render: (v: string, r) => (
                  <Link href={{ pathname: '/repo', query: { full: v } }}>
                    <Typography.Text strong>{v}</Typography.Text>
                    {r.repository_id ? null : <Tag style={{ marginLeft: 6 }}>新</Tag>}
                  </Link>
                ),
              },
              {
                title: '语言',
                dataIndex: 'primary_language',
                width: 110,
                render: (v) => (v ? <Tag>{v}</Tag> : '-'),
              },
              {
                title: '来源',
                dataIndex: 'source',
                width: 130,
                render: (v) => <Tag color={v === 'ossinsight' ? 'blue' : 'purple'}>{v}</Tag>,
              },
              {
                title: 'Star',
                dataIndex: 'stars',
                width: 90,
                render: (v) => (v == null ? '-' : Number(v).toLocaleString()),
              },
              {
                title: '热度分',
                dataIndex: 'total_score',
                width: 100,
                render: (v) => (v == null ? '-' : Number(v).toFixed(1)),
              },
            ]}
          />
        )}
      </Card>
    </Spin>
  );
}
