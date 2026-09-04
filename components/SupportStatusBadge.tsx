'use client';

import { Space, Tag, Tooltip } from 'antd';
import {
  SUPPORT_AVAILABILITY_LABELS,
  SUPPORT_PROVENANCE_LABELS,
  type SupportAvailability,
  type SupportProvenance,
} from '@/lib/types';

const COLORS: Record<SupportAvailability, string> = {
  UNKNOWN: 'default',
  NO_PUBLIC_SUPPORT_FOUND: 'orange',
  BUILD_TARGET_ONLY: 'gold',
  PARTIAL: 'blue',
  USABLE: 'green',
};

export default function SupportStatusBadge({
  availability,
  provenance,
  confidence,
}: {
  availability: SupportAvailability | null | undefined;
  provenance?: SupportProvenance | null;
  confidence?: number | null;
}) {
  const state = availability ?? 'UNKNOWN';
  const tooltip = [
    provenance ? SUPPORT_PROVENANCE_LABELS[provenance] : null,
    confidence == null ? null : `证据置信度 ${Math.round(confidence * 100)}%`,
  ].filter(Boolean).join(' · ');
  return (
    <Tooltip title={tooltip || undefined}>
      <Space size={2}>
        <Tag color={COLORS[state]}>{SUPPORT_AVAILABILITY_LABELS[state]}</Tag>
      </Space>
    </Tooltip>
  );
}
