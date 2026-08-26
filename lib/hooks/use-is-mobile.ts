'use client';
import { Grid } from 'antd';

/**
 * 紧凑布局断点:< lg(992px) 走手机/平板卡片布局。
 * 宽屏手机横屏(约 844px)和 iPad 竖屏也会走紧凑布局,避免桌面宽表被挤在中间。
 * 基于 antd Grid.useBreakpoint;首帧 breakpoint 未就绪时视为紧凑端,避免闪出宽表。
 */
export function useIsMobile(): boolean {
  const { lg } = Grid.useBreakpoint();
  return !lg;
}
