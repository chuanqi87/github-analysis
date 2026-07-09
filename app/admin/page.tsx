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
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import {
  CATEGORY_LABELS,
  HARMONY_STATE_LABELS,
  HARMONY_STATES,
  type HarmonyState,
} from '@/lib/types';
import { fetchBoard, upsertOverride, type BoardRow } from '@/lib/queries';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import HarmonyBadge from '@/components/HarmonyBadge';
import NotConfigured from '@/components/NotConfigured';

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

export default function AdminPage() {
  const actionRef = useRef<ActionType>();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [form] = Form.useForm();

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
          <Link href={{ pathname: '/repo', query: { full: r.full_name } }}>
            <Typography.Text strong>{r.full_name}</Typography.Text>
          </Link>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 380 }}>
            {r.description}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 120,
      hideInSearch: true,
      render: (_, r) => (r.category ? CATEGORY_LABELS[r.category] : '-'),
    },
    {
      title: '自动信号',
      dataIndex: 'signals',
      width: 220,
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

      <ProTable<BoardRow>
        headerTitle="鸿蒙化人工审核"
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        cardBordered
        scroll={{ x: 1100 }}
        options={{ reload: true }}
        toolBarRender={() => [
          <Typography.Text type="secondary" key="hint">
            标记即写入 Supabase,看板即时生效
          </Typography.Text>,
        ]}
        pagination={{ defaultPageSize: 20 }}
        request={async (params) => {
          try {
            const { data, total } = await fetchBoard({
              page: params.current ?? 1,
              pageSize: params.pageSize ?? 20,
              filters: {
                keyword: params.keyword,
                reviewed: params.onlyPending ? false : undefined,
              },
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
