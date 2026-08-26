'use client';
import { Typography } from 'antd';
import { buildProjectIntro, type ProjectIntroInput } from '@/lib/project-intro';

export default function ProjectIntro({
  row,
  size = 'compact',
}: {
  row: ProjectIntroInput;
  size?: 'compact' | 'full';
}) {
  const intro = buildProjectIntro(row);
  if (size === 'full') {
    return (
      <div className="project-intro project-intro--full">
        <Typography.Text strong style={{ fontSize: 13, color: '#1677ff' }}>
          这个项目是做什么的
        </Typography.Text>
        <Typography.Paragraph style={{ margin: '6px 0 0', fontSize: 15, lineHeight: 1.75 }}>
          {intro.summary}
        </Typography.Paragraph>
        {intro.original && (
          <Typography.Paragraph
            type="secondary"
            style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5 }}
            ellipsis={{ rows: 3, expandable: true, symbol: '原文' }}
          >
            GitHub 原描述：{intro.original}
          </Typography.Paragraph>
        )}
      </div>
    );
  }

  return (
    <Typography.Paragraph
      type="secondary"
      className="project-intro project-intro--compact"
      style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}
      ellipsis={{ rows: 2 }}
    >
      {intro.summary}
    </Typography.Paragraph>
  );
}
