import '@/app/globals.css';
import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: '鸿蒙生态适配分析看板',
  description: 'GitHub Top 项目的鸿蒙(HarmonyOS/OpenHarmony)适配价值分析与优先级排序',
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
