# 阿里云长时分析 Runner

`analyze-single` 的 tier-2/tier-3、`code-analysis` 以及每日完整漏斗都读取仓库变量
`DEEP_ANALYSIS_RUNNER`。变量为空时使用 `ubuntu-latest`；设为 `aliyun-deep-analysis` 后，job 只会投递给带该标签的自托管 Runner。

## 安全边界

本仓库是公开仓库。GitHub 官方不建议把常驻自托管 Runner 直接用于公开仓库，因为不可信工作流代码可能持久化控制机器。因此：

- Runner 必须使用无 sudo 权限的独立系统账号，不能用 root。
- 机器上不能放生产数据库密码、SSH 私钥或云平台凭据；任务密钥只由 Actions job 临时注入。
- 只给本仓库注册专用 Runner 和唯一标签 `aliyun-deep-analysis`。
- 工作流只允许 `workflow_dispatch`、受控 `schedule` 或默认分支代码触发，不给 `pull_request` job 使用该标签。
- 更高隔离要求下，应使用一次性 VM/容器并以 `--ephemeral` 注册，任务结束销毁执行环境。

## 注册

在 GitHub 仓库 Settings → Actions → Runners 创建 Linux x64 Runner，获取一小时内有效的注册 token。
在阿里云机器创建独立账号与目录，按 GitHub 页面给出的当前版本下载并校验 runner 包，然后执行：

```bash
sudo useradd --create-home --shell /bin/bash gha-analysis
sudo mkdir -p /opt/actions-runner/github-analysis
sudo chown -R gha-analysis:gha-analysis /opt/actions-runner/github-analysis
sudo -u gha-analysis ./config.sh \
  --url https://github.com/chuanqi87/github-analysis \
  --token '<ONE_TIME_REGISTRATION_TOKEN>' \
  --name aliyun-github-analysis \
  --labels aliyun-deep-analysis \
  --no-default-labels \
  --unattended
sudo chmod 750 /opt/actions-runner/github-analysis
sudo chmod 600 /opt/actions-runner/github-analysis/.credentials \
  /opt/actions-runner/github-analysis/.credentials_rsaparams \
  /opt/actions-runner/github-analysis/.runner
sudo chmod 700 /opt/actions-runner/github-analysis/_work
sudo ./svc.sh install gha-analysis
sudo ./svc.sh start
```

确认 GitHub 显示 Runner 为 `Idle` 后再启用路由：

```bash
gh variable set DEEP_ANALYSIS_RUNNER --body aliyun-deep-analysis
```

下线 Runner 前先清空变量，让工作流回退到 GitHub 托管环境：

```bash
gh variable delete DEEP_ANALYSIS_RUNNER
```
