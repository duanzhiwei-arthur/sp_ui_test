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

框架固定使用一个 worker 串行执行，当前共 5 条 case：

1. TC-01：首页 `Create` 可以进入创作页面，自定义器完成加载且 Gallery 可见。
2. TC-02：自定义器基础交互可以正常切换：
   - Free Style 菜单可以选择 TRPG，并重新切回 Free Style。
   - Prompt 编辑框可见、可编辑，取消和确认按钮可见。
   - Solo 可以切换为 Duo，并恢复为 Solo。
   - Pro 模式显示 3 个工具图标，Basic 模式不显示这些图标。
3. TC-03：核心冒烟：Create -> 上传图片 -> 2D 成功 -> 3D 成功 -> 横向拖动 3D 内容 2 秒 -> 加购 -> Checkout。
4. TC-04：开始生成 -> Gallery -> 返回 Create -> 确认空白创建状态 -> 重新上传图片 -> Generate 可用。
5. TC-05：Create -> 上传图片并写入 Prompt -> 2D 成功 -> 3D 成功 -> 横向拖动 3D 内容 2 秒 -> History 新增记录 -> 删除最新记录并确认已删除。

`ALLOW_PRODUCTION_GENERATION=false` 时，TC-03、TC-04 和 TC-05 自动跳过，只执行 TC-01、TC-02。设置为 `true` 后按以上顺序执行全部 5 条 case。

## 运行

