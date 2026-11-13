# JuJuBit UI 自动化

Playwright + TypeScript 游客态回归。此工程保留当前远端用例、新画板同业务链路，以及运行它们所需的诊断和验证代码。**不填写支付资料、不点击最终支付、不提交订单。**

本文描述本次发布版本：每小时运行画板双组7条，TC-001保留独立每日任务。手动全部执行入口覆盖表内8条用例；以GitHub运行记录的提交号核实实际版本。

## 全部用例（一张表）

| 用例 | 业务步骤与验收 | 执行入口 / 真实影响 |
| --- | --- | --- |
| TC-00 | 首页店铺身份、Logo、导航、Create入口、主要模块和视觉资源健康检查；促销条容器、样式和活动文案不作必需断言 | 每小时daily；无生成 |
| TC-001 | 首页安全按钮、Tab、FAQ、币种和购物车入口交互，检查新增JS/5xx异常；促销条箭头仅存在时检查，缺省记录不适用 | 每日18:00独立巡检；无生成 |
| TC-01 | 点击主导航唯一Create → 创作页 → 自定义器及Gallery可见 | 每小时daily；无生成 |
| TC-02 | Free Style→TRPG→Free Style、Solo→Duo→Solo、Prompt编辑、Pro/Basic工具 | 每小时daily；无生成 |
| TC-03 | 上传图片 → 真实生成2D/3D → 两秒旋转 → 本轮资产加购 → 购物车 → Checkout商品及支付入口 | 每小时daily；生成、加购；不支付 |
| TC-04 | 上传→提交生成→直接返回Create→Generate可用；不等2D/3D、不重新上传、不点第二次Generate | 每小时daily；后台任务可能继续 |
| TC-05 | 图片＋Prompt生成 → 2D/3D及旋转 → History新增 → UI确认删除本轮资产 | 每小时daily；生成、精确删除 |
| EXP-TC-01 | 进入新画板→3D Preview出现→上传图片→Duo→TRPG→Generate→真实2D/3D完成→旋转与放大缩小→本轮资产加购→购物车→Checkout商品及支付入口 | 每小时daily实验组；生成、加购，不支付、不删除 |

双组入口为**画板对照组TC-00～05六条＋画板实验组EXP-TC-01一条，共7条**。其他新画板实验用例已删除，不再发现或执行。TC-001仍独立运行；会员TC-06／TC-EXP-01已删除，点名入口同步移除。对照组仍先05后04，避免后台任务干扰完整生成检查。

## 本地运行

当前实现与本地验证目录：`/Users/macbookair/Desktop/开发代码/自动化/sp_ui_test-browser-guard`。下列命令在此目录执行。常用旧目录`/Users/macbookair/Desktop/开发代码/自动化/sp_ui_test`保留用户未提交代码，本次仅同步README；文档相同不代表代码已更新。合并仓库副本位于`/Users/macbookair/Desktop/shop-test-agent-s/projects/sp_ui_test`。不以强制覆盖或reset同步旧目录。

```sh
npm ci
npx playwright install chromium
npm run test:smoke                         # TC-00～TC-02，不生成
npm run test:daily:confirmed               # 原六条，真实生成/加购/本次History删除
npx playwright test tests/home-clickable.spec.ts --project=chromium
npm run validate                          # 类型、语法、单元、默认发现；不执行线上case
```

素材为`assets/two-dogs.jpeg`；可通过`TEST_IMAGE_SOLO`等变量指定。生成用例必须显式允许，不配置时会跳过；跳过不是业务通过。不运行通知命令即可避免向飞书发送本地结果。

## 新画板实验（仅 EXP-TC-01）

文件：`experiments/canvas-v3/daily-parity.spec.ts`，只保留一条正常业务链路，不再单独执行Prompt、增信弹窗、返回Create或History删除实验。历史报告保留，不改写历史结果。

`test:canvas:stable`按真实stable_id分组，两个组用独立游客上下文，不强制开关；检查SDK实际ID、`canvas_v3_109.enable`与实际画板一致。不依赖独立的增信实验。旋转必须改变相机角度，放大/缩小必须分别缩短/增大相机距离，不能只凭鼠标动作判通过。加购核对本轮Asset ID，Checkout只校验商品与支付入口。

