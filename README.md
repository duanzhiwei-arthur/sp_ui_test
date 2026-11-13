# JuJuBit UI 自动化

Playwright + TypeScript 游客态回归。此工程保留当前远端用例、新画板同业务链路，以及运行它们所需的诊断和验证代码。**不填写支付资料、不点击最终支付、不提交订单。**

## 全部用例（一张表）

| 用例 | 业务步骤与验收 | 执行入口 / 真实影响 |
| --- | --- | --- |
| TC-00 | 首页店铺身份、导航、主要模块和视觉资源健康检查 | 每小时daily；无生成 |
| TC-001 | 首页安全按钮、Tab、FAQ、币种和购物车入口交互，检查新增JS/5xx异常 | 每日18:00独立巡检；无生成 |
| TC-01 | 点击主导航唯一Create → 创作页 → 自定义器及Gallery可见 | 每小时daily；无生成 |
| TC-02 | Free Style→TRPG→Free Style、Solo→Duo→Solo、Prompt编辑、Pro/Basic工具 | 每小时daily；无生成 |
| TC-03 | 上传图片 → 真实生成2D/3D → 两秒旋转 → 本轮资产加购 → 购物车 → Checkout商品及支付入口 | 每小时daily；生成、加购；不支付 |
| TC-04 | 提交生成 → 返回Create → 再次上传 → Generate可用；不点第二次Generate | 每小时daily；后台任务可能继续 |
| TC-05 | 图片＋Prompt生成 → 2D/3D及旋转 → History新增 → UI确认删除本轮资产 | 每小时daily；生成、精确删除 |
| TC-06 | 会员Treatment：上传→Generate触发实验→分桶核验→会员入口、弹窗及Join去向 | 会员实验点名；生成，不支付 |
| TC-EXP-01 | 会员Control：同上传→Generate路径→分桶核验→会员入口不展示 | 会员实验点名；生成 |
| EXP-TC-01 | 首页Create进入新画板；3D Preview步骤、V3与增信同时生效 | 新画板独立配置；Preview/开发店 |
| EXP-TC-02 | 模板菜单切换、Settings Solo/Duo、内联Prompt、三个增信弹窗开关 | 新画板独立配置；无生成 |
| EXP-TC-03 | 同源图片→真实2D/3D完成→旋转→加购→购物车→Checkout商品及支付入口 | 新画板独立配置；生成、加购，不支付 |
| EXP-TC-04 | 真实任务提交后返回Create→替换图片→Generate可用，不提交第二次任务 | 新画板独立配置；后台任务可能继续 |
| EXP-TC-05 | 图片＋Prompt真实生成→2D/3D及旋转→History新增→只删除本次记录 | 新画板独立配置；生成、精确删除 |

同表展示不代表一起定时执行：daily仍是 **TC-00～TC-05六条**；TC-001保持独立时间；会员实验仍是两条点名执行。新画板5条尚未接入生产定时，不改变原回归范围。执行顺序可能将TC-05放在TC-04前，避免后台任务干扰完整生成检查。

## 本地运行

下列命令对应整理后的代码版本。**README更新不等于工作区代码已更新**：保留未提交修改的旧工作区，先核对`git log -1 --oneline`及`package.json`，不要用强制覆盖来同步代码。旧工作区的新画板文件可能仍在`manual-qa/canvas-v3-daily-parity/`；整理后统一位于`experiments/canvas-v3/`，两者不是两套新增case。

```sh
npm ci
npx playwright install chromium
npm run test:smoke                         # TC-00～TC-02，不生成
npm run test:daily:confirmed               # 原六条，真实生成/加购/本次History删除
npx playwright test tests/home-clickable.spec.ts --project=chromium
ALLOW_PRODUCTION_GENERATION=true CONFIRM_PRODUCTION_GENERATION=YES npm run test:experiments:membership
npm run validate                          # 类型、语法、单元、默认发现；不执行线上case
```

素材为`assets/two-dogs.jpeg`；可通过`TEST_IMAGE_SOLO`等变量指定。生成用例必须显式允许，不配置时会跳过；跳过不是业务通过。不运行通知命令即可避免向飞书发送本地结果。

## 新画板同业务链路

文件：`experiments/canvas-v3/`，来源为原工作区的`manual-qa/canvas-v3-daily-parity/`五条，不是已下线的旧多模板实验。

目前保留原Preview验证机制：`_statsig_override`同时设置`canvas_v3_109.enable=true`、`canvas_trust_info.enable=true`，并检查实际V3结构和增信入口。**这是测试覆盖配置，不是stable_id真实线上分桶对比**；不要以“传了stable ID”冒充实际命中。

