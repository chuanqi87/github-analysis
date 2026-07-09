'use client';
import { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Table, Spin } from 'antd';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { HARMONY_STATE_LABELS, type HarmonyState } from '@/lib/types';
import { fetchHarmonyStats, type HarmonyStat } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import NotConfigured from '@/components/NotConfigured';

const COLORS: Record<HarmonyState, string> = {
  ADAPTED: '#52c41a',
  PARTIAL: '#faad14',
  NOT_ADAPTED: '#1677ff',
  NOT_APPLICABLE: '#bfbfbf',
};

export default function HarmonyPage() {
  const [rows, setRows] = useState<HarmonyStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    fetchHarmonyStats()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (!isSupabaseConfigured()) return <NotConfigured />;

  const total = rows.reduce((s, r) => s + r.total, 0);
  const reviewed = rows.reduce((s, r) => s + r.reviewed, 0);
  const adapted = rows.find((r) => r.effective_state === 'ADAPTED')?.total ?? 0;
  const pieData = rows.map((r) => ({
    name: HARMONY_STATE_LABELS[r.effective_state] ?? r.effective_state,
    value: r.total,
    state: r.effective_state,
  }));

  return (
    <Spin spinning={loading}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="项目总数" value={total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已鸿蒙化" value={adapted} suffix={`/ ${total}`} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="鸿蒙化率"
              value={total ? ((adapted / total) * 100).toFixed(1) : 0}
              suffix="%"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已人工审核" value={reviewed} suffix={`/ ${total}`} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="鸿蒙化状态分布">
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} label>
                    {pieData.map((d) => (
                      <Cell key={d.state} fill={COLORS[d.state as HarmonyState] ?? '#bfbfbf'} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="明细">
            <Table<HarmonyStat>
              rowKey="effective_state"
              dataSource={rows}
              pagination={false}
              columns={[
                {
                  title: '状态',
                  dataIndex: 'effective_state',
                  render: (v) => HARMONY_STATE_LABELS[v as HarmonyState] ?? v,
                },
                { title: '数量', dataIndex: 'total' },
                { title: '已审核', dataIndex: 'reviewed' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Spin>
  );
}
