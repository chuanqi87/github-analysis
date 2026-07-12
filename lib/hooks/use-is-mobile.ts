'use client';
import { Grid } from 'antd';

/**
 * 判断当前视口是否为移动端(< md = 768px)。
 * 基于 antd Grid.useBreakpoint,首帧返回 false(桌面优先)避免移动端首屏闪烁。
 */
export function useIsMobile(): boolean {
  const { md } = Grid.useBreakpoint();
  return !md;
}
