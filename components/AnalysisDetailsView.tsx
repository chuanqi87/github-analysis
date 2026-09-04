'use client';

import { Collapse, Descriptions, Empty, List, Space, Tag, Typography } from 'antd';
import type { AnalysisDetails } from '@/lib/types';

const { Paragraph, Text } = Typography;

function StringList({ values }: { values: string[] }) {
  if (!values.length) return <Text type="secondary">未发现</Text>;
  return <List size="small" dataSource={values} renderItem={(item) => <List.Item>{item}</List.Item>} />;
}

export default function AnalysisDetailsView({ details }: { details: AnalysisDetails | null | undefined }) {
  if (!details) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="旧分析暂无结构化技术尽调" />;

  return (
    <Collapse
      size="small"
      defaultActiveKey={['decision', 'architecture', 'porting']}
      items={[
        {
          key: 'decision',
          label: '投入建议与决策条件',
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Tag color={details.decision.recommendation === 'INVEST' ? 'green' : details.decision.recommendation === 'REJECT' ? 'red' : 'gold'}>
                {details.decision.recommendation}
              </Tag>
              <Paragraph>{details.decision.why_now}</Paragraph>
              <Descriptions column={{ xs: 1, md: 2 }} size="small">
                <Descriptions.Item label="投入前置条件"><StringList values={details.decision.prerequisites} /></Descriptions.Item>
                <Descriptions.Item label="停止投入条件"><StringList values={details.decision.kill_criteria} /></Descriptions.Item>
              </Descriptions>
            </Space>
          ),
        },
        {
          key: 'architecture',
          label: '架构与平台边界',
          children: (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="核心模块"><StringList values={details.architecture.core_modules} /></Descriptions.Item>
              <Descriptions.Item label="平台边界"><Paragraph>{details.architecture.runtime_and_platform_boundary}</Paragraph></Descriptions.Item>
              <Descriptions.Item label="扩展入口"><StringList values={details.architecture.extension_points} /></Descriptions.Item>
              <Descriptions.Item label="代码证据"><StringList values={details.architecture.evidence_refs} /></Descriptions.Item>
            </Descriptions>
          ),
        },
        {
          key: 'porting',
          label: '移植拆解与工程验证',
          children: (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="可复用核心"><StringList values={details.porting.reusable_core} /></Descriptions.Item>
              <Descriptions.Item label="必要改动"><StringList values={details.porting.required_changes} /></Descriptions.Item>
              <Descriptions.Item label="阻塞因素"><StringList values={details.porting.blocking_dependencies} /></Descriptions.Item>
              <Descriptions.Item label="构建与测试"><Paragraph>{details.porting.build_and_test_strategy}</Paragraph></Descriptions.Item>
            </Descriptions>
          ),
        },
        {
          key: 'ecosystem',
          label: '生态价值与维护路径',
          children: (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="目标用户与场景"><StringList values={details.ecosystem.target_users_and_scenarios} /></Descriptions.Item>
              <Descriptions.Item label="现有替代"><StringList values={details.ecosystem.existing_alternatives} /></Descriptions.Item>
              <Descriptions.Item label="差异化价值"><Paragraph>{details.ecosystem.differentiated_value}</Paragraph></Descriptions.Item>
              <Descriptions.Item label="采用与维护"><Paragraph>{details.ecosystem.adoption_and_maintenance_path}</Paragraph></Descriptions.Item>
            </Descriptions>
          ),
        },
        {
          key: 'history',
          label: `历史经验复用 (${details.historical_reuse.length})`,
          children: details.historical_reuse.length ? (
            <List
              size="small"
              dataSource={details.historical_reuse}
              renderItem={(item) => (
                <List.Item>
                  <div>
                    <Text strong>{item.source_repo}</Text>
                    <Paragraph style={{ marginBottom: 4 }}>{item.reused_insight}</Paragraph>
                    <Text type="secondary">适用边界：{item.applicability}</Text>
                    {item.current_repo_evidence.length ? <Paragraph code>{item.current_repo_evidence.join('；')}</Paragraph> : null}
                  </div>
                </List.Item>
              )}
            />
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未复用历史结论" />,
        },
        {
          key: 'rejected',
          label: `已否决方案 (${details.rejected_options.length})`,
          children: <List size="small" dataSource={details.rejected_options} renderItem={(item) => (
            <List.Item>
              <div><Text strong>{item.idea}</Text><Paragraph>{item.rejection_reason}</Paragraph></div>
            </List.Item>
          )} />,
        },
      ]}
    />
  );
}
