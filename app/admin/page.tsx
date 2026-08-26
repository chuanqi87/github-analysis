'use client';
import { useEffect, useRef, useState } from 'react';
import { ProTable, type ProColumns, type ActionType } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import { HARMONY_STATE_LABELS, HARMONY_STATES, type HarmonyState } from '@/lib/types';
import { fetchBoard, fetchDailyPipelineMetrics, fetchRepoStats, upsertOverride, type BoardRow, type DailyPipelineMetric, type RepoStats } from '@/lib/queries';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { ADMIN_EMAIL } from '@/lib/config';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
import HarmonyBadge from '@/components/HarmonyBadge';
import ArchivedTag from '@/components/ArchivedTag';
import NotConfigured from '@/components/NotConfigured';
import SignalTags from '@/components/admin/SignalTags';
import DeepwikiFacts from '@/components/DeepwikiFacts';
import StatsCards from '@/components/admin/StatsCards';
import PipelineCard from '@/components/admin/PipelineCard';
import LoginCard from '@/components/admin/LoginCard';
import DailyProgressCard from '@/components/admin/DailyProgressCard';
import MobileAdminList from '@/components/admin/MobileAdminList';
import ProjectIntro from '@/components/ProjectIntro';
import { buildAdminFilters, type AnalysisFilter } from '@/components/admin/filters';

export default function AdminPage() {
  const actionRef = useRef<ActionType>();
  const isMobile = useIsMobile();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [form] = Form.useForm();
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [dailyMetrics, setDailyMetrics] = useState<DailyPipelineMetric[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

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

  useEffect(() => {
    if (isSupabaseConfigured()) {
      fetchRepoStats().then(setStats).catch(console.error);
      fetchDailyPipelineMetrics().then(setDailyMetrics).catch(console.error);
    }
  }, [analysisFilter]);

  if (!isSupabaseConfigured()) return <NotConfigured />;
  if (!ready) return null;
  if (!session) return <LoginCard onLogin={() => actionRef.current?.reload()} />;

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
      setReloadKey((k) => k + 1);
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
            <ArchivedTag archived={r.is_archived} reason={r.archived_reason} />
          </Space>
          <ProjectIntro row={r} />
        </Space>
      ),
    },
    {
      title: '分析状态',
      dataIndex: 'analysisStatus',
      width: 110,
      hideInSearch: true,
      render: (_, r) => {
        if (r.is_archived) return <Tag color="default">📦 归档</Tag>;
        return r.analysis_tier != null ? <Tag color="green">已分析</Tag> : <Tag color="default">待分析</Tag>;
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
      <Flex align="center" justify="space-between" wrap gap={8} style={{ marginBottom: 12 }}>
        <Typography.Text ellipsis style={{ minWidth: 0, flex: 1 }}>
          当前:{email}
        </Typography.Text>
        {ADMIN_EMAIL && email !== ADMIN_EMAIL && (
          <Alert type="warning" showIcon message="账户与配置邮箱不一致" banner />
        )}
        <Button size="small" onClick={() => getSupabase().auth.signOut()}>
          退出
        </Button>
      </Flex>

      <StatsCards stats={stats} />

      <DailyProgressCard rows={dailyMetrics} />

      <PipelineCard />

      {isMobile ? (
        <MobileAdminList
          analysisFilter={analysisFilter}
          setAnalysisFilter={setAnalysisFilter}
          openMark={openMark}
          reloadKey={reloadKey}
        />
      ) : (
        <ProTable<BoardRow>
          headerTitle="仓库管理"
          rowKey="id"
          actionRef={actionRef}
          columns={columns}
          cardBordered
          scroll={{ x: 1400 }}
          // 展开即见代码证据:人工标记是权威,给审核人现成的路径与引文能显著提速
          expandable={{
            expandedRowRender: (r) => <DeepwikiFacts row={r} />,
            rowExpandable: (r) => r.deepwiki_indexed != null,
          }}
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
              const sortField = sort ? Object.keys(sort)[0] : undefined;
              const sortDir = sortField ? sort[sortField] : undefined;
              const orderBy = sortField ?? 'stars';
              const orderAsc = sortDir === 'ascend';

              const { data, total } = await fetchBoard({
                page: params.current ?? 1,
                pageSize: params.pageSize ?? 20,
                orderBy,
                orderAsc,
                filters: buildAdminFilters(analysisFilter, params.keyword),
              });
              return { data, success: true, total };
            } catch (e) {
              console.error(e);
              return { data: [], success: false, total: 0 };
            }
          }}
        />
      )}

      <Modal
        open={!!editing}
        title={`标记鸿蒙化状态 — ${editing?.full_name ?? ''}`}
        onCancel={() => setEditing(null)}
        onOk={saveMark}
        okText="保存"
        cancelText="取消"
        width={isMobile ? '90%' : 520}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
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