```bash
# 安全冒烟：只执行 TC-01、TC-02
npm run test:smoke

# 每日安全回归：强制关闭线上生成
npm run test:daily

# 指定商品变体执行全量生成流程（不会支付）
PRODUCT_URL='https://jujubit.ai/products/customize-your-own?variant=62485711716723' \
  ALLOW_PRODUCTION_GENERATION=true npx playwright test --project=chromium

# 独立埋点专项：只允许非生产测试域名；不运行既有 UI 回归
TRACKING_BASE_URL=https://test.example.com npm run test:tracking

# 仅在明确授权时对生产域名执行埋点专项
ALLOW_PRODUCTION_TRACKING=true TRACKING_BASE_URL=https://jujubit.ai npm run test:tracking

# Preview 环境异常埋点专项（接口 Mock + 浏览器故障注入）
TRACKING_BASE_URL=https://your-store.myshopifypreview.com \
TRACKING_FAULT_INJECTION_ENABLED=true \
npm run test:tracking:exceptions

# 只执行 119 条目录审计，并生成结构化 JSON
ALLOW_PRODUCTION_TRACKING=true TRACKING_BASE_URL=https://jujubit.ai \
  PRODUCT_URL='/products/customize-your-own?variant=62485711716723' \
  npx playwright test tests/tracking/catalog-audit.spec.ts --config=playwright.tracking.config.ts

# 将目录审计 JSON 渲染成飞书文档 XML
npm run report:tracking -- test-results/tracking-catalog-audit.json test-results/tracking-catalog-report.xml

# 按 SCHEDULED_TEST_MODE 执行；结束后发送通知，失败时创建失败记录
npm run test:scheduled

# 只预览最近一次结果将生成的消息，不运行测试、不发送飞书
npm run notify:preview

# 不运行测试，把最近一次结果和失败附件发送到飞书
npm run notify:test

# 不运行测试、不写飞书，只预览最近一次结果对应的执行记录 XML
npm run record:preview

# 不运行测试；最近一次结果失败时创建一篇飞书测试失败文档
npm run record:test

# 只执行 TC-03 核心生成、加购和 Checkout
ALLOW_PRODUCTION_GENERATION=true npm run test:core-smoke

# 无界面串行执行全部 5 条 case，保留 JSON 报告并发送飞书
npm run test:all

# 可视 Chromium 串行执行全部 5 条 case，保留 JSON 报告并发送飞书
npm run test:all:headed

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
- 3D 验证等待生成进度层消失和 Add to Cart 可用，再横向拖动模型 2 秒；只有拖动前后画面发生视觉变化才判定 3D 生成成功。滑动完成后停留 5 秒，再执行加购。
- 导航后若检测到 HTTP 429 或 `legal-rate-limited`，立即报告运行环境被限流，不再无意义等待页面元素超时。
- 加购后进入 `/cart`，确认 Checkout 商品数量非零，再进入 Checkout。
- Checkout 只断言订单摘要、地址表单、折扣入口和 `Pay now` 可见；测试不会点击或提交付款。

## 埋点专项

埋点测试与既有 UI 回归独立，使用 `playwright.tracking.config.ts` 和 `tests/tracking/`。默认只允许非生产环境；如需明确授权生产验证，必须额外设置 `ALLOW_PRODUCTION_TRACKING=true`。完整目录审计会执行一次真实 2D/3D 生成和一次加购，但不会进入 Checkout、删除历史资产或付款。

- `TrackingCollector` 采集 GA4、Statsig 和 Monitor 的浏览器端请求及响应状态：GA4 解析 `/g/collect` 的 `en`、`ep.*`、`epn.*`；Monitor 优先解析真实批量结构 `events[].data.name`；Statsig 兼容常见 `eventName + metadata` 结构。
- 每个契约统一验证：操作前清空记录，真实点击或首次有效曝光后恰好上报一次，浏览器发起对应平台请求，等待 2 秒稳定窗口后仍不得重复，并校验必填、未定义及敏感业务参数。HTTP 回执作为“平台接收”辅助证据展示，不作为前端埋点通过的硬条件。
- GA4 契约在 `tests/tracking/tracking-contracts.ts`，可复用 UI 动作在 `tests/tracking/tracking-actions.ts`。新增埋点时先补动作映射和平台契约，避免把未实现 case 误报为通过。
- `catalog-audit.spec.ts` 将飞书源文档的 119 条目录逐条输出为通过、失败或跳过；通过和失败分别使用 `✅`、`❌`，结果总数必须严格闭合为 119。
- `exception-audit.spec.ts` 只允许 Preview/本地地址，使用真实接口路径注入 HTTP 500/503，并通过 `FileReader` 故障注入验证异常埋点。Mock 命中记录会写入步骤证据；接口未命中时不会把场景误报为埋点通过。
- 事件等待默认 30 秒；响应确认默认 15 秒；控件点击仅短暂尝试 10 秒，分别可通过 `TRACKING_EVENT_TIMEOUT_MS`、`TRACKING_DELIVERY_TIMEOUT_MS` 与 `TRACKING_CONTROL_TIMEOUT_MS` 调整。控件不可用不会单独判失败：只要对应埋点已出现，仍继续校验上报次数、参数和网络送达；最终结果只以埋点证据为准。

## 生产风险控制

执行全部 case 会创建 3 次真实 AI 生成任务。TC-03 还会加入 1 件真实购物车商品并进入 Checkout；TC-04 会开始生成后返回 Create，但不会再次点击 Generate；TC-05 会生成后删除自己的 History 记录。框架绝不填写支付信息、点击 `Pay now` 或提交付款。

普通 `npm run test:smoke` 不包含 TC-03、TC-04、TC-05，避免环境开关变化时误触发线上生成。真实生成还要求测试图片文件存在，否则对应 case 自动跳过。

## 结果与证据

- HTML 报告：`playwright-report/`
- 失败截图、视频、trace 和错误上下文：`test-results/`
- TC-03 页面元素快照：`generation-elements.json`、`cart-elements.json`、`checkout-elements.json`

## 定位器维护

当前线上页面尚未提供稳定的 `data-testid`。现有定位器以可访问名称、`data-view-name` 和局部页面结构为主。页面改版后应优先同步生成图片、3D 进度层、工具图标、购物车商品和 Checkout 关键区域的定位器。

## 本机定时执行

使用 macOS `launchd` 在本机每天执行两次全部 5 条 case，并在结束后发送飞书通知：

- `11:00`
- `18:30`

配置文件见 `automation/com.jujubit.ui-regression.plist`。报告保存在 `playwright-report/`，失败证据保存在 `test-results/`，运行日志写入 `automation/logs/`。定时执行依赖本机保持开机、联网且不处于深度睡眠。

在 `.env` 中配置调度模式和企业应用机器人。单聊可以使用企业邮箱，不必先查 `open_id`：

```dotenv
# 本机定时任务执行全部 5 条 case
SCHEDULED_TEST_MODE=all

# 飞书开放平台“凭证与基础信息”中的应用凭证
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 单聊可用 email/open_id，群聊使用 chat_id
FEISHU_RECEIVE_ID_TYPE=email
FEISHU_RECEIVE_ID=your.name@company.com

