'use client';
import { useEffect, useState } from 'react';
import { Card, Table, Progress, Spin } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { CATEGORY_LABELS, type RepoCategory } from '@/lib/types';
import { fetchCategoryStats, type CategoryStat } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import NotConfigured from '@/components/NotConfigured';

function label(cat: string): string {
  return CATEGORY_LABELS[cat as RepoCategory] ?? cat;
}

export default function CategoriesPage() {
  const [rows, setRows] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    fetchCategoryStats()
      .then((d) => setRows(d.sort((a, b) => b.total - a.total)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (!isSupabaseConfigured()) return <NotConfigured />;

  const chartData = rows.map((r) => ({
    name: label(r.category),
    数量: r.total,
    均分: Number((r.avg_priority ?? 0).toFixed(1)),
  }));

  return (
    <Spin spinning={loading}>
      <Card title="各分类项目数量与平均适配优先级" style={{ marginBottom: 16 }}>
        <div style={{ width: '100%', height: 360 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ left: 8, right: 8, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={60} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="数量" fill="#1677ff" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="分类明细">
        <Table<CategoryStat>
          rowKey="category"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '分类', dataIndex: 'category', render: (v) => label(v) },
            { title: '项目数', dataIndex: 'total', sorter: (a, b) => a.total - b.total },
            {
              title: '平均优先级',
              dataIndex: 'avg_priority',
              render: (v) => (v ?? 0).toFixed(1),
              sorter: (a, b) => (a.avg_priority ?? 0) - (b.avg_priority ?? 0),
            },
            { title: '已鸿蒙化', dataIndex: 'adapted' },
            { title: '未适配', dataIndex: 'not_adapted' },
            {
              title: '鸿蒙化率',
              render: (_, r) => {
                const rate = r.total ? Math.round((r.adapted / r.total) * 100) : 0;
                return <Progress percent={rate} size="small" style={{ maxWidth: 160 }} />;
              },
            },
          ]}
        />
      </Card>
    </Spin>
  );
}
