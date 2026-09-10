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
| TC-06 | 会员实验 Treatment：校验 stable_id/分组 → 上传 → Generate → 会员入口 → 弹窗 → Join | 是，未等待生成完成 |
| TC-EXP-01 | 会员实验 Control：校验 stable_id/分组 → 上传 → Generate → 会员入口不展示 | 是 |
| TC-EXP-02 | 画板实验 Treatment：One/Two/One → 三模板多选 → TRPG 预览 → 样式横滑 → 3 条并行生成 → 逐条验证 3D | 是，创建 3 条记录 |

默认 `ALLOW_PRODUCTION_GENERATION=false`，TC-03、TC-04、TC-05、TC-06、TC-EXP-01、TC-EXP-02 会跳过。工作日定时任务只执行 TC-01～TC-05；实验用例不混入日常回归，避免实验改版或分流变化影响每日稳定性。会员 Control/Treatment 共用上传 → Generate 触发路径；画板 Control 复用 TC-02，Treatment 使用独立的三模板生成链路。所有实验用例都会校验实际 stable_id 和实验参数值。

## 常用命令

### UI 回归

```bash
# 安全冒烟：TC-01、TC-02
npm run test:smoke

# 每日安全回归：强制关闭真实生成
npm run test:daily

# 日常 5 条：TC-01～TC-05；不发送飞书
PRODUCT_URL='https://jujubit.ai/products/customize-your-own?variant=62485711716723' \
ALLOW_PRODUCTION_GENERATION=true \
SCHEDULED_TRACKING_ENABLED=false \
npx playwright test tests/00-safe-cases.spec.ts tests/full-flow-inventory.spec.ts tests/generation.spec.ts --project=chromium

# 只运行 TC-03
ALLOW_PRODUCTION_GENERATION=true npm run test:core-smoke

# 运行全部活跃实验；会员 Treatment 会真实生成一次
ALLOW_PRODUCTION_GENERATION=true npm run test:experiments

# 只运行会员 Control / Treatment 实验
ALLOW_PRODUCTION_GENERATION=true npm run test:experiments:membership

# 模拟远端按实验执行并发送结果通知
SCHEDULED_TEST_MODE=experiment EXPERIMENT_KEY=membership npm run test:scheduled

# 飞书 @机器人：会员实验（事件桥接进程，部署在云 VM/容器）
npm run feishu:experiment-bot

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

计划使用 GitHub 托管 Runner。工作日计划任务使用 `daily` 模式执行 TC-01～TC-05；需要时也可在 Actions 页面通过 **Run workflow** 手动选择 `safe`、`daily`、`all` 或 `experiment`。

GitHub 的原生 `schedule` 在高负载时可能延迟，甚至晚于计划时间数小时；错开整点只能降低概率，不能保证准点。若必须严格准点，需要使用独立云端定时器调用 `workflow_dispatch`。

结果卡片中的“开始时间”是 GitHub Runner 实际开始执行的时间，不是 cron 计划时间。例如 11:17 的计划任务若到 16:06 才获得调度，会在用例完成后的 16:29 左右发送卡片；这不代表 16:06 新增了一条定时配置。

工作日 `schedule` 使用 `daily` 模式，只执行 TC-01～TC-05。实验执行通过 `workflow_dispatch` 的 `experiment` 模式完成；当前注册 `membership`（TC-EXP-01 + TC-06）和 `canvas`（TC-02 + TC-EXP-02）。

远端工作流需要配置以下 GitHub Actions Secrets：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_GROUP_CHAT_ID
FEISHU_EXECUTION_RECORDS_PARENT
```

