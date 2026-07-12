'use client';
import { useEffect, useRef, useState } from 'react';
import { ProTable, type ProColumns, type ActionType } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Pagination,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  Row,
  Col,
} from 'antd';
import {
  ReloadOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  RocketOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import {

  HARMONY_STATE_LABELS,
  HARMONY_STATES,
  ARCHIVED_REASON_LABELS,
  type HarmonyState,
  type ArchivedReason,
} from '@/lib/types';
import {
  fetchBoard,
  fetchRepoStats,
  fetchPipelineRuns,
  triggerGitHubWorkflow,
  upsertOverride,
  type BoardRow,
  type BoardFilters,
  type RepoStats,
  type PipelineRun,
} from '@/lib/queries';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';
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

// ─── 移动端卡片列表 ──────────────────────────────────────────────────────────

function AdminCard({
  row,
  onMark,
}: {
  row: BoardRow;
  onMark: (r: BoardRow) => void;
}) {
  return (
    <List.Item style={{ padding: 0, borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ padding: '10px 4px', width: '100%' }}>
        <Space align="center" size={4} wrap>
          <Link href={{ pathname: '/repo', query: { full: row.full_name } }}>
            <Typography.Text
              strong
              style={row.is_archived ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
            >
              {row.full_name}
            </Typography.Text>
          </Link>
          <ArchivedTag row={row} />
        </Space>
        {row.description && (
          <Typography.Text
            type="secondary"
            style={{ display: 'block', fontSize: 12, marginTop: 2, lineHeight: 1.4 }}
          >
            {row.description}
          </Typography.Text>
        )}
        <Space size={4} wrap style={{ marginTop: 6 }}>
          {row.is_archived ? (
            <Tag color="default">📦 归档</Tag>
          ) : row.analysis_tier != null ? (
            <Tag color="green">已分析</Tag>
          ) : (
            <Tag color="default">待分析</Tag>
          )}
          <Typography.Text style={{ color: '#faad14', fontSize: 13 }}>
            ⭐ {row.stars?.toLocaleString() ?? '-'}
          </Typography.Text>
          {row.primary_language && <Tag>{row.primary_language}</Tag>}
          {(() => {
            const name = row.category_name || row.category;
            return name ? <Tag color="blue">{name}</Tag> : null;
          })()}
        </Space>
        <div style={{ marginTop: 6 }}>
          <SignalTags r={row} />
        </div>
        <Flex align="center" justify="space-between" style={{ marginTop: 8 }}>
          <Space size={6} wrap>
            {row.harmony_suggestion && <HarmonyBadge state={row.harmony_suggestion} />}
            {row.override_state ? (
              <HarmonyBadge state={row.override_state} reviewed />
            ) : (
              <Tag>待审核</Tag>
            )}
            {row.source_repo_url && (
              <a href={row.source_repo_url} target="_blank" rel="noreferrer">
                适配仓
              </a>
            )}
          </Space>
          <Button type="primary" size="small" onClick={() => onMark(row)}>
            标记
          </Button>
        </Flex>
      </div>
    </List.Item>
  );
}

function MobileAdminList({
  analysisFilter,
  setAnalysisFilter,
  openMark,
  reloadKey,
}: {
  analysisFilter: AnalysisFilter;
  setAnalysisFilter: (v: AnalysisFilter) => void;
  openMark: (r: BoardRow) => void;
  reloadKey: number;
}) {
  const [data, setData] = useState<BoardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const pageSize = 20;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const filters: BoardFilters = { keyword: keyword || undefined };
        if (analysisFilter === 'analyzed') filters.analysisStatus = 'analyzed';
        else if (analysisFilter === 'unanalyzed') filters.analysisStatus = 'unanalyzed';
        else if (analysisFilter === 'archived') filters.archived = true;

        const { data, total } = await fetchBoard({
          page,
          pageSize,
          orderBy: 'stars',
          orderAsc: false,
          filters,
        });
        if (!cancelled) {
          setData(data);
          setTotal(total);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, keyword, analysisFilter, reloadKey]);

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input.Search
          placeholder="搜索项目名"
          allowClear
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <Segmented
          block
          value={analysisFilter}
          onChange={(v) => {
            setAnalysisFilter(v as AnalysisFilter);
            setPage(1);
          }}
          options={[
            { label: '全部', value: 'all' },
            { label: '已分析', value: 'analyzed' },
            { label: '待分析', value: 'unanalyzed' },
            { label: '归档', value: 'archived' },
          ]}
        />
        <List
          dataSource={data}
          locale={{ emptyText: '无数据' }}
          renderItem={(row) => <AdminCard row={row} onMark={openMark} />}
        />
        <Pagination
          current={page}
          total={total}
          pageSize={pageSize}
          onChange={setPage}
          size="small"
          showSizeChanger={false}
          style={{ textAlign: 'center' }}
        />
      </Space>
    </Spin>
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

function PipelineCard() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);

  const loadRuns = async () => {
    setLoadingRuns(true);
    try {
      const data = await fetchPipelineRuns(15);
      setRuns(data);
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
        // 延迟刷新运行记录
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

  const workflows = [
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
  ];

  const statusColors: Record<string, string> = {
    running: 'processing',
    success: 'success',
    failed: 'error',
  };

  const runColumns = [
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
      render: (v: string) => (
        <Tag color={statusColors[v] ?? 'default'}>{v}</Tag>
      ),
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      width: 180,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
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
        {workflows.map((wf, i) => (
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
                  onClick={() => handleTrigger(wf.id, wf.label, wf.inputs)}
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

      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: 16 }}
        labelStyle={{ fontWeight: 500 }}
      >
        <Descriptions.Item label="提示">
          <Typography.Text type="secondary">
            触发后任务将在 GitHub Actions 中运行，请前往{' '}
            <a
              href={`https://github.com/${process.env.NEXT_PUBLIC_GH_REPO || 'chuanqi87/github-analysis'}/actions`}
              target="_blank"
              rel="noreferrer"
            >
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
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadRuns}
            loading={loadingRuns}
          >
            刷新
          </Button>
        }
      >
        <Table<PipelineRun>
          rowKey="id"
          dataSource={runs}
          columns={runColumns}
          loading={loadingRuns}
          pagination={false}
          size="small"
          scroll={{ x: 600 }}
        />
      </Card>
    </Card>
  );
}

function StatsCards({ stats }: { stats: RepoStats | null }) {
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
          <Statistic
            title="待分析"
            value={stats.unanalyzed}
            valueStyle={{ color: '#cf1322' }}
          />
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

export default function AdminPage() {
  const actionRef = useRef<ActionType>();
  const isMobile = useIsMobile();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [form] = Form.useForm();
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [stats, setStats] = useState<RepoStats | null>(null);
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
      <Flex align="center" justify="space-between" wrap gap={8} style={{ marginBottom: 12 }}>
        <Typography.Text ellipsis style={{ minWidth: 0, flex: 1 }}>
          当前:{email}
        </Typography.Text>
        {adminEmail && email !== adminEmail && (
          <Alert type="warning" showIcon message="账户与配置邮箱不一致" banner />
        )}
        <Button size="small" onClick={() => getSupabase().auth.signOut()}>
          退出
        </Button>
      </Flex>

      <StatsCards stats={stats} />

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
            const sortDir = sort ? sort[sortField!] : undefined;
            const orderBy = sortField ?? 'stars';
            const orderAsc = sortDir === 'ascend';

            const filters: BoardFilters = { keyword: params.keyword };
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
