'use client';
import { Tag, Tooltip } from 'antd';
import { ARCHIVED_REASON_LABELS, type ArchivedReason } from '@/lib/types';

/** 归档标记。archived 为 false 时不渲染;鼠标悬停显示归档原因。 */
export default function ArchivedTag({
  archived,
  reason,
}: {
  archived: boolean;
  reason?: ArchivedReason | null;
}) {
  if (!archived) return null;
  const label = reason ? ARCHIVED_REASON_LABELS[reason] : '已归档';
  return (
    <Tooltip title={label}>
      <Tag color="default">📦 归档</Tag>
    </Tooltip>
  );
}
