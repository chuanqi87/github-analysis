'use client';
import { Tag } from 'antd';
import type { HarmonyState } from '@/lib/types';
import { HARMONY_STATE_LABELS } from '@/lib/types';

const COLORS: Record<HarmonyState, string> = {
  ADAPTED: 'green',
  PARTIAL: 'gold',
  PENDING_ADAPTATION: 'orange',
  NOT_ADAPTED: 'blue',
  NOT_APPLICABLE: 'default',
};

export default function HarmonyBadge({
  state,
  reviewed,
}: {
  state: HarmonyState | null | undefined;
  reviewed?: boolean | null;
}) {
  if (!state) return <Tag>未评估</Tag>;
  const label = HARMONY_STATE_LABELS[state];
  return (
    <Tag color={COLORS[state]}>
      {label}
      {reviewed ? ' ✓' : ''}
    </Tag>
  );
}