```sh
# 只查看当前实验用例，不运行或覆盖执行报告
CANVAS_PARITY_BASE_URL=https://jujubit.ai CANVAS_TREATMENT_STABLE_ID=2 npm run test:canvas:stable -- --list --reporter=list
# 有头执行唯一实验用例，账本使用当天共享QA账本的绝对路径
CANVAS_PARITY_BASE_URL=https://jujubit.ai CANVAS_TREATMENT_STABLE_ID=2 CANVAS_PARITY_ALLOW_GENERATION=true CANVAS_PARITY_LEDGER=/absolute/path/today-ledger.json npm run test:canvas:stable -- --headed
```

只设置实验ID就只跑实验组。需要两组共7条时，再加`CANVAS_CONTROL_STABLE_ID=1 ALLOW_PRODUCTION_GENERATION=true CONFIRM_PRODUCTION_GENERATION=YES TEST_IMAGE_SOLO=assets/two-dogs.jpeg`。本地两组共用当天账本，动作前预留，不提交账本。只换ID适用于同一实验名、参数和页面链路；不要复用其他实验ID。

### 操作速度与双组并行

本地`--headed`默认每个Playwright操作减速1.5秒，方便观察；已有对照case自己的停顿仍保留，因此不是精确每1.5秒一步。可用`UI_ACTION_DELAY_MS=1000`／`2000`调整，设`0`关闭；CI和无头默认不减速。这只是演示节奏，不代替元素等待：可点击动作最多60秒、导航120秒，生成2D/3D各阶段仍按原等待期限；TC-04返回后Generate可用性的10秒断言不变。超时、HTTP异常和明确生成失败仍失败，不靠固定暂停忽略。

加`CANVAS_PARALLEL_GROUPS=true`可在本地并行对照/实验两个项目：总共最多2个worker，每组最多1个、组内串行，每条case仍使用隔离浏览器上下文。默认串行，CI/GitHub Actions拒绝开启此开关；本次不改远端定时并发策略。本地并行演示中出现过cart.js超时，不据此认定并行必然导致故障，但尚不建议用于远端。理论耗时接近较慢一组，生成服务、限流、CPU/GPU或网络竞争可能抵消收益。

稳定性策略：仅白名单站点的首页／创作商品页／购物车GET导航提交，以及`cart.js`只读GET，遇到明确连接中断、提交/请求超时或5xx时最多重试一次，间隔1秒。DOM就绪和元素断言失败不重新导航；403/429、验证码和业务错误不在步骤内重试。Checkout按钮只点击一次，Checkout文档不自动刷新，避免重放跨域或表单请求。生成POST、加购POST、删除DELETE都不自动重放；整条失败case仍按原规则最多复核一次，复核可能新建任务，首次证据保留。

分组校验复用case自己的页面：进入画板就检查，点击Generate前再核对实际ID/实验/画板及访问状态，不额外提前打开创作页。新画板2D/3D等待中持续检查访问阻断和明确错误／Retry，生成失败立即保留原因，不傻等满5分钟。图片完整加载、model-viewer.loaded、真实旋转缩放、本轮Asset ID加购核验均保留。

`cart.js`通过当前页面的同源浏览器GET读取，沿用页面会话与网络路径，避免Node接口客户端和浏览器代理路径不同；30秒超时覆盖响应头和响应体，5xx/连接失败最多再查一次，Cookie不复制到日志。`read-only-diagnostics`记录每次状态、耗时及是否重试，不记录请求头；只读恢复在卡片标橙色，提示不等同首次无异常。分类区分访问阻断、实验前置、只读HTTP/传输异常、生成失败/超时及资产/加购核验问题；未知根因不猜成网络。Trace、截图、Task/Asset/Trace/Request ID和首次/复核证据继续保留。

工作流由`CANVAS_AB_ENABLED=true`启用7条双组回归，仓库变量`CANVAS_CONTROL_STABLE_ID`／`CANVAS_TREATMENT_STABLE_ID`可换ID（默认1/2）。正常生成4次，最多单case复核一次，共最多8次；不无限重试。合并仓库的开发发布入口仍为原daily六条，不自动加实验组。

手动选择`mode=all`会使用独立`all.config.ts`，执行上表8条：双组7条＋TC-001。报告增加第三个折叠区展示TC-001，漏项、重复、跳过均不能标为全量通过。工作流可填写已验证的个人单聊`personal_chat_id`将**该次手动执行**的结果私发；先核实会话为p2p且机器人可发消息，避免误用群ID或其他应用的个人open_id。留空沿用`chat_id`或原群配置，定时任务不填此项。

