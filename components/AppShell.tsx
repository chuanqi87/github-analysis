'use client';
import { ProLayout } from '@ant-design/pro-components';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  DashboardOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  PieChartOutlined,
  FireOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';

const ROUTES = [
  { path: '/', name: '优先级总榜', icon: <DashboardOutlined /> },
  { path: '/admin', name: '仓库管理', icon: <DatabaseOutlined /> },
  { path: '/categories', name: '分类分布', icon: <AppstoreOutlined /> },
  { path: '/harmony', name: '鸿蒙化率', icon: <PieChartOutlined /> },
  { path: '/trending', name: '每周热点', icon: <FireOutlined /> },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
      <ProLayout
        title={isMobile ? '鸿蒙适配' : '鸿蒙适配分析看板'}
        logo={false}
        layout="mix"
        splitMenus={false}
        contentWidth="Fluid"
        fixedHeader
        fixSiderbar={!isMobile}
        collapsed={isMobile || undefined}
        menu={{ hideMenuWhenCollapsed: isMobile }}
        breakpoint={false}
        location={{ pathname }}
        route={{ routes: ROUTES }}
        menuItemRender={(item, dom) => <Link href={item.path ?? '/'}>{dom}</Link>}
        contentStyle={{ padding: 0 }}
        token={{
          header: { colorBgMenuItemSelected: 'rgba(22,119,255,0.1)' },
          pageContainer: {
            paddingBlockPageContainerContent: 0,
            paddingInlinePageContainerContent: 0,
          },
        }}
        avatarProps={undefined}
      >
        <div className={isMobile ? 'page-body page-body--compact' : 'page-body'}>{children}</div>
      </ProLayout>
    </ConfigProvider>
  );
}
