'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  List,
  Row,
  Col,
  Spin,
  Empty,
  Progress,
  Divider,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
} from '@ant-design/icons';
import { ARCHIVED_REASON_LABELS, type ArchivedReason } from '@/lib/types';
import { fetchRepoByFullName, type BoardRow } from '@/lib/queries';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { triggerGitHubWorkflow } from '@/lib/github/actions';
import { GH_TRIGGER_TOKEN, GH_ACTIONS_URL } from '@/lib/config';
import HarmonyBadge from '@/components/HarmonyBadge';
import NotConfigured from '@/components/NotConfigured';
import Tier3Analysis from '@/components/Tier3Analysis';
import DeepwikiFacts from '@/components/DeepwikiFacts';
import EvidenceBadge from '@/components/EvidenceBadge';
import ProjectIntro from '@/components/ProjectIntro';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';

const DIFF_COLOR: Record<string, string> = { low: 'green', medium: 'gold', high: 'red' };

function pct(v: number | null | undefined): number {
  return Math.round((v ?? 0) * 100);
}

function BreakdownItem({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <Descriptions.Item label={label}>
      <Progress percent={pct(value)} size="small" style={{ maxWidth: 200 }} />
    </Descriptions.Item>
  );
}

function RepoDetail() {
  const params = useSearchParams();
  const full = params.get('full');
  const isMobile = useIsMobile();
  const [row, setRow] = useState<BoardRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured() || !full) {
      setLoading(false);
      return;
    }
    fetchRepoByFullName(full)
      .then(setRow)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [full]);

  const handleTriggerAnalysis = async () => {
    if (!row) return;
    setTriggering(true);
    try {
      const result = await triggerGitHubWorkflow('analyze-single.yml', {
        repo_id: String(row.id),
        force: 'true',
      });
      if (result.success) {
        message.success(
          <span>
            分析任务已触发，请前往{' '}
            <a href={GH_ACTIONS_URL} target="_blank" rel="noreferrer">
              Actions 页面
            </a>{' '}
            查看进度
          </span>,
          8,
        );
      } else {
        message.error(result.message);
      }
    } catch (e) {
      message.error(`触发失败: ${(e as Error).message}`);
    } finally {
      setTriggering(false);
    }
  };

  if (!isSupabaseConfigured()) return <NotConfigured />;
  if (loading) return <Spin />;
  if (!row) return <Empty description={`未找到项目 ${full ?? ''}`} />;

  const b = row.breakdown;
  const archivedReason = row.archived_reason
    ? ARCHIVED_REASON_LABELS[row.archived_reason as ArchivedReason]
    : '已归档';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {row.is_archived && (
        <Alert
          type="warning"
          showIcon
          icon={<span>📦</span>}
          message={`该项目已被归档 (${archivedReason}),无需进行适配分析`}
          banner
        />
      )}

      <Card size={isMobile ? 'small' : 'default'} styles={isMobile ? { body: { padding: 12 } } : undefined}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Flex align="center" wrap="wrap" gap={8} justify="space-between" style={{ width: '100%' }}>
            <Space align="center" wrap>
              <Typography.Title level={isMobile ? 4 : 3} style={{ margin: 0, wordBreak: 'break-all' }}>
                <a href={`https://github.com/${row.full_name}`} target="_blank" rel="noreferrer">
                  {row.full_name}
                </a>
              </Typography.Title>
              <HarmonyBadge state={row.effective_state} reviewed={row.reviewed} />
              <EvidenceBadge level={row.evidence_level} />
              {row.is_archived && (
                <Tooltip title={archivedReason}>
                  <Tag color="default">📦 已归档</Tag>
                </Tooltip>
              )}
              {row.category && <Tag color="blue">{row.category_name || row.category}</Tag>}
              {row.subcategory_name && <Tag>{row.subcategory_name}</Tag>}
            </Space>
            {GH_TRIGGER_TOKEN && !row.is_archived && (
              <Popconfirm
                title="触发全面分析"
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text>将对该项目运行完整分析管道：</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      元数据富化 → DeepWiki 代码事实 → 鸿蒙信号采集 → README 获取 → LLM 分类/评估 → 深度分析 → 评分
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      任务将在 GitHub Actions 后台运行，预计 5-15 分钟完成。
                    </Typography.Text>
                  </Space>
                }
                onConfirm={handleTriggerAnalysis}
                okText="确认触发"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={triggering}
                  size="small"
                >
                  触发全面分析
                </Button>
              </Popconfirm>
            )}
          </Flex>
          <ProjectIntro row={row} size="full" />
          <Space wrap>
            <Tag>★ {row.stars.toLocaleString()}</Tag>
            {row.primary_language && <Tag>{row.primary_language}</Tag>}
            {row.license && <Tag>{row.license}</Tag>}
            {(row.topics ?? []).slice(0, 8).map((t) => (
              <Tag key={t} color="geekblue">
                {t}
              </Tag>
            ))}
          </Space>
          {row.override_note && (
            <Typography.Text type="secondary">审核备注:{row.override_note}</Typography.Text>
          )}
        </Space>
      </Card>

      <DeepwikiFacts row={row} />

      <Row gutter={[8, 8]}>
        <Col xs={24} md={12}>
          <Card title="鸿蒙化信号(辅助人工审核)" size="small">
            <Space size={6} wrap>
              <Tag color={row.ohpm_matched ? 'green' : 'default'}>
                ohpm 中心仓 {row.ohpm_matched ? '命中' : '未命中'}
              </Tag>
              <Tag color={row.has_oh_package ? 'green' : 'default'}>oh-package.json5</Tag>
              <Tag color={row.has_build_profile ? 'green' : 'default'}>build-profile</Tag>
              <Tag color={row.has_ets ? 'green' : 'default'}>ArkTS/.ets</Tag>
              <Tag color={row.in_registry ? 'green' : 'default'}>三方库底表</Tag>
              <Tag>关键词 {row.keyword_score?.toFixed(2) ?? '0'}</Tag>
            </Space>
            {row.source_repo_url && (
              <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
                适配仓:
                <a href={row.source_repo_url} target="_blank" rel="noreferrer">
                  {row.source_repo_url}
                </a>
              </Typography.Paragraph>
            )}
            {row.ohpm_packages?.length ? (
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                ohpm 包:{row.ohpm_packages.map((p) => p.pkg).join(', ')}
              </Typography.Paragraph>
            ) : null}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="适配优先级构成" size="small">
            {b ? (
              <Descriptions column={1} size="small">
                <BreakdownItem label="热度 popularity" value={b.popularity} />
                <BreakdownItem label="趋势 velocity" value={b.velocity} />
                <BreakdownItem label="移动相关 mobileRelevance" value={b.mobileRelevance} />
                <BreakdownItem label="工作量逆 effortInv" value={b.effortInv} />
                <BreakdownItem label="生态缺口 ecosystemGap" value={b.ecosystemGap} />
                <Descriptions.Item label="可行性乘子 feasibility">
                  {b.feasibility.toFixed(2)}
                </Descriptions.Item>
                <Descriptions.Item label="适配门控 adaptedGate">
                  {b.adaptedGate.toFixed(2)}
                </Descriptions.Item>
                <Descriptions.Item label="最终优先级">
                  <Typography.Text strong>{b.priorityScore.toFixed(1)}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Empty description="暂无评分(等待评分阶段)" />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="LLM 适配评估" size="small">
        {row.analysis_tier ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small">
              <Descriptions.Item label="推荐路径">
                {row.recommended_approach ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="分析层级">
                {row.analysis_tier === 3 ? '代码深析' : row.analysis_tier === 2 ? '深度评估' : '粗分类'}
              </Descriptions.Item>
              <Descriptions.Item label="移动相关度">{pct(row.mobile_relevance)}%</Descriptions.Item>
              <Descriptions.Item label="可行性">{pct(row.feasibility)}%</Descriptions.Item>
              <Descriptions.Item label="工作量(越高越难)">
                {pct(row.effort_estimate)}%
              </Descriptions.Item>
              <Descriptions.Item label="生态缺口">{pct(row.ecosystem_gap)}%</Descriptions.Item>
            </Descriptions>

            {row.adaptation_points?.length ? (
              <List
                header={<Typography.Text strong>适配点</Typography.Text>}
                size="small"
                dataSource={row.adaptation_points}
                renderItem={(p) => (
                  <List.Item>
                    <Space align="start">
                      <Tag color={DIFF_COLOR[p.difficulty] ?? 'default'}>{p.difficulty}</Tag>
                      <div>
                        <Typography.Text strong>{p.area}</Typography.Text>
                        <br />
                        <Typography.Text type="secondary">{p.description}</Typography.Text>
                        {p.harmony_value && (
                          <Typography.Paragraph style={{ margin: '4px 0 0' }}>
                            <Typography.Text strong>鸿蒙契合：</Typography.Text>{p.harmony_value}
                          </Typography.Paragraph>
                        )}
                        <Space size={[4, 4]} wrap>
                          {p.integration_form && <Tag color="blue">{p.integration_form}</Tag>}
                          {p.target_devices?.map((device) => <Tag key={device}>{device}</Tag>)}
                          {p.target_kits?.map((kit) => <Tag key={kit} color="cyan">{kit}</Tag>)}
                        </Space>
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            ) : null}

            {row.reasoning && (
              <Card size="small" type="inner" title="评估理由">
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {row.reasoning}
                </Typography.Paragraph>
              </Card>
            )}
          </Space>
        ) : (
          <Empty description={row.is_archived ? '已归档,无需 LLM 分析' : '暂无 LLM 分析(等待分析阶段)'} />
        )}
      </Card>

      {/* Tier-3 代码深度分析 */}
      {!row.is_archived && (
        <>
          <Divider orientation="left" style={{ margin: '8px 0' }}>
            Agent 深度分析
          </Divider>
          <Tier3Analysis repositoryId={row.id} />
        </>
      )}
    </Space>
  );
}

export default function RepoPage() {
  return (
    <Suspense fallback={<Spin />}>
      <RepoDetail />
    </Suspense>
  );
}