点名实验的事件桥接服务另需配置 `GITHUB_TOKEN`（fine-grained，仅该仓库 `Actions: write`）、`GITHUB_REPOSITORY`、`GITHUB_WORKFLOW_FILE`、`GITHUB_REF`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`；`GITHUB_TOKEN` 只放在桥接服务的密钥管理器中，不写入仓库或日志。

可选 Actions Variable：`PRODUCT_URL`。每次运行都会上传 `playwright-report/` 与 `test-results/` Artifact，保留 14 天。失败时机器人会在 `FEISHU_EXECUTION_RECORDS_PARENT` 指向的 Wiki 节点下创建失败记录；机器人需要是该知识库成员，并具备创建子页面和编辑权限。

## 生产影响与安全边界

`all` 模式会发现 8 条 UI 用例，其中 TC-03、TC-04、TC-05、TC-06、TC-EXP-01 各创建 1 条真实生成任务，TC-EXP-02 创建 3 条；TC-03 会加购并进入 Checkout，TC-05 删除本次创建的最新 History，会员和画板实验均不付款、不提交订单。`daily` 模式只执行 TC-01～TC-05；实验点名模式只执行对应实验的 Control + Treatment。运行前请确认生成成本、购物车和 History 的影响。

## 实验自动化

实验配置统一维护在 `tests/experiments/experiment-registry.ts`，每个实验登记实验名、参数名、生命周期、环境、负责人、关联用例及各分组固定 stable_id。飞书命令与执行文件统一登记在 `automation/experiment-command-registry.json`，包含实验 key、中文命令别名、spec、用例编号和启用状态。`experiment.fixture.ts` 负责导航前注入、Statsig storage key 计算、实际分组校验和报告注解；`tests/zz-experiments/` 下的业务 spec 只负责对应分组的 UI 行为。

新增实验时：先为每个分组准备独立 stable_id，在 TypeScript 注册表登记分组期望值并编写两组 UI 断言，再在 JSON 命令注册表增加一项。妙搭机器人运行时读取主仓库注册表，无需重新修改或发布机器人。一个 stable_id 不应复用于多个实验，避免组合分流污染。实验结束后将生命周期改为 `rolled_out` 或 `stopped`、将命令项设为 `enabled=false`，并把最终行为迁移回基础回归。

若站点对 GitHub 托管 Runner 的共享出口返回 `HTTP 429` 或 `legal-rate-limited`，应使用固定出口 IP 的 self-hosted Runner；测试会保留限流证据而非继续等待元素超时。

### 飞书点名执行实验

飞书命令桥接服务已部署到妙搭云端应用 `JuJuBit 实验自动化机器人`（`app_17dsjs7c59z`），不依赖本地电脑。`sp-ui自动化机器人` 通过开发者服务器订阅 `im.message.receive_v1`；群内发送 `@sp-ui自动化机器人 会员实验` 后，云端服务会调用 GitHub `workflow_dispatch`，传入 `mode=experiment`、`experiment=membership` 和原群 `chat_id`。远端只执行 TC-06 与 TC-EXP-01；Playwright 完成后，结果卡片发送回触发消息所在群。回调 URL 使用保存在妙搭在线环境中的随机路径密钥校验，GitHub Token 也只保存在妙搭在线环境中，不写入仓库。

群内发送 `@sp-ui自动化机器人 画板实验` 时，只执行 TC-02（Control，`canvas_template_display.group=control`）与 TC-EXP-02（Treatment，`group=test_2`）。Treatment 一次会真实创建 Free Style、TRPG、Soft Chibi 三条生成记录，不会加购、下单或付款。

实验命令成功提交 GitHub 后，机器人会立即回复“已收到，正在执行中”；执行结束后再发送包含逐条用例名称和状态的最终结果卡片。即时回复失败只记录日志，不会让飞书事件重试或重复生成。

机器人只接受注册表中启用的精确命令别名；未知实验不会回退到 `all`。超过 10 分钟的消息重投会被忽略，GitHub 还会按飞书 `event_id` 保存 重复标记。云端 `schedule` 被工作流显式锁定为 `daily`，始终只执行 TC-01～TC-05。

结果卡片除通过率、失败数、跳过数和耗时外，还会在“用例明细”中逐条展示用例序号、名称与状态；实验模式可直接看到 Control 与 Treatment 两条用例的独立结果。

仓库中的 `automation/feishu-experiment-bot.mjs` 和 `automation/feishu-experiment-command.mjs` 保留为自建 VM/容器的备用实现；线上当前使用妙搭 Webhook 服务。

## 埋点专项

埋点测试与 UI 回归独立，使用 `playwright.tracking.config.ts` 和 `tests/tracking/`。默认仅允许非生产环境；生产验证必须显式设置 `ALLOW_PRODUCTION_TRACKING=true`。

```bash
# 完整埋点审计：analytics + 有效目录审计
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

完整有效目录审计会执行一次真实 2D/3D 生成和一次加购，但不会进入 Checkout、删除生产 History 或付款。有效目录会排除源文档中划线删除项和“异常”类型项；毕业季埋点、漏斗指标、AB 实验组映射表不纳入本目录。异常注入仅允许 Preview/本地地址，使用接口 Mock 和浏览器故障注入；未命中 Mock 不会被误报为通过。

采集器验证 GA4、Statsig 和 Monitor 的浏览器请求。每项契约均要求：动作/有效曝光后至少上报一次、请求已发起且无敏感字段。参数按本次实际发送值记录；缺少目录中列出的参数不单独判失败。重复上报也不会单独判失败，但会在 JSON 与飞书执行文档的“上报次数与参数明细”表格中如实统计。表格列为“序号、标识、动作、参数、上报平台、上报次数”；全部有效目录项均进入同一张表，skipped 行标红并展示跳过原因，已执行但所有目标平台均上报 0 次的行标黄。多平台事件在“上报次数”单元格内换行展示，例如 `GA4上报2次`、`Statsig上报1次`。HTTP 回执仅作为平台接收证据，不是前端上报通过的硬条件。

埋点运行完成后会在 `FEISHU_TRACKING_RECORDS_PARENT` 下创建执行记录；机器人需要被添加到对应 Wiki 并具备编辑权限。

## 结果、证据与定位

| 内容 | 位置 |
| --- | --- |
| HTML 报告 | `playwright-report/` |
| JSON 结果 | `test-results/results.json` |
| 失败截图、视频、trace、错误上下文 | `test-results/` |
| 埋点 HTML 报告 | `playwright-tracking-report/` |
| 埋点有效目录审计 JSON | `test-results/tracking-catalog-audit.json` |
| TC-03 页面元素快照 | `generation-elements.json`、`cart-elements.json`、`checkout-elements.json` |

普通交互最多等待 2 分钟；2D 与 3D 生成各最多 5 分钟。2D 验证图片资源实际加载；3D 等待进度层消失、Add to Cart 可用，并验证横向拖动后画面变化。Checkout 仅校验订单摘要、地址表单、折扣入口和 `Pay now` 可见。

线上尚未提供稳定的 `data-testid`，定位器以无障碍名称、`data-view-name` 和局部结构为主。页面改版后，优先复核生成图片、3D 进度层、工具图标、购物车商品及 Checkout 关键区域的定位器。

## 飞书权限与本地授权

企业应用需启用机器人能力，并具备 `im:message:send_as_bot`、图片/文件上传及目标 Wiki 编辑权限。需要本地操作飞书文档时，先完成用户授权：

```bash
lark-cli auth login --domain docs --domain drive
lark-cli auth status --json --verify
```
