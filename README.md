# JuJuBit UI Regression

基于 Playwright + TypeScript 的 JuJuBit 游客态 UI 回归框架。覆盖创作、生成、购物车、Checkout 与埋点审计；所有订单验证止于 Checkout 页面，**绝不填写支付信息、点击或提交 `Pay now`**。

## 快速开始

```bash
npm install
npx playwright install chromium
cp .env.example .env

# 安全冒烟：只跑 TC-01、TC-02，不创建线上生成任务
npm run test:smoke
```

在 `.env` 中配置测试素材和目标地址：

```dotenv
BASE_URL=https://jujubit.ai
PRODUCT_URL=https://jujubit.ai/products/customize-your-own?variant=62485711716723
TEST_IMAGE_SOLO=assets/two-dogs.jpeg
TEST_IMAGE_DUO=assets/two-dogs.jpeg
TEST_IMAGE_LARGE=assets/two-dogs.jpeg
TEST_PROMPT=生成2个小狗
```

测试图片必须无隐私和版权风险。`assets/two-dogs.jpeg` 是仓库内的默认示例素材。

## UI 回归用例

测试固定使用一个 worker 串行执行。

| 用例 | 覆盖范围 | 真实生成 |
| --- | --- | --- |
| TC-01 | 首页进入 Create；自定义器加载完成；Gallery 可见 | 否 |
| TC-02 | 风格、Prompt、Solo/Duo、Basic/Pro 基础交互 | 否 |
| TC-03 | 上传 → 2D → 3D → 旋转 → 加购 → Checkout | 是 |
| TC-04 | 开始生成 → Gallery → 等待 Create 可点击 → 重新上传 → Generate 可用 | 是，未二次点击 Generate |
| TC-05 | Prompt 生成 → 2D/3D → History 新增并删除最新记录 | 是 |
| TC-06 | 上传 → Generate → 检查 `Member Benefits: 20% OFF`；存在时点击对应 Upgrade、打开会员弹窗，再点击 Join | 是，未等待生成完成 |

默认 `ALLOW_PRODUCTION_GENERATION=false`，TC-03、TC-04、TC-05、TC-06 会跳过。只有显式传入 `true` 才会执行完整链路。TC-06 固定写入 `TEST_MEMBERSHIP_STABLE_ID`（默认 `jujubit-ui-e2e-membership-20260902`）到 Statsig 的 `localStorage.statsig.stable_id.3770913638`；未出现会员入口时会单独标记为 skipped。会员弹窗中的 Join 按钮会按登录态断言：已登录应进入 Airwallex，未登录应进入 Shopify 登录或 OAuth 授权页。

## 常用命令

### UI 回归

```bash
# 安全冒烟：TC-01、TC-02
npm run test:smoke

# 每日安全回归：强制关闭真实生成
npm run test:daily

# 全量 6 条：真实生成、加购、Checkout；不发送飞书
PRODUCT_URL='https://jujubit.ai/products/customize-your-own?variant=62485711716723' \
ALLOW_PRODUCTION_GENERATION=true \
SCHEDULED_TRACKING_ENABLED=false \
npx playwright test --project=chromium

# 只运行 TC-03
ALLOW_PRODUCTION_GENERATION=true npm run test:core-smoke

# 全量执行并发送飞书通知（无头 / 有头）
npm run test:all
npm run test:all:headed

# 类型检查、用例发现、打开最近一次报告
npm run validate
npm run report
```

不要在需要 JSON 结果和飞书通知的命令后追加 `--reporter=list`，否则会覆盖 Playwright JSON reporter，导致通知脚本无法读取每条用例结果。

### 通知与失败记录

```bash
# 按 SCHEDULED_TEST_MODE 运行 UI 回归；结束后通知飞书，失败时创建失败记录
npm run test:scheduled

# 基于最近一次 results.json 操作，不重新运行测试
npm run notify:preview
npm run notify:test
npm run record:preview
npm run record:test
```

通知失败不会覆盖原始 Playwright 退出码。失败截图上限 10 MB、视频上限 30 MB；视频无法转为 MP4 时会降级为 WebM 附件。

## 远端定时执行

远端任务由 GitHub Actions 运行，不依赖本地电脑。工作日计划时间（北京时间）为 11:17 和 18:47，对应配置在 `.github/workflows/ui-regression.yml`：

```yaml
- cron: '17 3 * * 1-5'
- cron: '47 10 * * 1-5'
```

计划使用 GitHub 托管 Runner，以 `all` 模式执行完整 6 条用例。工作流有并发组保护，避免两个生产游客会话同时生成。也可在 Actions 页面通过 **Run workflow** 手动选择 `safe` 或 `all`。

