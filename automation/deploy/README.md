# 云端定时器部署指南（方案 A）

目标：用独立的、始终在线的云端定时器在每个计划时刻（北京时间 11:17 / 18:47）
调用 `automation/dispatch-scheduled-run.mjs`，通过 `workflow_dispatch` 立即触发远端回归，
从而摆脱 GitHub 原生 `schedule` 事件的负载延迟。GitHub 内的 `schedule` 仍保留，但降级为
+30 分钟的兜底，并通过 `dedupe_key` 与本定时器去重，不会重复执行。

## 前置条件

- 一台始终在线的云环境：小云 VM、容器，或已有的妙搭云端应用（飞书机器人所在的宿主）。
- 环境变量（写入仓库 `.env` 或宿主密钥管理，勿提交到仓库）：
  - `GITHUB_TOKEN`：fine-grained token，仅该仓库 `Actions: write`。
  - 可选：`GITHUB_REPOSITORY`（默认 `duanzhiwei-arthur/sp_ui_test`）、
    `GITHUB_WORKFLOW_FILE`（默认 `ui-regression.yml`）、`GITHUB_REF`（默认 `main`）、
    `SCHEDULED_DISPATCH_MODE`（默认 `daily`）。

## 方式一：Linux VM + systemd timer（推荐）

```bash
sudo cp automation/deploy/systemd/jujubit-scheduled-dispatch.{service,timer} /etc/systemd/system/
# 按需修改 .service 里的 WorkingDirectory 与 ExecStart 路径
sudo systemctl daemon-reload
sudo systemctl enable --now jujubit-scheduled-dispatch.timer
systemctl list-timers jujubit-scheduled-dispatch.timer
```

## 方式二：cron

把 `automation/deploy/crontab.example` 里的两行并入云 VM 的 crontab，路径改成实际目录。

## 方式三：妙搭云端应用定时触发（本仓库当前宿主）

飞书桥接服务部署在妙搭云端应用 `JuJuBit 实验自动化机器人`（`app_17dsjs7c59z`），
定时器也放同一宿主，复用它的密钥管理与出网能力，不依赖本地电脑。

在妙搭里新建**两个定时任务**，触发时刻分别是北京时间 **11:17** 与 **18:47**
（工作日）。每个任务执行以下任一动作：

### 3a. 能跑 Node 的定时任务：直接调 dispatcher

```bash
# 11:17 档
node automation/dispatch-scheduled-run.mjs --slot am
# 18:47 档
node automation/dispatch-scheduled-run.mjs --slot pm
```

环境变量 `GITHUB_TOKEN`（fine-grained，仅该仓库 `Actions: write`）与
`GITHUB_REPOSITORY` / `GITHUB_WORKFLOW_FILE` / `GITHUB_REF` 放在妙搭在线密钥管理里，
参考飞书机器人现有的 `GITHUB_*` 配置方式，勿写入仓库或日志。

### 3b. 只能发 HTTP 的定时任务：直接打 dispatch REST API

`dedupe_key` 用**当日北京日期**拼成 `daily-<yyyy-mm-dd>-<am|pm>`；定时器通常能取到
当前时间，按时刻固定传 `am` 或 `pm` 即可。

```
POST https://api.github.com/repos/duanzhiwei-arthur/sp_ui_test/actions/workflows/ui-regression.yml/dispatches
Authorization: Bearer <GITHUB_TOKEN>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "ref": "main",
  "inputs": {
    "mode": "daily",
    "dedupe_key": "daily-2026-09-16-am",
    "simulate_failure_record": "false"
  }
}
```

## 验证

本机先做一次干跑（不会真正触发）：

```bash
GITHUB_TOKEN=... node automation/dispatch-scheduled-run.mjs --slot am --dry-run
node automation/dispatch-scheduled-run.mjs --slot pm --no-dedupe   # 强制真实触发一次（谨慎）
```

触发后到 GitHub Actions 页面确认 `workflow_dispatch` 运行立即入队，且仅运行一次。

> 兜底：即便妙搭定时器某次没跑，GitHub 内的 `schedule`（11:47 / 19:17）仍会兜底；
> 两者 dedupe_key 一致，同一档不会重复执行。