'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  DashboardOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  PieChartOutlined,
  FireOutlined,
} from '@ant-design/icons';

const TABS = [
  { path: '/', name: '总榜', icon: <DashboardOutlined /> },
  { path: '/admin', name: '管理', icon: <DatabaseOutlined /> },
  { path: '/categories', name: '分类', icon: <AppstoreOutlined /> },
  { path: '/harmony', name: '鸿蒙', icon: <PieChartOutlined /> },
  { path: '/trending', name: '热点', icon: <FireOutlined /> },
];

function isActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** 手机端底部五个主功能入口,替代被收起的侧栏菜单。 */
export default function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="mobile-tabbar" aria-label="主导航">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.path);
        return (
          <Link
            key={tab.path}
            href={tab.path}
            className={active ? 'mobile-tabbar__item is-active' : 'mobile-tabbar__item'}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobile-tabbar__icon">{tab.icon}</span>
            <span className="mobile-tabbar__label">{tab.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
