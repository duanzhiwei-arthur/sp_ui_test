# 导航健壮性与可观测性（2026-10-26）

## 成功标准没有放宽

`tests/pages/navigation.ts` 替代 HomePage/CreatePage 的单次300秒导航等待：

1. 45秒内取得导航提交响应，校验HTTP 2xx/3xx最终响应。
2. 60秒内确认DOMContentLoaded，不把commit/首屏有画面当通过，不刷新或重新提交生成。
3. 3秒内验证主页面事件循环能执行一次100ms计时回调。
4. 原有店铺身份、模块、资源、生成、加购及Checkout断言继续执行。

导航失败分为NAV_RESPONSE/NAV_HTTP/NAV_DOM_READY/NAV_RENDERER；附件包含原始阶段、状态和截断说明。
导航等待预算与300秒用例预算分开；自定义页原有等待逻辑仍保留。较短导航预算可能把非常慢但最终成功的页面更早标记失败，这是明确的就绪阈值而不是自动判误报。

## 诊断不阻塞、不过度采集

日常TC-00～TC-05启用自动fixture，成功/失败均附加runtime-diagnostics；失败另尝试短时截图。
记录DCL/load/crash/关闭、页面和控制台错误、HTTP异常、请求失败、未结束请求；同URL并发请求按对象区分，收到响应头不等于请求结束。
最多100条事件、200条在途请求，并记录截断计数。主页面状态探测有2秒硬截止，渲染线程无响应也不会无限等。
不保存请求头、请求体、查询串、checkout标识及上传URL；脚本错误文本脱敏。错误日志只作证据，不把所有第三方错误直接判Case失败。
已有JSON/Trace保留；失败诊断被加入轻量ui-diagnostics包，机器人可读取。未修改机器人执行权限或模型配置。

## 失败录像

没有截图/截图上传失败 → 尝试从原录像抽帧上传封面 → 转为MP4发送。
ffmpeg缺失、抽帧失败、转码超时或媒体发送失败 → 发送原WebM文件。最终文件上传失败仍保留告警，不冒称已发送。
抽帧最长30秒，转码最长120秒；临时封面目录清理。云端两种巡检工作流新增最多3分钟、非阻断的ffmpeg准备步骤；时间表达式、用例范围、去重和接收群均未变化。

## 本地验证（不发送消息）

```sh
npm run typecheck
npm run syntaxcheck
npm run test:unit
npx playwright test --config verification/navigation/playwright.config.ts
npx playwright test --config verification/checkout/playwright.config.ts
# 用户明确授权后，真实生产生成/测试加购，绝不支付
ALLOW_PRODUCTION_GENERATION=true CONFIRM_PRODUCTION_GENERATION=YES npm run test:daily
```

导航验证使用本机HTTP模拟服务；不向生产注入故障。正式生产不禁用脚本、不加无限重试、不跳过断言。
当前每轮共享生成许可意味着仍不自动重试真实生成，避免额外配额和重复任务。

## 本次验证记录

2026-10-26，本地独立无头 Chromium / Playwright 1.61.1 / Node 26：

| 范围 | 结果 |
| --- | --- |
| TypeScript + JavaScript语法检查 | 通过 |
| 单元/策略/通知降级与诊断包检查 | 29/29通过 |
| 本机HTTP服务导航边界场景 | 9/9通过 |
| Checkout契约验证（支付点击计数仍为0） | 10/10通过 |
| 真实线上日常TC-00～TC-05 | 6/6通过，0跳过、无重试，总耗时9.6分钟 |
| 附件落盘复核TC-00～TC-02（无生成） | 3/3通过，JSON中实际含runtime-diagnostics，HTML报告已生成 |
| 历史失败WebM抽帧 | 成功取得800×450 JPEG封面 |

真实回归中TC-00耗时6.8秒、TC-01为27.3秒、TC-02为58.3秒、TC-03约3.4分钟、TC-05约4.1分钟、TC-04为30.3秒。
日常运行使用列表报告器，结果见本次执行日志；附件复核另存独立目录，不把旧HTML报告冒充六条回归报告。
没有真实支付，没有发送验证群消息。未运行会员实验、历史下线实验及尚在本地修改中的TC-001；未修改这些用例内容。
本地通过不等于Linux runner已验证，也不保证消灭所有偶发故障；远端新提交首轮仍需观察。
