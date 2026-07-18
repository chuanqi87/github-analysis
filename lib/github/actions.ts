// 浏览器端触发 GitHub Actions(workflow_dispatch)。
// 供管理台手动触发数据管道用;需 NEXT_PUBLIC_GH_TRIGGER_TOKEN(actions:write 的细粒度 PAT)。
import { GH_REPO, GH_TRIGGER_TOKEN } from '@/lib/config';

export interface WorkflowDispatchResult {
  success: boolean;
  message: string;
}

export async function triggerGitHubWorkflow(
  workflowId: string,
  inputs?: Record<string, string>,
): Promise<WorkflowDispatchResult> {
  if (!GH_TRIGGER_TOKEN) {
    return {
      success: false,
      message: '未配置 GH_TRIGGER_TOKEN，请在环境变量中设置 NEXT_PUBLIC_GH_TRIGGER_TOKEN',
    };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/${workflowId}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${GH_TRIGGER_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'main', inputs: inputs ?? {} }),
      },
    );

    if (res.status === 204) {
      return { success: true, message: '任务已触发，请稍后查看运行结果' };
    }
    const err = await res.text();
    return { success: false, message: `触发失败 (${res.status}): ${err}` };
  } catch (e) {
    return { success: false, message: `请求异常: ${(e as Error).message}` };
  }
}
