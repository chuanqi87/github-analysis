'use client';
import { useEffect, useRef, useState } from 'react';
import { ProTable, type ProColumns, type ActionType } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
  Row,
  Col,
} from 'antd';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import {

  HARMONY_STATE_LABELS,
  HARMONY_STATES,
  ARCHIVED_REASON_LABELS,
  type HarmonyState,
  type ArchivedReason,
} from '@/lib/types';
import { fetchBoard, fetchRepoStats, upsertOverride, type BoardRow, type RepoStats } from '@/lib/queries';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import HarmonyBadge from '@/components/HarmonyBadge';
import NotConfigured from '@/components/NotConfigured';

type AnalysisFilter = 'all' | 'analyzed' | 'unanalyzed' | 'archived';

function SignalTags({ r }: { r: BoardRow }) {
  const tags: string[] = [];
  if (r.ohpm_matched) tags.push('ohpm✓');
  if (r.has_oh_package) tags.push('oh-package✓');
  if (r.has_ets) tags.push('.ets✓');
  if (r.in_registry) tags.push('底表✓');
  if ((r.keyword_score ?? 0) > 0) tags.push(`kw:${(r.keyword_score ?? 0).toFixed(2)}`);
  if (tags.length === 0) return <Typography.Text type="secondary">无信号</Typography.Text>;
  return (
    <Space size={4} wrap>
      {tags.map((t) => (
        <Tag key={t} color="cyan">
          {t}
        </Tag>
      ))}
    </Space>
  );
}

function ArchivedTag({ row }: { row: BoardRow }) {
  if (!row.is_archived) return null;
  const reason = row.archived_reason
    ? ARCHIVED_REASON_LABELS[row.archived_reason as ArchivedReason]
    : '已归档';
  return (
    <Tooltip title={reason}>
      <Tag color="default">📦 归档</Tag>
    </Tooltip>
  );
}

