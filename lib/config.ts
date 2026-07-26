// 前端(NEXT_PUBLIC_*)配置集中读取。
// Next.js 在构建期静态内联 process.env.NEXT_PUBLIC_*,故这里的常量在浏览器可用。
// 服务端专用 env(SUPABASE_SERVICE_ROLE_KEY / DASHSCOPE_* 等)保留在各自服务端模块,
// 绝不经此模块暴露到前端包。

/** 目标 GitHub 仓库(owner/name),用于 Actions 触发与跳转链接。 */
export const GH_REPO = process.env.NEXT_PUBLIC_GH_REPO || 'chuanqi87/github-analysis';

/** 触发 workflow_dispatch 的 PAT(细粒度,仅 actions:write)。未配置则无法在管理台触发。 */
export const GH_TRIGGER_TOKEN = process.env.NEXT_PUBLIC_GH_TRIGGER_TOKEN;

/** 管理员邮箱,用于管理台账户一致性提示。 */
export const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

/** GitHub Actions 运行记录页链接。 */
export const GH_ACTIONS_URL = `https://github.com/${GH_REPO}/actions`;

/** DeepWiki 站点根地址;详情页据此拼 `${DEEPWIKI_BASE}/{owner}/{repo}` 外链。 */
export const DEEPWIKI_BASE = process.env.NEXT_PUBLIC_DEEPWIKI_BASE || 'https://deepwiki.com';
