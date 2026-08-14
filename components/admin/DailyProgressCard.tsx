'use client';
import { Card, Col, Empty, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { DailyPipelineMetric } from '@/lib/queries';

export default function DailyProgressCard({ rows }: { rows: DailyPipelineMetric[] }) {
  const latest = rows[0];
  if (!latest) return <Card title="每日分析进展"><Empty description="等待首次 daily 管道运行" /></Card>;
  return (
    <Card title={`每日分析进展 · ${latest.metric_date}`} style={{ marginBottom: 16 }}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={4}><Statistic title="今日新发现" value={latest.discovered_today} /></Col>
        <Col xs={12} md={4}><Statistic title="今日初筛" value={latest.preliminary_today} valueStyle={{ color: '#1677ff' }} /></Col>
        <Col xs={12} md={4}><Statistic title="今日深评" value={latest.deep_today} valueStyle={{ color: '#722ed1' }} /></Col>
        <Col xs={12} md={4}><Statistic title="代码深析" value={latest.tier3_today} valueStyle={{ color: '#13c2c2' }} /></Col>
        <Col xs={12} md={4}><Statistic title="热点入池" value={latest.trending_promoted} valueStyle={{ color: '#fa8c16' }} /></Col>
        <Col xs={12} md={4}><Statistic title="失败" value={latest.failed_count} valueStyle={{ color: latest.failed_count ? '#cf1322' : '#3f8600' }} /></Col>
      </Row>
      <Typography.Text type="secondary">
        当前积压：初筛 {latest.preliminary_backlog.toLocaleString()} · 深评 {latest.deep_backlog.toLocaleString()} · 深析 {latest.tier3_backlog.toLocaleString()}
      </Typography.Text>
      <Table
        rowKey="metric_date"
        size="small"
        pagination={false}
        style={{ marginTop: 12 }}
        dataSource={rows.slice(0, 7)}
        columns={[
          { title: '日期', dataIndex: 'metric_date' },
          { title: '新发现', dataIndex: 'discovered_today' },
          { title: '初筛', dataIndex: 'preliminary_today' },
          { title: '深评', dataIndex: 'deep_today' },
          { title: '代码深析', dataIndex: 'tier3_today' },
          { title: '热点入池', dataIndex: 'trending_promoted' },
          { title: '结果', dataIndex: 'failed_count', render: (v: number) => v ? <Tag color="red">{v} 失败</Tag> : <Tag color="green">正常</Tag> },
        ]}
        scroll={{ x: 700 }}
      />
    </Card>
  );
}
