'use client';
import { Tag, Tooltip } from 'antd';
import type { EvidenceLevel } from '@/lib/types';
import { EVIDENCE_LEVEL_LABELS } from '@/lib/types';

const COLORS: Record<EvidenceLevel, string> = {
  wiki: 'geekblue',
  toc: 'cyan',
  readme: 'default',
  none: 'default',
};

const TIPS: Record<EvidenceLevel, string> = {
  wiki: '结论基于 DeepWiki 的代码级检索:有具体文件路径与代码引文支撑',
  toc: '仅取到模块结构,未做定向代码检索',
  readme: '仅依据 README 与元数据判断,未看过代码',
  none: '既无 README 也无代码事实,置信度低',
};

/**
 * 证据强度标注。
 *
 * 刻意只做展示、不进评分公式 —— 让用户知道一条结论是"读过代码"还是"只看了 README",
 * 但不因此改动排名(那会让权重调整和证据覆盖度纠缠在一起)。
 */
export default function EvidenceBadge({ level }: { level: EvidenceLevel | null | undefined }) {
  if (!level || level === 'none') return null;
  return (
    <Tooltip title={TIPS[level]}>
      <Tag color={COLORS[level]}>{EVIDENCE_LEVEL_LABELS[level]}</Tag>
    </Tooltip>
  );
}