Preview入口`test:canvas`仅强制开启新画板开关，不修改增信实验、不证明真实分桶：

```sh
npm run typecheck:canvas
CANVAS_PARITY_BASE_URL=https://YOUR-PREVIEW.shopifypreview.com npm run test:canvas -- --list --reporter=list
# 执行时同样需要显式生成授权和当天账本，不提交私有账本。
CANVAS_PARITY_BASE_URL=https://YOUR-PREVIEW.shopifypreview.com CANVAS_PARITY_ALLOW_GENERATION=true CANVAS_PARITY_LEDGER=/absolute/path/ledger.json npm run test:canvas
```

Preview只允许HTTPS预览或授权开发店；真实分组需显式指定线上或开发店地址。历史未提交的个人目录和报告不因本次删case而清理；当前正式入口只发现EXP-TC-01。

## 远端触发与飞书

- `ui-regression.yml`：每小时画板双组7条，串行执行、一次汇总；小时槽、`:30`兜底与去重不变。网络/DNS仍可能失败。
- `homepage-clickable.yml`：TC-001每天18:00主触发、18:30兜底，按日期去重。**保留此工作流及依赖。**
- `feishu-failure-video.yml`：按请求提供失败视频。机器人对话、执行命令、报告、视频和原群路由不因清理改变。
- `automation/experiment-command-registry.json`：会员实验和旧`canvas_template_display`点名入口均已移除，当前注册表为空。新画板通过双组或全量入口执行，不冒用旧canvas命令。
- 首次失败冷却30秒，独立浏览器单case复核一次。复核恢复仍保留首次原因和证据；持续阻断不标通过。无无限刷新/验证码点击，无case中途清Cookie重生成。

画板卡片保留“画板对照组／画板实验组”两个收起面板（6条／1条），展开查看case、首次/复核原因、生成标识与GA Cookie。顶部保留失败提示；缺组、重复、跳过或出现退役用例不能冒充7条通过。TC-001独立通知保留。

成功卡片沿用简洁结果样式；失败卡片恢复原来的状态标签、通过率／失败数／跳过与耗时、运行信息和失败原因区域，同时保留双组折叠明细。全量执行增加TC-001折叠区，GA Cookie两值继续逐case展示。2D切换按钮在原5分钟阶段预算内等待可操作；只对幂等视图切换的短暂点击超时继续观察，每轮仍检查站点验证和明确生成错误，不重新提交Generate。

