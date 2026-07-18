'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Col, Descriptions, Row, Space, Table, Tag, Typography, message } from 'antd';
import {
  ReloadOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  RocketOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { fetchPipelineRuns, type PipelineRun } from '@/lib/queries';
import { triggerGitHubWorkflow } from '@/lib/github/actions';
import { GH_ACTIONS_URL } from '@/lib/config';

const WORKFLOWS = [
  {
    id: 'analyze-daily.yml',
    label: '每日热点同步',
    icon: <ThunderboltOutlined />,
    color: 'orange',
    desc: '抓取 GitHub Trending Top10 + 增量分析',
  },
  {
    id: 'analyze-full.yml',
    label: '仓库同步（初步分析）',
    icon: <SyncOutlined />,
    color: 'blue',
    desc: '获取 Star≥10000 新仓库 + 初步分析（无 LLM）',
  },
  {
    id: 'analyze-full.yml',
    label: '全量分析（含 LLM）',
    icon: <RocketOutlined />,
    color: 'green',
    desc: '完整流程：获取 + 富化 + LLM 分类/评估',
    inputs: { stage: 'all' },
  },
  {
    id: 'code-analysis.yml',
    label: '深度代码分析',
    icon: <CodeOutlined />,
    color: 'purple',
    desc: 'Agent 阅读源码评估鸿蒙化可行性',
  },
] as const;

const STATUS_COLORS: Record<string, string> = {
  running: 'processing',
  success: 'success',
  failed: 'error',
};

const RUN_COLUMNS = [
  {
    title: '阶段',
    dataIndex: 'stage',
    width: 150,
    render: (v: string) => <Tag>{v}</Tag>,
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'default'}>{v}</Tag>,
  },
  {
    title: '开始时间',
    dataIndex: 'started_at',
    width: 180,
    render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
  },
  {
    title: '耗时',
    width: 90,
    render: (_: unknown, r: PipelineRun) => {
      if (!r.finished_at || !r.started_at) return '-';
      const ms = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60000).toFixed(1)}m`;
    },
  },
  {
    title: '统计',
    dataIndex: 'stats',
    render: (v: Record<string, unknown> | null) => {
      if (!v) return '-';
      const entries = Object.entries(v);
      if (entries.length === 0) return '-';
      return (
        <Space size={4} wrap>
          {entries.slice(0, 3).map(([k, val]) => (
            <Tag key={k} color="default">
              {k}: {String(val).slice(0, 20)}
            </Tag>
          ))}
          {entries.length > 3 && <Tag>+{entries.length - 3}</Tag>}
        </Space>
      );
    },
  },
];

/** 数据管道管理:手动触发 GitHub Actions workflow + 最近运行记录。 */
export default function PipelineCard() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);

  const loadRuns = async () => {
    setLoadingRuns(true);
    try {
      setRuns(await fetchPipelineRuns(15));
    } catch (e) {
      console.error('加载运行记录失败:', e);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  const handleTrigger = async (workflowId: string, label: string, inputs?: Record<string, string>) => {
    setTriggering(workflowId);
    try {
      const result = await triggerGitHubWorkflow(workflowId, inputs);
      if (result.success) {
        message.success(`${label} ${result.message}`);
        setTimeout(loadRuns, 3000);
      } else {
        message.error(`${label} ${result.message}`);
      }
    } catch (e) {
      message.error(`触发失败: ${(e as Error).message}`);
    } finally {
      setTriggering(null);
    }
  };

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          Pipeline 管理
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {WORKFLOWS.map((wf, i) => (
          <Col key={i} xs={24} sm={12} md={6}>
            <Card
              size="small"
              hoverable
              style={{ height: '100%' }}
              actions={[
                <Button
                  key="run"
                  type="primary"
                  size="small"
                  icon={wf.icon}
                  loading={triggering === wf.id}
                  onClick={() => handleTrigger(wf.id, wf.label, 'inputs' in wf ? wf.inputs : undefined)}
                >
                  触发
                </Button>,
              ]}
            >
              <Card.Meta
                title={<Tag color={wf.color}>{wf.label}</Tag>}
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {wf.desc}
                  </Typography.Text>
                }
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Descriptions size="small" column={1} style={{ marginBottom: 16 }} labelStyle={{ fontWeight: 500 }}>
        <Descriptions.Item label="提示">
          <Typography.Text type="secondary">
            触发后任务将在 GitHub Actions 中运行，请前往{' '}
            <a href={GH_ACTIONS_URL} target="_blank" rel="noreferrer">
              Actions 页面
            </a>{' '}
            查看详细日志。若未配置 Token，请设置环境变量 <code>NEXT_PUBLIC_GH_TRIGGER_TOKEN</code>。
          </Typography.Text>
        </Descriptions.Item>
      </Descriptions>

      <Card
        title="最近运行记录"
        size="small"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadRuns} loading={loadingRuns}>
            刷新
          </Button>
        }
      >
        <Table<PipelineRun>
          rowKey="id"
          dataSource={runs}
          columns={RUN_COLUMNS}
          loading={loadingRuns}
          pagination={false}
          size="small"
          scroll={{ x: 600 }}
        />
      </Card>
    </Card>
  );
}
