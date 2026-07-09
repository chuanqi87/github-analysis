'use client';
import { Result, Typography } from 'antd';

export default function NotConfigured() {
  return (
    <Result
      status="info"
      title="尚未连接 Supabase"
      subTitle="请配置 NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY 后重新构建部署。"
    >
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
        本页数据来自 Supabase;在 GitHub Actions 的 deploy workflow 注入公开环境变量即可。
      </Typography.Paragraph>
    </Result>
  );
}
