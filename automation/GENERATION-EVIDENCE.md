# 生成失败排查字段

生成步骤失败时，从该失败尝试的 `trace.zip` 提取 `/apps/ai/activity/tasks` POST 的 SSE 响应。
按 task/asset 对应关系保存 Task ID、Asset ID、Trace ID；多任务逐组展示，不从其他用例或历史运行补齐。

输出位置：飞书失败卡片、文本通知、失败文档，以及 `ui-diagnostics-<run_id>` 中的 `generationEvidence`。
后者提供给现有只读机器人作分析证据；模型输出仍可能有遗漏，固定通知不依赖模型生成这些字段。

时间范围为“生成请求开始至该用例失败”，显示北京时间（Asia/Shanghai）。未找到请求时间时使用用例开始时间，并注明来源。
缺少 Trace、响应未结束、事件缺失、解析超限时仍输出四项，缺失 ID 显示“未采集到”；取证失败不改变用例结果。

只提取白名单 ID 和时间，不输出请求头、密钥、上传链接或 Prompt。不会修改页面操作、断言、重试次数、定时频率，也不会为获取 ID 再次创建任务。

运行环境需要 `unzip`（GitHub Ubuntu runner 和本地 macOS 的现有工具）；使用参数数组调用，无 shell 拼接。
限制：Trace 150MB、网络文本24MB、单条 SSE 1MB、最多10条响应；多于限制会标明证据缺口。
历史记录不会自动补写；从包含本次提交的新运行开始生效。

验证：`npm run typecheck && npm run syntaxcheck && npm run test:unit`。
额外使用 Run 39684997602 的真实 TC-05 Trace，验证提取结果及北京时间格式。