# “sp—ui自动化执行记录”目录的完整 Wiki 链接或节点 token
FEISHU_EXECUTION_RECORDS_PARENT=https://your-company.feishu.cn/wiki/xxxxxxxx

# 故障知识库根节点；失败时递归检索其全部子文档
FEISHU_SOLUTION_LIBRARY_ROOT=https://your-company.feishu.cn/wiki/xxxxxxxx

# Apple Silicon Homebrew 的默认安装位置
LARK_CLI_PATH=/opt/homebrew/bin/lark-cli

# 可选兼容通道：企业应用配置全部留空时，使用群自定义机器人发送纯文本
FEISHU_WEBHOOK_URL=
FEISHU_WEBHOOK_SECRET=
```

企业应用需要启用机器人能力，并开通 `im:message:send_as_bot` 和图片/文件资源上传权限。应用发布后，接收人必须在应用可用范围内。失败时脚本会从 Playwright JSON 报告中关联每条失败用例；飞书限制截图最大 10 MB、录屏最大 30 MB，超限附件会跳过但不影响结果文本。

汇总、失败用例和失败截图会合并到第一条飞书富文本消息。若系统已安装 `ffmpeg`，或在 `.env` 配置了 `FFMPEG_PATH`，脚本会把 Playwright 的 WebM 录屏转成 MP4，并紧跟汇总发送为带截图封面的原生视频消息，可在飞书内点击播放；无法转换时降级为 WebM 文件附件。

通过 `npm run test:scheduled` 执行时会强制忽略 `tests/tracking/`，不会执行或上报正常/异常埋点自动化；埋点专项目前只能使用 `test:tracking` 或 `test:tracking:exceptions` 手动运行。UI 用例失败时，脚本才会使用本机 `lark-cli` 用户身份，在 `FEISHU_EXECUTION_RECORDS_PARENT` 指定的 Wiki 节点下新建失败记录；成功运行不会建档。失败记录包含北京时间、失败用例、原始错误、初步判断、修复建议、测试统计和本机证据路径。

若配置 `FEISHU_SOLUTION_LIBRARY_ROOT`，失败后脚本会递归查询该 Wiki 节点下的全部 Doc/Docx 子文档，依据用例名称、错误码、组件名和异常关键词匹配最多 5 篇相关记录，并把可点击的文档引用、匹配关键词和相关正文摘录写入失败记录。知识库不可用或没有命中时仍会创建失败记录，并保留框架内置建议。

首次启用或登录态过期时，在终端完成用户授权并确认 `verified` 为 `true`：

```bash
lark-cli auth login --domain docs --domain drive
lark-cli auth status --json --verify
```

定时任务的 plist 已设置 `HOME=/Users/macbookair`，用于读取相同的本机用户登录态。飞书文档创建失败会写入 `automation/logs/daily.stderr.log`，但不会覆盖 Playwright 的退出码，也不会把原本成功的测试标记为失败。

安装或更新本机定时任务：

```bash
cp automation/com.jujubit.ui-regression.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.jujubit.ui-regression.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jujubit.ui-regression.plist
```

通知内容包含执行状态、运行模式、机器名、开始时间、耗时、通过/失败/跳过数量、全部用例名称及各自状态、每条失败用例的自动根因分析、失败截图、录屏附件和本机 HTML 报告路径。整体结果和 case 通过时显示 `✅`，失败、不稳定、跳过或未知状态显示 `❌`。失败文档同时保留自动分析和 Playwright 原始错误。即使飞书发送失败，脚本仍保留 Playwright 原始退出码，避免把测试失败误报为通知失败。

执行全量用例时使用 `npm run test:all` 或 `npm run test:all:headed`。不要在需要发送飞书结果的运行中追加 `--reporter=list`，该参数会覆盖配置中的 JSON reporter，导致 `notify:test` 无法读取每条 case。若报告缺失，飞书会明确显示 `❌ 结果报告缺失`，不会再误报执行通过。

`SCHEDULED_TEST_MODE=all` 每次会触发 3 次真实生成、1 次加购并进入 Checkout，TC-05 会删除自己的 History 记录。启用前应确认生成成本、历史记录和购物车数据影响；任何模式都不会点击付款。

生产风险控制：串行执行、固定游客素材、真实生成必须显式授权、流程止于 Checkout，且绝不点击 `Pay now` 或提交付款。
