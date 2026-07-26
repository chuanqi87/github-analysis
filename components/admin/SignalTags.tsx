'use client';
import { Space, Tag, Tooltip, Typography } from 'antd';
import type { BoardRow } from '@/lib/queries';

/** DeepWiki 证据分级 → 标签样式。只有 dedicated_port 是正面证据。 */
const SCOPE_TAG: Record<string, { color: string; text: string; tip: string }> = {
  dedicated_port: {
    color: 'green',
    text: 'DW:专门实现',
    tip: 'DeepWiki 在仓库里找到了专门的鸿蒙实现(独立目录/ArkTS 源码/oh-package 工程)',
  },
  build_target_only: {
    color: 'orange',
    text: 'DW:仅构建目标',
    tip: '鸿蒙只是构建/平台矩阵里的一项,无专门实现 —— 不构成适配证据',
  },
  incidental_mention: {
    color: 'default',
    text: 'DW:偶然提及',
    tip: '只在文档/注释/changelog 里出现 —— 不构成适配证据',
  },
};

/**
 * 自动信号标签(ohpm / oh-package / .ets / 底表 / 关键词分 / DeepWiki 证据)。
 *
 * 人工标记是权威,所以这里的价值在于让审核人一眼看清「自动判断凭什么」——
 * 尤其要把 DeepWiki 的弱证据显式标成弱,避免被当成适配依据。
 */
export default function SignalTags({ r }: { r: BoardRow }) {
  const tags: string[] = [];
  if (r.ohpm_matched) tags.push('ohpm✓');
  if (r.has_oh_package) tags.push('oh-package✓');
  if (r.has_ets) tags.push('.ets✓');
  if (r.in_registry) tags.push('底表✓');
  if ((r.keyword_score ?? 0) > 0) tags.push(`kw:${(r.keyword_score ?? 0).toFixed(2)}`);

  const scope = r.deepwiki_harmony_scope;
  const scopeTag = scope && scope !== 'none' ? SCOPE_TAG[scope] : undefined;
  const pathCount = r.deepwiki_harmony_paths?.length ?? 0;

  if (tags.length === 0 && !scopeTag) {
    return <Typography.Text type="secondary">无信号</Typography.Text>;
  }

  return (
    <Space size={4} wrap>
      {tags.map((t) => (
        <Tag key={t} color="cyan">
          {t}
        </Tag>
      ))}
      {scopeTag && (
        <Tooltip
          title={
            <>
              {scopeTag.tip}
              {pathCount > 0 && (
                <>
                  <br />
                  命中路径:{r.deepwiki_harmony_paths!.slice(0, 5).join('、')}
                </>
              )}
            </>
          }
        >
          <Tag color={scopeTag.color}>{scopeTag.text}</Tag>
        </Tooltip>
      )}
    </Space>
  );
}
