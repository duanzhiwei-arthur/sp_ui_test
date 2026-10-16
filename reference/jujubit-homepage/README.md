# JuJuBit 首页公开源码快照

运行以下命令会下载 `https://jujubit.ai/` 当前公开返回的原始 HTML，以及 HTML 直接引用的 JavaScript/CSS，并生成资源清单：

```bash
node automation/capture-homepage-source.mjs
```

输出位于 `reference/jujubit-homepage/source/`。该目录是运行时快照，不提交到 Git。

公开页面无法提供 Shopify 服务端模板、数据库、后台接口实现或未公开源代码；这些内容不属于此快照。
