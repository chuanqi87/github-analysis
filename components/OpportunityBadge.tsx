'use client';

import { Tag } from 'antd';
import {
  OPPORTUNITY_VERDICT_LABELS,
  type OpportunityVerdict,
} from '@/lib/types';

const COLORS: Record<OpportunityVerdict, string> = {
  HIGH_VALUE: 'magenta',
  PROMISING: 'blue',
  LOW_VALUE: 'default',
  NO_CLEAR_OPPORTUNITY: 'default',
  INSUFFICIENT_EVIDENCE: 'gold',
};

export default function OpportunityBadge({ verdict }: { verdict: OpportunityVerdict | null | undefined }) {
  if (!verdict) return null;
  return <Tag color={COLORS[verdict]}>{OPPORTUNITY_VERDICT_LABELS[verdict]}</Tag>;
}
