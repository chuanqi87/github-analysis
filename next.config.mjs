/** @type {import('next').NextConfig} */

// GitHub Pages 项目站点部署在子路径(如 https://<user>.github.io/github-analytics)。
// 由 deploy workflow 注入 NEXT_PUBLIC_BASE_PATH;本地开发留空。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  // 纯静态导出 → 可托管到 GitHub Pages,运行时从 Supabase 取数,无需 Node 服务器。
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
  // antd / pro-components / rc-* 部分包需转译以兼容静态导出构建。
  transpilePackages: [
    'antd',
    '@ant-design/pro-components',
    '@ant-design/pro-layout',
    '@ant-design/pro-table',
    '@ant-design/pro-form',
    '@ant-design/pro-descriptions',
    '@ant-design/pro-card',
    '@ant-design/icons',
    '@ant-design/nextjs-registry',
    'rc-util',
    'rc-pagination',
    'rc-picker',
    'rc-table',
    'rc-tree',
    'rc-input',
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