机器人需要配置`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、目标接收人/群和可选失败文档父节点；调度桥接所需GitHub Token仅放私有配置/云端Secret。禁止提交`.env`、Token或浏览器会话。GitHub队列/网络延迟仍可能影响准点执行。

### 每次卡片都保留的两个值

**GA Cookie诊断**区域按case展示`cookieValue`和`cookieClientId`。只读`document.cookie`中`_ga`，按`/^GA\d+\.\d+\.(.+)$/`解析ID；成功、失败、复核后卡片及文本通知均保留。首次和复核是独立会话，分别标注，不相互借值；缺失显示“未采集”。采集失败不改变case结果、不收集其他Cookie。

**`sdk_anonymous_id=test`保留**：在目标站点脚本执行前注入字符串`test`，日常、TC-001及新画板均使用。实际键是`sdk_anonymous_id`，不新增`sak_anonymous_id`；不改业务`_anonymous_id`、实验stable ID或第三方支付域名。此标记不证明服务端数据隔离或埋点已排除。

## 诊断与安全

`test-results/`保存JSON、截图、视频、Trace、运行资产审计，`playwright-report/`保存HTML，远端Artifact保留14天。生成失败采集Task/Asset/Trace/Request ID、错误码、原因与时间；未取得的字段不猜测。浏览器关闭不代表后台任务取消。

TC-03核验本轮Asset ID、加购行键和购物车持久化；TC-05按本轮响应图片唯一定位卡片、保护DELETE资产ID，不删未知历史数据。验证阻断、网络问题、生成超时及明确业务失败分别归类，不降低业务断言。

`verification/`是框架本身的本地模拟测试，不属于额外远端业务case：导航、生成等待、Checkout、身份和资产归属。保留这些检查是为了防止清理引入误报，而非扩展日常回归。

## 目录与双仓库维护

```text
tests/                  当前远端case、Page Object、fixture
experiments/canvas-v3/  新画板唯一实验用例，独立配置
automation/             触发、复核、卡片、诊断、视频和自身单元测试
verification/           框架模拟验证，独立于线上执行集合
.github/workflows/      原有三个远端入口
```

维护源：`duanzhiwei-arthur/sp_ui_test`；发布副本：`vast-enterprise/shop-test-agent-s/projects/sp_ui_test`。修改必须同步两端共享代码；保留副本专用`playwright.release.config.ts`及根发布入口和其他工程。根发布入口仍默认只跑daily六条，不发送原定时通知。

```sh
node automation/check-project-sync.mjs /path/to/sp_ui_test /path/to/shop-test-agent-s
```

只读比较已提交版本，不自动覆盖工作区。已删除埋点专项、旧多模板画板case、历史元素快照、首页源码抓取和重复说明；旧版可从Git历史恢复，未删除个人报告/素材或原工作区未提交内容。

## 群内手动完整执行

群内 `@机器人 运行用例`、`执行自动化`、`运行全部用例` 或 `执行全部的对照组和实验组` 统一提交 `ui-regression.yml` 的 `mode=all`，执行对照组 TC-00～TC-05、实验组 EXP-TC-01 和首页点击检查 TC-001，共 8 条。通过 `chat_id`、`event_id` 将分组报告与失败证据发回请求群；不填写定时去重键或个人接收人。暂停定时通知不影响主动执行及该次结果回复，小时定时仍保持双组 7 条。

## 群内定时通知开关

最终失败提醒仅@段志伟、吴奇波、王亚珍、三酱（邓雄飞）、国庆（李国庆）、柯男（陈柯男）、余快，不再@所有人。发送应用实时读取目标群完整成员列表，按已核实的姓名／别名唯一匹配；成员缺失、同名或权限不足时跳过定向提醒并保留日志，结果卡片仍发送。成功、复核恢复、私聊不触发提醒；暂停群定时通知仍一起暂停提醒。`FEISHU_FAILURE_MENTIONS_ENABLED=false`关闭定向提醒，旧`FEISHU_MENTION_ALL_ON_FAILURE=false`继续兼容；Webhook只发结果文本，不使用其他应用的open_id。

群内任何人真正 `@机器人 停止通知` / `开启通知` / `通知状态` 即可控制本群通知，不限制管理员名单。只暂停定时结果卡片、失败提醒和视频，不停止测试；手动执行/查询不受影响。设置按群持久化，恢复不补发历史通知。

部署需同时配置机器人运行环境和 Actions 的 `FEISHU_NOTIFICATION_TOKEN`（Variables 权限），以及机器人 `FEISHU_BOT_OPEN_ID`。读开关异常时保护性跳过定时群通知，不改变测试结果。步骤与验证见 [通知开关说明](automation/NOTIFICATION-CONTROL.md)。

## 本人专用飞书编程

机器人新增独立私聊编程入口：一次性绑定本人后，`改代码：需求`生成并静态检查草稿；`发布代码 任务编号 完整提交SHA`才将对应改动发布到本仓库并同步项目副本。仅固定sp_ui_test仓库，不开放给其他群成员。公开仓库的草稿分支也公开可见。支持范围、身份绑定和配置见[编程助手](automation/CODING-ASSISTANT.md)。

## 本人私聊截图消息

已绑定的本人可在机器人私聊直接发送图片或包含截图和文字的图文消息，无需@。接收后先回执，再通过本条消息资源API读取图片，使用现有gpt-6.1-sol接口分析；查询实际运行状态仍核对GitHub证据。每条最多4张，单张不超过8MB、合计12MB，支持PNG/JPEG/WebP/GIF；失败或不支持的附件会明确回复。截图中的引用指令不构成改代码/发布授权。图片仅驻留任务内存，不写入源码或报告。

## 私聊结果卡片定位

“15点定时任务”按北京时间日期与run-marker-hourly档位匹配，不能取稍后启动的手动全量任务。“上一次已经执行完毕的卡片”取最近已完成运行，不是最近失败；指定Run编号优先。报告按Run、提交SHA及尝试次数核验后由程序生成实际分组卡片，显示首次通过、复核恢复、失败或报告缺口。没有报告不凭工作流success宣称用例全部通过，无法匹配时不替换成其他任务。主动请求卡片不触发重跑或改变定时通知开关。
