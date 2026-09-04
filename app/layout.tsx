import '@/app/globals.css';
import type { Metadata, Viewport } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: '鸿蒙生态适配分析看板',
  description: 'GitHub Top 项目的鸿蒙支持现状与生态结合机会分析',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#1677ff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <AppShell>{children}</AppShell>
        </AntdRegistry>
      </body>
    </html>
  );
}
