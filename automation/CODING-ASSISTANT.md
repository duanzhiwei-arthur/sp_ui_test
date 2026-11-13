# 本人专用飞书编程与发布

范围固定为 `duanzhiwei-arthur/sp_ui_test`，必需的发布副本仅同步到
`vast-enterprise/shop-test-agent-s/projects/sp_ui_test`，不能指定其他仓库。

## 使用

1. 在 **sp-ui 自动化机器人私聊**中发送 `绑定编程 <一次性口令>`。
   口令由配置者通过本次 Codex 对话提供，24 小时过期；首次成功后不可从聊天覆盖已绑定身份。
   飞书 open_id 按应用不同，不能用其他 CLI 应用中的 open_id 直接猜测；必须以本机器人已验证私聊事件中的 sender 身份绑定。
2. `改代码：<具体修改需求>`：启动独立 Actions 编程任务。
3. 收到完成回执后查看公开草稿分支和差异。默认不更新 main。
4. 需要发布时，将回执的完整指令发回私聊：`发布代码 <任务编号> <完整40位提交SHA>`。
   此指令只授权该任务对应的确切提交。不会因“想发布”“不要发布”等普通句子执行发布。
5. `代码状态 <任务编号>`：查询草稿/发布状态及运行链接。

群内改代码指令不会触发编程工作流；未绑定者不能读任务、改代码或发布。
群内所有人可用的通知开关不改变。绑定和代码权限独立于模型回答与提示词。
不自动恢复暂停通知，也不停止现有定时任务。

## 真实能力与限制

- 沿用现有大模型代理和模型，通过固定 `read_file` 工具读取允许列表中的已提交文件；不把宿主环境变量或密钥传给模型。
- 只新增/替换 `tests`、`experiments`、`verification`、部分 `automation` 文本与 README；单次最多8个文件、每文件100KB、总200KB。
- 不允许模型访问 shell、网络工具、工作流、依赖清单、编程助手自身、权限、凭证或通知开关控制代码；不支持删除/重命名。
- 需求及源码会发送到现有模型代理。**仓库为公开仓库，草稿代码、提交和 Actions 任务元数据公开可见。不要在需求中提供密码、Token 或私人信息。**
- 生成后在无网络、无密钥、无宿主主目录/`.git`/Docker socket 的只读容器中运行固定 TypeScript/JavaScript 语法类型检查；不执行生成代码、浏览器测试、真实生成、支付或生产数据删除。
- “检查通过”仅表示上述静态检查通过，不等于功能测试或线上回归已通过。
- 发布只推进主仓库 main 到已检查的子提交；基础主分支变化、任务/提交/身份不符或检查未成功则拒绝。不强推、不自动重置其他改动。
- 副本仅同步该任务文件；若副本已有其他差异则停止同步并明确回报主仓库已发布/副本未完成，不自动回滚。重发同一发布指令可重试未完成的同步。
- “发布到远端”表示 GitHub main 和项目副本更新。不会修改开发者电脑上的旧工作区，也不会部署妙搭机器人自身或修改站点业务服务。

## 运维配置

妙搭机器人 online：

- `FEISHU_CODING_ENABLED=true`
- `FEISHU_CODING_GITHUB_TOKEN`：对固定主仓库具备 Actions dispatch/read、Variables read/write、Contents read/write；对发布副本具备 Contents read/write。建议拆分为 GitHub App / 最小权限凭证。
- `FEISHU_CODING_PAIR_HASH`：32字节随机口令的 SHA256，小写 hex。不是明文口令。
- `FEISHU_CODING_PAIR_EXPIRES`：毫秒时间戳；无效、缺失或过期禁止绑定。

GitHub 主仓库 Actions secrets：

- `FEISHU_CODING_GITHUB_TOKEN`
- `CODING_LLM_BASE_URL` / `CODING_LLM_API_KEY` / `CODING_LLM_MODEL`
- 沿用既有 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，完成后只发绑定用户私信。

Repository variables：`FEISHU_CODE_OWNER_V1` 与 `FEISHU_CODE_TASK_<24位任务ID大写>`。
包含身份和可发布任务事实，不能当作公开配置输出。初次绑定仅 CREATE，不覆盖；更换用户需配置者另行核验，聊天不能切换。
工作流全局串行，`persist-credentials=false`。模型步骤和静态检查步骤隔离，密钥只给可信编排步骤。

## 验证

```sh
node --test automation/coding-agent.test.mjs
npm run validate
```

机器人：`TS_NODE_PROJECT=tsconfig.node.json TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register --test test/*.test.cjs`，再运行现有 typecheck/build。
实测模型可用内存 README fixture 验证工具调用，不写仓库、不发消息。远端容器链路应在启用后用授权的单个草稿任务验证；没有完整任务成功前不得宣称已完成端到端改代码/发布验收。
