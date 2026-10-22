# 正式通知格式

2026-10-22 用户确认个人预览后，成功通知采用精简卡片。

- 仅进程正常退出、报告有效、至少一条用例且全部通过、无失败/跳过/flaky/报告错误时使用。
- 默认展示执行范围、通过数、耗时、北京时间完成时间和一个完整运行入口。
- 全部 Case 名称、Run 和提交版本默认折叠，保留可追溯性。
- 正式版移除个人预览标注；失败及非完全通过沿用原详细卡片。
- 不改变接收群、定时频率、执行范围、断言、失败 @所有人和失败证据发送。
- 没有远端运行标识的本地执行仍使用原详细卡片。

只生成 JSON、不发送消息、不运行用例：

```sh
node automation/run-and-notify.mjs --notification-card-preview
```

测试：`npm run typecheck && npm run syntaxcheck && npm run test:unit`。
