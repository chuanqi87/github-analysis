'use client';
import { Alert, Card, Collapse, Descriptions, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { ApiOutlined, BranchesOutlined, LinkOutlined, PartitionOutlined } from '@ant-design/icons';
import type { BoardRow } from '@/lib/queries';
import { HARMONY_SCOPE_LABELS } from '@/lib/types';
import { PROJECT_TYPE_LABELS } from '@/lib/project-intro';
import { DEEPWIKI_BASE } from '@/lib/config';

const { Text, Paragraph } = Typography;

/** 只有 dedicated_port 是正面证据;中间两档要明确标成"不构成适配"。 */
const SCOPE_COLOR: Record<string, string> = {
  dedicated_port: 'green',
  build_target_only: 'orange',
  incidental_mention: 'default',
  none: 'default',
};

function githubBlobUrl(fullName: string, path: string): string {
  // DeepWiki 给的既有文件也有目录,GitHub 的 blob/tree 会自行重定向到正确形态
  return `https://github.com/${fullName}/blob/HEAD/${path.replace(/^\/+/, '')}`;
}

/** 路径列表 → 可点击的 GitHub 链接。这是审核人最需要的东西:直接跳去看代码。 */
function PathLinks({ fullName, paths }: { fullName: string; paths: string[] }) {
  return (
    <Space size={[4, 4]} wrap>
      {paths.map((p) => (
        <a key={p} href={githubBlobUrl(fullName, p)} target="_blank" rel="noreferrer">
          <Tag style={{ fontFamily: 'monospace', fontSize: 12, cursor: 'pointer' }}>{p}</Tag>
        </a>
      ))}
    </Space>
  );
}

export default function DeepwikiFacts({ row }: { row: BoardRow }) {
  // 未取数与未索引是两件事,分开说清楚
  if (row.deepwiki_indexed == null) {
    return <Empty description="尚未采集 DeepWiki 代码事实" />;
  }
  if (!row.deepwiki_indexed) {
    return (
      <Alert
        type="info"
        showIcon
        message="DeepWiki 未索引该仓库"
        description={
          <span>
            本仓库的结论仅基于 README 与元数据。可到{' '}
            <a href={`${DEEPWIKI_BASE}/${row.full_name}`} target="_blank" rel="noreferrer">
              DeepWiki
            </a>{' '}
            手动索引后重跑,或等待 tarball 兜底分析。
          </span>
        }
      />
    );
  }

  const scope = row.deepwiki_harmony_scope;
  const harmonyPaths = row.deepwiki_harmony_paths ?? [];
  const layerPaths = row.deepwiki_platform_layer_paths ?? [];
  const corePaths = row.deepwiki_portable_core_paths ?? [];
  const backends = row.deepwiki_platform_backends ?? [];
  const blocking = row.deepwiki_blocking_deps ?? [];

  return (
    <Card
      size="small"
      title={
        <Space>
          <PartitionOutlined />
          <span>代码事实（DeepWiki）</span>
        </Space>
      }
      extra={
        <a href={`${DEEPWIKI_BASE}/${row.full_name}`} target="_blank" rel="noreferrer">
          <LinkOutlined /> 在 DeepWiki 查看
        </a>
      }
    >
      <Descriptions size="small" column={1} bordered>
        {scope && (
          <Descriptions.Item label="鸿蒙痕迹">
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color={SCOPE_COLOR[scope] ?? 'default'}>{HARMONY_SCOPE_LABELS[scope]}</Tag>
                {scope === 'build_target_only' || scope === 'incidental_mention' ? (
                  <Tooltip title="构建矩阵里带一个 openharmony 目标、或文档里提过一句,都不代表项目做过鸿蒙适配">
                    <Text type="secondary">（不构成适配证据）</Text>
                  </Tooltip>
                ) : null}
              </Space>
              {harmonyPaths.length > 0 && <PathLinks fullName={row.full_name} paths={harmonyPaths} />}
              {row.deepwiki_harmony_quote && (
                <Paragraph
                  type="secondary"
                  style={{ margin: 0, fontSize: 12 }}
                  ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
                >
                  「{row.deepwiki_harmony_quote}」
                </Paragraph>
              )}
            </Space>
          </Descriptions.Item>
        )}

        {row.deepwiki_project_type && (
          <Descriptions.Item label="项目形态">
            {PROJECT_TYPE_LABELS[row.deepwiki_project_type] ?? row.deepwiki_project_type}
          </Descriptions.Item>
        )}

        {(row.deepwiki_languages?.length ?? 0) > 0 && (
          <Descriptions.Item label="语言构成">
            <Space size={[4, 4]} wrap>
              {row.deepwiki_languages!.map((l) => (
                <Tag key={l}>{l}</Tag>
              ))}
              {row.deepwiki_native_code_ratio != null && (
                <Text type="secondary">
                  原生代码约 {Math.round(row.deepwiki_native_code_ratio * 100)}%
                </Text>
              )}
            </Space>
          </Descriptions.Item>
        )}

        {row.deepwiki_has_platform_abstraction != null && (
          <Descriptions.Item
            label={
              <Space size={4}>
                <BranchesOutlined />
                <span>平台抽象层</span>
              </Space>
            }
          >
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color={row.deepwiki_has_platform_abstraction ? 'green' : 'default'}>
                  {row.deepwiki_has_platform_abstraction ? '有' : '无'}
                </Tag>
                {backends.length > 0 && (
                  <Tooltip title="已有多个平台后端,说明加一个鸿蒙后端有现成插槽">
                    <Text type="secondary">已有后端:{backends.join('、')}</Text>
                  </Tooltip>
                )}
              </Space>
              {layerPaths.length > 0 && <PathLinks fullName={row.full_name} paths={layerPaths} />}
            </Space>
          </Descriptions.Item>
        )}

        {corePaths.length > 0 && (
          <Descriptions.Item label="可移植核心">
            <PathLinks fullName={row.full_name} paths={corePaths} />
          </Descriptions.Item>
        )}

        {blocking.length > 0 && (
          <Descriptions.Item
            label={
              <Space size={4}>
                <ApiOutlined />
                <span>阻塞依赖</span>
              </Space>
            }
          >
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {blocking.map((d) => (
                <div key={d.name}>
                  <Tag color="volcano">{d.name}</Tag>
                  {d.why && <Text type="secondary" style={{ fontSize: 12 }}>{d.why}</Text>}
                </div>
              ))}
            </Space>
          </Descriptions.Item>
        )}
      </Descriptions>

      {row.deepwiki_toc && (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
          items={[
            {
              key: 'toc',
              label: '模块地图',
              children: (
                <pre
                  style={{
                    margin: 0,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 320,
                    overflow: 'auto',
                  }}
                >
                  {row.deepwiki_toc}
                </pre>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