GitHub 的原生 `schedule` 在高负载时可能延迟，甚至晚于计划时间数小时；错开整点只能降低概率，不能保证准点。若必须严格准点，需要使用独立云端定时器调用 `workflow_dispatch`。

远端工作流需要配置以下 GitHub Actions Secrets：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_GROUP_CHAT_ID
FEISHU_EXECUTION_RECORDS_PARENT
```

可选 Actions Variable：`PRODUCT_URL`。每次运行都会上传 `playwright-report/` 与 `test-results/` Artifact，保留 14 天。失败时机器人会在 `FEISHU_EXECUTION_RECORDS_PARENT` 指向的 Wiki 节点下创建失败记录；机器人需要是该知识库成员，并具备创建子页面和编辑权限。

## 生产影响与安全边界

全量模式会创建 4 次真实 AI 生成任务；TC-03 加入 1 件商品并进入 Checkout；TC-05 删除本次创建的最新 History 记录。TC-06 使用固定 `stable_id` 验证会员实验，若入口不存在会跳过会员弹窗断言，但此前已发起生成任务。全量模式不会付款，也不会提交订单。运行前请确认生成成本、购物车和 History 的影响。

若站点对 GitHub 托管 Runner 的共享出口返回 `HTTP 429` 或 `legal-rate-limited`，应使用固定出口 IP 的 self-hosted Runner；测试会保留限流证据而非继续等待元素超时。

## 埋点专项

埋点测试与 UI 回归独立，使用 `playwright.tracking.config.ts` 和 `tests/tracking/`。默认仅允许非生产环境；生产验证必须显式设置 `ALLOW_PRODUCTION_TRACKING=true`。

```bash
# 完整埋点审计：analytics + 119 条目录审计
TRACKING_BASE_URL=https://test.example.com npm run test:tracking

# 明确授权后，对生产环境运行完整埋点审计
ALLOW_PRODUCTION_TRACKING=true TRACKING_BASE_URL=https://jujubit.ai npm run test:tracking

# 运行运行时契约校验
TRACKING_BASE_URL=https://test.example.com npm run test:tracking:contract

# Preview / 本地环境的异常注入
TRACKING_BASE_URL=https://your-store.myshopifypreview.com npm run test:tracking:exceptions

# 将目录审计 JSON 渲染为飞书文档 XML
npm run report:tracking -- test-results/tracking-catalog-audit.json test-results/tracking-catalog-report.xml
```

完整目录审计会执行一次真实 2D/3D 生成和一次加购，但不会进入 Checkout、删除生产 History 或付款。异常注入仅允许 Preview/本地地址，使用接口 Mock 和浏览器故障注入；未命中 Mock 不会被误报为通过。

采集器验证 GA4、Statsig 和 Monitor 的浏览器请求。每项契约均要求：动作/有效曝光后恰好上报一次、请求已发起、稳定窗口内无重复、必填参数完整且无敏感字段。HTTP 回执仅作为平台接收证据，不是前端上报通过的硬条件。

埋点运行完成后会在 `FEISHU_TRACKING_RECORDS_PARENT` 下创建执行记录；机器人需要被添加到对应 Wiki 并具备编辑权限。

## 结果、证据与定位

| 内容 | 位置 |
| --- | --- |
| HTML 报告 | `playwright-report/` |
| JSON 结果 | `test-results/results.json` |
| 失败截图、视频、trace、错误上下文 | `test-results/` |
| 埋点 HTML 报告 | `playwright-tracking-report/` |
| 埋点目录审计 JSON | `test-results/tracking-catalog-audit.json` |
| TC-03 页面元素快照 | `generation-elements.json`、`cart-elements.json`、`checkout-elements.json` |

普通交互最多等待 2 分钟；2D 与 3D 生成各最多 5 分钟。2D 验证图片资源实际加载；3D 等待进度层消失、Add to Cart 可用，并验证横向拖动后画面变化。Checkout 仅校验订单摘要、地址表单、折扣入口和 `Pay now` 可见。

线上尚未提供稳定的 `data-testid`，定位器以无障碍名称、`data-view-name` 和局部结构为主。页面改版后，优先复核生成图片、3D 进度层、工具图标、购物车商品及 Checkout 关键区域的定位器。

## 飞书权限与本地授权

企业应用需启用机器人能力，并具备 `im:message:send_as_bot`、图片/文件上传及目标 Wiki 编辑权限。需要本地操作飞书文档时，先完成用户授权：

```bash
lark-cli auth login --domain docs --domain drive
lark-cli auth status --json --verify
```
