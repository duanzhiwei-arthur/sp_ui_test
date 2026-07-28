# JuJuBit UI Regression

Playwright + TypeScript 的线上游客态 UI 回归框架。测试范围止于 Checkout 订单摘要，严禁执行付款。

## 初始化

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

把无隐私、无版权风险的测试图片放入 `assets/`，并在 `.env` 配置 `TEST_IMAGE_SOLO`。默认示例路径为 `assets/solo.jpg`。只有 `ALLOW_PRODUCTION_GENERATION=true` 时才允许运行真实生成、加购和 Checkout 流程。

## 用例与执行顺序

框架固定使用一个 worker 串行执行，当前共 4 条 case：

1. TC-01：首页 `Create` 可以进入创作页面，自定义器完成加载且 Gallery 可见。
2. TC-02：自定义器基础交互可以正常切换：
   - Free Style 菜单可以选择 TRPG，并重新切回 Free Style。
   - Prompt 编辑框可见、可编辑，取消和确认按钮可见。
   - Solo 可以切换为 Duo，并恢复为 Solo。
   - Pro 模式显示 3 个工具图标，Basic 模式不显示这些图标。
3. TC-20：核心冒烟：Create -> 上传图片 -> 2D 成功 -> 3D 成功 -> 横向拖动 3D 内容 2 秒 -> 加购 -> Checkout。
4. TC-18：开始生成 -> Gallery -> 返回 Create -> 确认空白创建状态 -> 重新上传图片 -> Generate 可用。

`ALLOW_PRODUCTION_GENERATION=false` 时，TC-20 和 TC-18 自动跳过，只执行 TC-01、TC-02。设置为 `true` 后按以上顺序执行全部 4 条 case。

## 运行

```bash
# 安全冒烟：只执行 TC-01、TC-02
npm run test:smoke

# 每日安全回归：强制关闭线上生成
npm run test:daily

# 按 SCHEDULED_TEST_MODE 执行，并在结束后发送飞书通知
npm run test:scheduled

# 只预览最近一次结果将生成的消息，不运行测试、不发送飞书
npm run notify:preview

# 不运行测试，把最近一次结果和失败附件发送到飞书
npm run notify:test

# 只执行 TC-20 核心生成、加购和 Checkout
ALLOW_PRODUCTION_GENERATION=true npm run test:core-smoke

# 无界面串行执行全部 4 条 case
ALLOW_PRODUCTION_GENERATION=true npx playwright test --project=chromium --reporter=list

# 可视 Chromium 串行执行全部 4 条 case
ALLOW_PRODUCTION_GENERATION=true npx playwright test --project=chromium --headed --reporter=list

# 类型检查和用例发现检查
npm run validate

# 打开最近一次 HTML 报告
npm run report
```

## 核心等待与断言

- 页面等待 `Loading customizer...` 完全消失且 Generate 出现后再执行后续操作。
- 常规资源与交互最多等待 2 分钟；条件提前满足时立即继续，不等待上限结束。
- 2D 和 3D 生成阶段最多分别等待 5 分钟；图片或模型提前生成时立即继续。
- 所有可视点击操作前后各停留约 2 秒，便于观察页面状态变化。
- 2D 验证在左侧商品预览区等待生成图片节点和资源加载完成；若页面已自动进入 3D，则立即切回 2D 做可见性断言。
- 3D 验证等待 `<model-viewer>` 的可见画布出现、生成进度层消失和 Add to Cart 可用，再横向拖动 2 秒并比较拖动前后截图。
- 导航后若检测到 HTTP 429 或 `legal-rate-limited`，立即报告运行环境被限流，不再无意义等待页面元素超时。
- 加购后进入 `/cart`，确认 Checkout 商品数量非零，再进入 Checkout。
- Checkout 只断言订单摘要、地址表单和折扣入口可见，并确认 `Pay now` 禁用。

## 生产风险控制

执行全部 case 会创建 2 次真实 AI 生成任务。TC-20 还会加入 1 件真实购物车商品并进入 Checkout；TC-18 会开始生成后返回 Create，但不会再次点击 Generate。框架绝不填写支付信息、点击 `Pay now` 或提交付款。

普通 `npm run test:smoke` 不包含 TC-20、TC-18，避免环境开关变化时误触发线上生成。真实生成还要求测试图片文件存在，否则对应 case 自动跳过。

## 结果与证据

- HTML 报告：`playwright-report/`
- 失败截图、视频、trace 和错误上下文：`test-results/`
- TC-20 页面元素快照：`generation-elements.json`、`cart-elements.json`、`checkout-elements.json`

## 定位器维护

当前线上页面尚未提供稳定的 `data-testid`。现有定位器以可访问名称、`data-view-name` 和局部页面结构为主。页面改版后应优先同步生成图片、3D 进度层、工具图标、购物车商品和 Checkout 关键区域的定位器。

## 本机定时执行

使用 macOS `launchd` 在本机每天执行两次全部 4 条 case，并在结束后发送飞书通知：

- `10:30`
- `18:30`

配置文件见 `automation/com.jujubit.ui-regression.plist`。报告保存在 `playwright-report/`，失败证据保存在 `test-results/`，运行日志写入 `automation/logs/`。定时执行依赖本机保持开机、联网且不处于深度睡眠。

在 `.env` 中配置调度模式和企业应用机器人。单聊可以使用企业邮箱，不必先查 `open_id`：

```dotenv
# 本机定时任务执行全部 4 条 case
SCHEDULED_TEST_MODE=all

# 飞书开放平台“凭证与基础信息”中的应用凭证
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 单聊可用 email/open_id，群聊使用 chat_id
FEISHU_RECEIVE_ID_TYPE=email
FEISHU_RECEIVE_ID=your.name@company.com

# 可选兼容通道：企业应用配置全部留空时，使用群自定义机器人发送纯文本
FEISHU_WEBHOOK_URL=
FEISHU_WEBHOOK_SECRET=
```

企业应用需要启用机器人能力，并开通 `im:message:send_as_bot` 和图片/文件资源上传权限。应用发布后，接收人必须在应用可用范围内。失败时脚本会从 Playwright JSON 报告中关联每条失败用例；飞书限制截图最大 10 MB、录屏最大 30 MB，超限附件会跳过但不影响结果文本。

汇总、失败用例和失败截图会合并到第一条飞书富文本消息。若系统已安装 `ffmpeg`，或在 `.env` 配置了 `FFMPEG_PATH`，脚本会把 Playwright 的 WebM 录屏转成 MP4，并紧跟汇总发送为带截图封面的原生视频消息，可在飞书内点击播放；无法转换时降级为 WebM 文件附件。

安装或更新本机定时任务：

```bash
cp automation/com.jujubit.ui-regression.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.jujubit.ui-regression.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jujubit.ui-regression.plist
```

通知内容包含执行状态、运行模式、机器名、开始时间、耗时、通过/失败/跳过数量、失败用例名称、失败截图、录屏附件和本机 HTML 报告路径。即使飞书发送失败，脚本仍保留 Playwright 原始退出码，避免把测试失败误报为通知失败。

`SCHEDULED_TEST_MODE=all` 每天会触发 2 次真实生成、1 次加购并进入 Checkout。启用前应确认生成成本和购物车数据影响；任何模式都不会点击付款。

生产风险控制：串行执行、固定游客素材、真实生成必须显式授权、流程止于 Checkout、只断言 `Pay now` 禁用且绝不点击付款。
