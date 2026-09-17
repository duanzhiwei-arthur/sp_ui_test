# 云端定时器部署指南

当前只有部署模板。2026-09-17 核对妙搭应用 app_17dsjs7c59z 的线上 cron 列表为空，已有飞书 Webhook 服务不代表定时器已运行。

计划在工作日北京时间 11:17 / 18:47 提交 workflow_dispatch，固定 mode=daily。GitHub 11:47 / 19:17 cron 是同一档的兜底；两者使用 daily-YYYY-MM-DD-am|pm 去重键。先发布配套 workflow，再启用外部定时器。

调度器和 workflow 均拒绝超过计划时间 60 分钟的补跑，代价是延迟过大时该档不执行。手动调试单独 workflow_dispatch，不填 dedupe_key；定时器禁止 all 和 --no-dedupe。

## Linux VM

需要始终在线的 VM、Node.js 22+、仓库及 npm ci。Token 放在宿主密钥管理或权限为 600 的环境文件，仅授权目标仓库 Actions read/write（查询 Artifact 和 dispatch）。

提供 systemd/jujubit-scheduled-dispatch.service、.timer 和 crontab.example。安装前调整仓库路径、Node 路径和服务账号。systemd 使用 Asia/Shanghai、AccuracySec=1s、Persistent=false；这些设置不构成秒级启动 SLA。CRON_TZ 需宿主 cron 支持。

node automation/dispatch-scheduled-run.mjs --slot am --dry-run 只校验计划，不创建任务；窗口外明确跳过。

## 妙搭

不能在妙搭运行时代码中调用 lark-cli 或直接运行本仓库 shell 脚本。需要在应用中实现 @Automation / @BindTrigger 服务、注册 Module 并发布；再配置、启用对应 cron 并验证日志。服务通过后端 HTTP 客户端调用 GitHub，传入当日北京日期的 dedupe_key 和固定 daily 模式。

## 限制

- 外部计时器减少 schedule 事件延迟；API、Runner 排队和环境安装仍需时间。
- 全局串行 + Artifact 防重标记保留 14 天，不是永久去重或严格 exactly-once。GitHub concurrency 也不是可靠任务队列，多个待运行请求可能被合并替换。
- 标记在环境准备完成后、生成前保存。执行失败不会自动重跑；准备失败无标记，窗口内兜底可补跑。
- self-hosted 需要云端服务器才不依赖本地电脑。固定出口有助于共享 IP 限流，但不能解决配额、应用限流等所有 429。