```sh
npm run typecheck:canvas
CANVAS_PARITY_BASE_URL=https://YOUR-PREVIEW.shopifypreview.com npm run test:canvas -- --list
CANVAS_PARITY_BASE_URL=https://YOUR-PREVIEW.shopifypreview.com npm run test:canvas -- --grep 'EXP-TC-01|EXP-TC-02'
# 生成类需保留原显式授权和当天账本；账本可用limit:null表示已授权不限，不提交账本。
CANVAS_PARITY_BASE_URL=https://YOUR-PREVIEW.shopifypreview.com CANVAS_PARITY_ALLOW_GENERATION=true CANVAS_PARITY_LEDGER=/absolute/path/ledger.json npm run test:canvas
```

仅允许HTTPS Preview或授权开发店，不默认访问生产。用例对照关系见总表；V3没有旧Pro/Basic入口，该子项明确为UI差异，不声称已验收。原未提交目录保留不删除；精简工程只纳入这五条正式对应链路。

## 远端触发与飞书

- `ui-regression.yml`：每小时daily。外部定时器主触发，GitHub每小时`:30`兜底；按北京时间小时槽去重。实验由手动/飞书命令触发，不混入daily。
- `homepage-clickable.yml`：TC-001每天18:00主触发、18:30兜底，按日期去重。**保留此工作流及依赖。**
- `feishu-failure-video.yml`：按请求提供失败视频。机器人对话、执行命令、报告、视频和原群路由不因清理改变。
- `automation/experiment-command-registry.json`：当前点名会员实验；旧`canvas_template_display`已退役，不再保留死case或失效命令。新画板暂不冒用旧canvas命令。
- 首次失败冷却30秒，独立浏览器单case复核一次。复核恢复仍保留首次原因和证据；持续阻断不标通过。无无限刷新/验证码点击，无case中途清Cookie重生成。

机器人需要配置`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、目标接收人/群和可选失败文档父节点；调度桥接所需GitHub Token仅放私有配置/云端Secret。禁止提交`.env`、Token或浏览器会话。GitHub队列/网络延迟仍可能影响准点执行。

### 每次卡片都保留的两个值

**GA Cookie诊断**区域按case展示`cookieValue`和`cookieClientId`。只读`document.cookie`中`_ga`，按`/^GA\d+\.\d+\.(.+)$/`解析ID；成功、失败、复核后卡片及文本通知均保留。首次和复核是独立会话，分别标注，不相互借值；缺失显示“未采集”。采集失败不改变case结果、不收集其他Cookie。

**`sdk_anonymous_id=test`保留**：在目标站点脚本执行前注入字符串`test`，日常、TC-001、会员及新画板均使用。实际键是`sdk_anonymous_id`，不新增`sak_anonymous_id`；不改业务`_anonymous_id`、实验stable ID或第三方支付域名。此标记不证明服务端数据隔离或埋点已排除。

## 诊断与安全

`test-results/`保存JSON、截图、视频、Trace、运行资产审计，`playwright-report/`保存HTML，远端Artifact保留14天。生成失败采集Task/Asset/Trace/Request ID、错误码、原因与时间；未取得的字段不猜测。浏览器关闭不代表后台任务取消。

TC-03核验本轮Asset ID、加购行键和购物车持久化；TC-05按本轮响应图片唯一定位卡片、保护DELETE资产ID，不删未知历史数据。验证阻断、网络问题、生成超时及明确业务失败分别归类，不降低业务断言。

`verification/`是框架本身的本地模拟测试，不属于额外远端业务case：导航、生成等待、Checkout、身份和资产归属。保留这些检查是为了防止清理引入误报，而非扩展日常回归。

## 目录与双仓库维护

```text
tests/                  当前远端case、Page Object、fixture、会员实验
experiments/canvas-v3/  新画板五条同业务链路，独立配置
automation/             触发、复核、卡片、诊断、视频和自身单元测试
verification/           框架模拟验证，独立于线上执行集合
.github/workflows/      原有三个远端入口
```

维护源：`duanzhiwei-arthur/sp_ui_test`；发布副本：`vast-enterprise/shop-test-agent-s/projects/sp_ui_test`。修改必须同步两端共享代码；保留副本专用`playwright.release.config.ts`及根发布入口和其他工程。根发布入口仍默认只跑daily六条，不发送原定时通知。

```sh
node automation/check-project-sync.mjs /path/to/sp_ui_test /path/to/shop-test-agent-s
```

只读比较已提交版本，不自动覆盖工作区。已删除埋点专项、旧多模板画板case、历史元素快照、首页源码抓取和重复说明；旧版可从Git历史恢复，未删除个人报告/素材或原工作区未提交内容。
