'use client';
import { Space, Tag, Typography } from 'antd';
import type { BoardRow } from '@/lib/queries';

/** 自动信号标签(ohpm / oh-package / .ets / 底表 / 关键词分)。 */
export default function SignalTags({ r }: { r: BoardRow }) {
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
