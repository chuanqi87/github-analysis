'use client';
import { useEffect, useState } from 'react';
import {
  Card,
  Collapse,
  Descriptions,
  Empty,
  Progress,
  Space,
  Spin,
  Tag,
  Typography,
  List,
  Row,
  Col,
} from 'antd';
import {
  CodeOutlined,
  FileSearchOutlined,
  BranchesOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { fetchTier3Analysis, type Tier3Analysis as Tier3Data } from '@/lib/queries';

const { Text, Paragraph, Title } = Typography;
const { Panel } = Collapse;

const DIFF_COLOR: Record<string, string> = { low: 'green', medium: 'gold', high: 'red' };

function pct(v: number | null | undefined): number {
  return Math.round((v ?? 0) * 100);
}

interface Props {
  repositoryId: number;
}

export default function Tier3Analysis({ repositoryId }: Props) {
  const [data, setData] = useState<Tier3Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTier3Analysis(repositoryId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [repositoryId]);

  if (loading) return <Spin />;
  if (!data) return <Empty description="暂无代码深度分析（tier-3）" />;

  const ts = data.tech_stack ?? {};
  const deps = data.dependencies_analysis ?? {};

  return (
    <Card
      title={
        <Space>
          <CodeOutlined />
          <span>代码深度分析</span>
          <Tag color="purple">Tier-3 Agent</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(data.created_at).toLocaleDateString('zh-CN')}
          </Text>
        </Space>
      }
      size="small"
    >
      <Collapse defaultActiveKey={['overview', 'adaptation']} ghost>
        {/* 项目概览 */}
        <Panel
          header={
            <Space>
              <FileSearchOutlined />
              <Text strong>项目概览</Text>
            </Space>
          }
          key="overview"
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="项目类型">
                  {data.project_type ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label="主语言">
                  {ts.primary_language ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label="总代码行数">
                  {ts.total_lines?.toLocaleString() ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label="原生代码占比">
                  {ts.native_code_ratio !== undefined
                    ? `${pct(ts.native_code_ratio)}%`
                    : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Col>
            <Col xs={24} md={12}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="技术栈描述">
                  <Text>{ts.description ?? '-'}</Text>
                </Descriptions.Item>
              </Descriptions>
              {ts.languages?.length ? (
                <Space wrap style={{ marginTop: 8 }}>
                  <Text type="secondary">语言:</Text>
                  {ts.languages.map((l) => (
                    <Tag key={l}>{l}</Tag>
                  ))}
                </Space>
              ) : null}
              {ts.frameworks?.length ? (
                <Space wrap style={{ marginTop: 8 }}>
                  <Text type="secondary">框架:</Text>
                  {ts.frameworks.map((f) => (
                    <Tag key={f} color="blue">
                      {f}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Col>
          </Row>
        </Panel>

        {/* 依赖分析 */}
        <Panel
          header={
            <Space>
              <BranchesOutlined />
              <Text strong>依赖分析</Text>
              {deps.total_deps !== undefined && (
                <Tag>{deps.total_deps} 个依赖</Tag>
              )}
            </Space>
          }
          key="deps"
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              {deps.os_specific_deps?.length ? (
                <List
                  size="small"
                  header={<Text type="warning">⚠️ 操作系统相关依赖</Text>}
                  dataSource={deps.os_specific_deps}
                  renderItem={(item) => (
                    <List.Item>
                      <Tag color="orange">{item}</Tag>
                    </List.Item>
                  )}
                />
              ) : (
                <Text type="success">✅ 无操作系统相关依赖</Text>
              )}
              {deps.hardware_deps?.length ? (
                <List
                  size="small"
                  header={<Text type="danger">🔧 硬件相关依赖</Text>}
                  dataSource={deps.hardware_deps}
                  renderItem={(item) => (
                    <List.Item>
                      <Tag color="red">{item}</Tag>
                    </List.Item>
                  )}
                  style={{ marginTop: 12 }}
                />
              ) : null}
            </Col>
            <Col xs={24} md={12}>
              {deps.easy_to_adapt?.length ? (
                <List
                  size="small"
                  header={<Text type="success">✅ 易于适配</Text>}
                  dataSource={deps.easy_to_adapt}
                  renderItem={(item) => (
                    <List.Item>
                      <Tag color="green">{item}</Tag>
                    </List.Item>
                  )}
                />
              ) : null}
              {deps.hard_to_adapt?.length ? (
                <List
                  size="small"
                  header={<Text type="warning">⚠️ 难以适配</Text>}
                  dataSource={deps.hard_to_adapt}
                  renderItem={(item) => (
                    <List.Item>
                      <Tag color="red">{item}</Tag>
                    </List.Item>
                  )}
                  style={{ marginTop: 12 }}
                />
              ) : null}
            </Col>
          </Row>
        </Panel>

        {/* 适配点（带代码证据） */}
        <Panel
          header={
            <Space>
              <BulbOutlined />
              <Text strong>适配点分析</Text>
              <Text type="secondary">
                ({data.adaptation_points?.length ?? 0} 个适配点)
              </Text>
            </Space>
          }
          key="adaptation"
        >
          <List
            size="small"
            dataSource={data.adaptation_points ?? []}
            renderItem={(ap) => (
              <List.Item style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <Space align="start" style={{ width: '100%' }}>
                  <Tag color={DIFF_COLOR[ap.difficulty] ?? 'default'} style={{ minWidth: 60 }}>
                    {ap.difficulty}
                  </Tag>
                  <div style={{ flex: 1 }}>
                    <Text strong>{ap.area}</Text>
                    <Paragraph style={{ margin: '4px 0 0' }}>{ap.description}</Paragraph>
                    {ap.evidence && (
                      <Paragraph
                        code
                        style={{
                          marginTop: 8,
                          padding: '8px 12px',
                          background: '#f5f5f5',
                          borderRadius: 4,
                          fontSize: 12,
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        📍 证据: {ap.evidence}
                      </Paragraph>
                    )}
                  </div>
                </Space>
              </List.Item>
            )}
          />
        </Panel>

        {/* 推荐路径 */}
        {data.recommended_approach && (
          <Panel
            header={
              <Space>
                <Text strong>推荐迁移路径</Text>
              </Space>
            }
            key="approach"
          >
            <Paragraph>{data.recommended_approach}</Paragraph>
          </Panel>
        )}

        {/* 分析理由 */}
        {data.reasoning && (
          <Panel
            header={
              <Space>
                <Text strong>详细分析理由</Text>
              </Space>
            }
            key="reasoning"
          >
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{data.reasoning}</Paragraph>
          </Panel>
        )}

        {/* 分析过的关键文件 */}
        {data.key_files_analyzed?.length ? (
          <Panel
            header={
              <Space>
                <Text strong>分析过的关键文件</Text>
                <Tag>{data.key_files_analyzed.length} 个文件</Tag>
              </Space>
            }
            key="files"
          >
            <Space wrap>
              {data.key_files_analyzed.map((f) => (
                <Tag key={f} color="geekblue">
                  {f}
                </Tag>
              ))}
            </Space>
          </Panel>
        ) : null}
      </Collapse>
    </Card>
  );
}
