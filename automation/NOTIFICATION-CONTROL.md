# 按群暂停/开启定时通知

只暂停通知，不停远端定时器、不改 cron、不跳过测试或失败文档/Actions 产物。

## 命令（在群里真正 @本机器人）

- `停止通知` / `暂停通知` / `关闭通知`：暂停当前群。
- `开启通知` / `恢复通知` / `启动通知`：恢复当前群。
- `通知状态`：查询当前群是否开启（所有群成员可查询）。
- 兼容 `停止定时任务`、`开启定时任务`、`定时任务状态` 等说法，但实际只控制通知。
- 群内任何人真正 @本机器人即可修改或查询本群开关，无需管理员名单；私聊、其他机器人消息、@其他人和未 @本机器人的消息不会修改。
- 精确匹配指令；问句、否定句和附加指令不会修改开关。不经模型决策。

## 作用范围

当前群的自动运行结果卡片、失败 @所有人、截图上传和失败视频一起跳过。
其他群不受影响。定时任务仍运行，测试退出码、复核、诊断包、失败文档、报告保留不变。
手动执行（无 dedupe_key 的 workflow_dispatch）、结果查询、主动请求失败视频仍正常回复。
本群设置同时作用于每小时回归和每天 TC-001 巡检的定时通知。

发送前读取最新状态，因此运行中的测试也可在结果发送前被静音。
已经开始投递的消息无法撤回；不补发暂停期间的通知，恢复后从后续发送开始。

## 存储与必须完成的配置

使用 **同一个 GitHub 仓库的 Actions repository variable** 持久化，不使用进程内存或 Actions 本地文件。
每个群一个变量：`FEISHU_NTFY_V1_<chat_id 的 SHA-256 前 32 位大写>`，值为 `enabled` 或 `paused`。
只有确认该仓库可读且变量不存在时默认开启；认证失败、超时、无权限、损坏数据都不当作“已开启”。

上线前先完成以下配置，否则定时群通知会出于保护被跳过：

1. 配置有目标仓库 Variables 权限的 GitHub 凭证（上线可复用现有机器人凭证，不扩展其授权范围；后续建议换成仅授权该仓库的 fine-grained PAT）：机器人需要 **Variables: read and write**；Actions 只需 **Variables: read**。可用同一 token（需要读写），更建议两个权限分离的 token。
2. 在妙搭机器人运行环境配置：
   - `FEISHU_NOTIFICATION_TOKEN`：上面的读写 token；通过独立配置项接入，不向只读模型分析功能暴露写接口。
   - `GITHUB_REPOSITORY`：与远端 Actions 相同的 `owner/repo`。
   - `FEISHU_BOT_OPEN_ID`：这个应用机器人自己的 `ou_...`，用于校验 @目标，不是群 ID。
3. 在该 GitHub 仓库创建 Actions secret **`FEISHU_NOTIFICATION_TOKEN`**，值为读 token 或同一个读写 token。两个定时 workflow 已接线；仅设置机器人变量不够。
4. 将机器人源码提交/推送并发布妙搭；将本仓库通知脚本及两个 workflow 的改动推送到运行分支。顺序建议先配置凭证、上线 Actions 读开关，再发布机器人命令。仅本地修改不等于线上生效。

原 `GITHUB_TOKEN` 的 actions:write 权限不等于 Variables 权限，内置 `github.token` 不能代替上述专用 token。
PAT 过期/失权时，机器人回复“未确认”，不会假装修改成功；Actions 跳过本次定时群通知，在日志和 job summary 留提示，但不修改测试结论。修复凭证后读取原持久化状态。
不在日志或群里输出 token、GitHub 响应正文或群 ID。不新增公网读写开关接口。

## 本地验证（不发送真实消息、不触发远端测试）

本仓库：

```sh
node --test automation/notification-control.test.mjs automation/notification-delivery.test.mjs
node --test automation/*.test.mjs
```

嵌套的妙搭机器人仓库：

```sh
TS_NODE_PROJECT=tsconfig.node.json TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test test/*.test.cjs
npm run type:check
npm run build:prod
```

`server/modules/experiment-bot/notification-control.ts` 是协议源文件。
`automation/notification-control.mjs` 为其 TypeScript ES2022 转译副本；机器人单测检查两者完全一致。
妙搭机器人目录是独立 Git 仓库，且在父仓库被忽略；发布需要分别处理两个仓库的改动。

群内验收在用户授权后执行：任意群成员暂停 → 查询 → 下一次自动运行无群通知但有 Actions 报告 → 手动执行仍有回复 → 开启 → 下一次自动运行恢复。不同群成员均可开关，私聊/机器人消息应被拒绝，第二个群不受影响。开发验证不向群发送消息。
