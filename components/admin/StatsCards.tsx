'use client';
import { Card, Col, Row, Statistic } from 'antd';
import type { RepoStats } from '@/lib/queries';

/** 仓库总量 / 已分析 / 待分析 / 已归档 四联统计卡。 */
export default function StatsCards({ stats }: { stats: RepoStats | null }) {
  if (!stats) return null;
  const analyzedPct = stats.total > 0 ? ((stats.analyzed / stats.total) * 100).toFixed(1) : '0';
  const archivedPct = stats.total > 0 ? ((stats.archived / stats.total) * 100).toFixed(1) : '0';
  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={12} md={6}>
        <Card>
          <Statistic title="仓库总数" value={stats.total} />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card>
          <Statistic
            title="已分析"
            value={stats.analyzed}
            suffix={<span style={{ fontSize: 14, color: '#8c8c8c' }}>({analyzedPct}%)</span>}
            valueStyle={{ color: '#3f8600' }}
          />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card>
          <Statistic title="待分析" value={stats.unanalyzed} valueStyle={{ color: '#cf1322' }} />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card>
          <Statistic
            title="已归档(无需分析)"
            value={stats.archived}
            suffix={<span style={{ fontSize: 14, color: '#8c8c8c' }}>({archivedPct}%)</span>}
            valueStyle={{ color: '#8c8c8c' }}
          />
        </Card>
      </Col>
    </Row>
  );
}
