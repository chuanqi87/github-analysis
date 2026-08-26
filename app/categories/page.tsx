'use client';
import { useEffect, useState } from 'react';
import { Card, Table, Progress, Spin, Tag } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchCategoryStats, type CategoryStat } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import NotConfigured from '@/components/NotConfigured';

export default function CategoriesPage() {
  const isMobile = useIsMobile();
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
    name: r.category_name || r.category,
    数量: r.total,
    均分: Number((r.avg_priority ?? 0).toFixed(1)),
  }));

  return (
    <Spin spinning={loading}>
      <Card title="各分类项目数量与平均适配优先级" style={{ marginBottom: 16 }}>
        <div style={{ width: '100%', height: isMobile ? Math.max(280, chartData.length * 28) : 360 }}>
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              layout={isMobile ? 'vertical' : 'horizontal'}
              margin={isMobile ? { left: 8, right: 16, top: 8, bottom: 8 } : { left: 8, right: 8, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              {isMobile ? (
                <>
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11 }} />
                </>
              ) : (
                <>
                  <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={60} />
                  <YAxis />
                </>
              )}
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
          scroll={{ x: isMobile ? 520 : 600 }}
          size={isMobile ? 'small' : 'middle'}
          columns={[
            {
              title: '分类',
              dataIndex: 'category_name',
              render: (name: string, r) => (
                <Tag color="blue">{name || r.category}</Tag>
              ),
            },
            { title: 'Slug', dataIndex: 'category', render: (v) => <code>{v}</code>, hidden: isMobile },
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
                return <Progress percent={rate} size="small" style={{ maxWidth: isMobile ? 100 : 160 }} />;
              },
            },
          ]}
        />
      </Card>
    </Spin>
  );
}
