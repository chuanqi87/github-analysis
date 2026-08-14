'use client';
import { useState } from 'react';
import { CodeOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Space, Typography, message } from 'antd';
import { GH_ACTIONS_URL } from '@/lib/config';
import { triggerGitHubWorkflow } from '@/lib/github/actions';
import { parseGitHubRepository } from '@/lib/github/repository-ref';

interface FormValues {
  repositoryUrl: string;
}

interface ManualCodeAnalysisCardProps {
  onTriggered?: () => void;
}

/** 手动指定单个 GitHub 仓库并启动源码级深度分析。 */
export default function ManualCodeAnalysisCard({ onTriggered }: ManualCodeAnalysisCardProps) {
  const [form] = Form.useForm<FormValues>();
  const [triggering, setTriggering] = useState(false);

  const submit = async ({ repositoryUrl }: FormValues) => {
    setTriggering(true);
    try {
      const repository = parseGitHubRepository(repositoryUrl);
      const result = await triggerGitHubWorkflow('code-analysis.yml', {
        repos: repository.fullName,
        limit: '1',
        skip_fallback: 'false',
      });
      if (!result.success) throw new Error(result.message);
      form.setFieldValue('repositoryUrl', repository.url);
      onTriggered?.();
      message.success(
        <span>
          已提交 {repository.fullName}，可在{' '}
          <a href={GH_ACTIONS_URL} target="_blank" rel="noreferrer">Actions</a>{' '}
          查看进度
        </span>,
        8,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '触发失败');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <CodeOutlined />
          指定仓库代码深析
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary">
        输入公开 GitHub 仓库首页地址。任务会先登记仓库，再结合 DeepWiki 索引与源码 Agent
        分析技术栈、关键文件、平台依赖和鸿蒙适配路径。
      </Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        message="源码 Agent 会下载并阅读仓库代码，通常需要数分钟，分析结果将写入仓库详情页。"
        style={{ marginBottom: 16 }}
      />
      <Form<FormValues> form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="repositoryUrl"
          label="GitHub 仓库地址"
          validateTrigger="onBlur"
          rules={[
            { required: true, message: '请输入 GitHub 仓库地址' },
            {
              validator: async (_, value) => {
                if (!value) return;
                try {
                  parseGitHubRepository(value);
                } catch (error) {
                  throw new Error(error instanceof Error ? error.message : '地址格式不正确');
                }
              },
            },
          ]}
        >
          <Input
            allowClear
            prefix={<CodeOutlined />}
            placeholder="https://github.com/facebook/react"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<CodeOutlined />} loading={triggering}>
          开始代码级深度分析
        </Button>
      </Form>
    </Card>
  );
}