function LoginCard({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const submit = async (v: { email: string; password: string }) => {
    setLoading(true);
    try {
      const { error } = await getSupabase().auth.signInWithPassword(v);
      if (error) throw error;
      message.success('登录成功');
      onLogin();
    } catch (e) {
      message.error(`登录失败:${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card title="管理员登录" style={{ maxWidth: 380, margin: '48px auto' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="请使用在 Supabase Auth 中创建的管理员账户登录后审核标记。"
      />
      <Form layout="vertical" onFinish={submit}>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
          <Input placeholder="admin@example.com" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          登录
        </Button>
      </Form>
    </Card>
  );
}

function StatsCards({ stats }: { stats: RepoStats | null }) {
  if (!stats) return null;
  const analyzedPct = stats.total > 0 ? ((stats.analyzed / stats.total) * 100).toFixed(1) : '0';
  const archivedPct = stats.total > 0 ? ((stats.archived / stats.total) * 100).toFixed(1) : '0';
  return (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      <Col span={6}>
        <Card>
          <Statistic title="仓库总数" value={stats.total} />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="已分析"
            value={stats.analyzed}
            suffix={<span style={{ fontSize: 14, color: '#8c8c8c' }}>({analyzedPct}%)</span>}
            valueStyle={{ color: '#3f8600' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="待分析"
            value={stats.unanalyzed}
            valueStyle={{ color: '#cf1322' }}
          />
        </Card>
      </Col>
      <Col span={6}>
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

export default function AdminPage() {
  const actionRef = useRef<ActionType>();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [form] = Form.useForm();
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [stats, setStats] = useState<RepoStats | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setReady(true);
      return;
    }
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 加载统计数据
  useEffect(() => {
    if (isSupabaseConfigured()) {
      fetchRepoStats().then(setStats).catch(console.error);
    }
  }, [analysisFilter]);

  if (!isSupabaseConfigured()) return <NotConfigured />;
  if (!ready) return null;
  if (!session) return <LoginCard onLogin={() => actionRef.current?.reload()} />;

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  const email = session.user.email ?? '';

  const openMark = (r: BoardRow) => {
    setEditing(r);
    form.setFieldsValue({
      state: r.override_state ?? r.auto_state_hint ?? 'NOT_ADAPTED',
      note: r.override_note ?? '',
    });
  };

  const saveMark = async () => {
    const v = await form.validateFields();
    if (!editing) return;
    try {
      await upsertOverride({
        repositoryId: editing.id,
        state: v.state as HarmonyState,
        note: v.note,
        markedBy: email,
      });
      message.success(`已标记 ${editing.full_name}`);
      setEditing(null);
      actionRef.current?.reload();
      fetchRepoStats().then(setStats).catch(console.error);
    } catch (e) {
      message.error(`保存失败(可能无写入权限):${(e as Error).message}`);
    }
  };

  const columns: ProColumns<BoardRow>[] = [
    {
      title: '项目',
      dataIndex: 'keyword',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Space align="center" size={4}>
            <Link href={{ pathname: '/repo', query: { full: r.full_name } }}>
              <Typography.Text strong style={r.is_archived ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                {r.full_name}
              </Typography.Text>
            </Link>
            <ArchivedTag row={r} />
          </Space>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 380 }}>
            {r.description}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '分析状态',
      dataIndex: 'analysisStatus',
      width: 110,
      hideInSearch: true,
      render: (_, r) => {
        if (r.is_archived) {
          return <Tag color="default">📦 归档</Tag>;
        }
        return r.analysis_tier != null ? (
          <Tag color="green">已分析</Tag>
        ) : (
          <Tag color="default">待分析</Tag>
        );
      },
    },
    {
      title: 'Stars',
      dataIndex: 'stars',
      width: 90,
      hideInSearch: true,
      sorter: true,
      render: (_, r) => r.stars?.toLocaleString() ?? '-',
    },
    {
      title: '语言',
      dataIndex: 'language',
      width: 100,
      hideInSearch: true,
      render: (_, r) => r.primary_language ?? '-',
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 120,
      hideInSearch: true,
      render: (_, r) => r.category_name || r.category || '-',
    },
    {
      title: '自动信号',
      dataIndex: 'signals',
      width: 200,
      hideInSearch: true,
      render: (_, r) => <SignalTags r={r} />,
    },
    {
      title: 'LLM 建议',
      dataIndex: 'harmony_suggestion',
      width: 110,
      hideInSearch: true,
      render: (_, r) => <HarmonyBadge state={r.harmony_suggestion} />,
    },
    {
      title: '当前标记',
      dataIndex: 'override_state',
      width: 110,
      hideInSearch: true,
      render: (_, r) =>
        r.override_state ? <HarmonyBadge state={r.override_state} reviewed /> : <Tag>待审核</Tag>,
    },
    {
      title: '来源',
      dataIndex: 'source_repo_url',
      width: 90,
      hideInSearch: true,
      render: (_, r) =>
        r.source_repo_url ? (
          <a href={r.source_repo_url} target="_blank" rel="noreferrer">
            适配仓
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 90,
      render: (_, r) => [
        <a key="mark" onClick={() => openMark(r)}>
          标记
        </a>,
      ],
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Text>当前:{email}</Typography.Text>
        {adminEmail && email !== adminEmail && (
          <Alert type="warning" showIcon message="当前账户与配置的管理员邮箱不一致" banner />
        )}
        <Button size="small" onClick={() => getSupabase().auth.signOut()}>
          退出
        </Button>
      </Space>

      <StatsCards stats={stats} />

      <ProTable<BoardRow>
        headerTitle="仓库管理"
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        scroll={{ x: 1400 }}
        options={{ reload: true, density: true }}
        toolBarRender={() => [
          <Segmented
            key="filter"
            options={[
              { label: '全部', value: 'all' },
              { label: '已分析', value: 'analyzed' },
              { label: '待分析', value: 'unanalyzed' },
              { label: '📦 已归档', value: 'archived' },
            ]}
            value={analysisFilter}
            onChange={(v) => {
              setAnalysisFilter(v as AnalysisFilter);
              actionRef.current?.reload();
            }}
          />,
        ]}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        request={async (params, sort) => {
          try {
            // 从 ProTable sort 参数中提取排序字段
            const sortField = sort ? Object.keys(sort)[0] : undefined;
            const sortDir = sort ? sort[sortField!] : undefined;
            const orderBy = sortField ?? 'stars';
            const orderAsc = sortDir === 'ascend';

            // 构建过滤器
            const filters: Record<string, any> = { keyword: params.keyword };
            if (analysisFilter === 'analyzed') {
              filters.analysisStatus = 'analyzed';
            } else if (analysisFilter === 'unanalyzed') {
              filters.analysisStatus = 'unanalyzed';
            } else if (analysisFilter === 'archived') {
              filters.archived = true;
            }

            const { data, total } = await fetchBoard({
              page: params.current ?? 1,
              pageSize: params.pageSize ?? 20,
              orderBy,
              orderAsc,
              filters,
            });
            return { data, success: true, total };
          } catch (e) {
            console.error(e);
            return { data: [], success: false, total: 0 };
          }
        }}
      />

      <Modal
        open={!!editing}
        title={`标记鸿蒙化状态 — ${editing?.full_name ?? ''}`}
        onCancel={() => setEditing(null)}
        onOk={saveMark}
        okText="保存"
        cancelText="取消"
      >
        {editing?.is_archived && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="该项目已被归档,通常无需分析"
          />
        )}
        <Form form={form} layout="vertical">
          <Form.Item name="state" label="鸿蒙化状态" rules={[{ required: true }]}>
            <Radio.Group>
              {HARMONY_STATES.map((s) => (
                <Radio key={s} value={s}>
                  {HARMONY_STATE_LABELS[s]}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
          <Form.Item name="note" label="备注(可选)">
            <Input.TextArea rows={3} placeholder="审核依据、适配仓链接等" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
