# 当前项目状态

更新时间：2026-06-04

## 本地运行

开发地址：

```text
http://localhost:3000
```

常用命令：

```powershell
npm run dev
npm run typecheck
npm run build
```

注意：开发时优先使用 `http://localhost:3000`。如果使用 `127.0.0.1:3000`，Next.js dev server 可能阻止 HMR 资源，导致部分前端交互看起来没有响应。

## 当前已验证

- `npm run typecheck` 通过。
- `npm run build` 通过。
- 首页服务端直接读取 SQLite 真实数据。
- `立即抓取` 可以启动后台采集。
- 页面会每 1 小时自动触发一次后台采集。
- 采集完成后可自动进入 AI 分析链路，前端不再需要单独的 `AI 分析` 按钮。
- 主题筛选、`1天 / 7天` 时间筛选、关注关键词开关、卡片选中后的右侧详情面板均已在浏览器中验证。
- 采集状态栏显示 `抓取 / 新增 / 重复`，用于区分“没有命中”和“命中但已去重”。

## 数据库

当前使用 SQLite + Prisma。

数据库文件：

```text
C:\Users\86198\Documents\suiyunzou-hot-monitor\prisma\dev.db
```

Navicat 查看方式：

- 新建连接类型选择 `SQLite`。
- 数据库文件选择上面的 `dev.db`。
- 不需要主机、端口、用户名或密码。

主要表：

- `WatchKeyword`：用户关注关键词。
- `RawItem`：原始采集线索。
- `HotTopic`：AI 分析后的热点。
- `TopicSource`：热点和原始线索关联。
- `AiAnalysis`：AI 输入输出审计记录。
- `CollectRun`：每次采集运行记录。

## 采集状态语义

`CollectRun.fetchedCount`：
搜索命中的候选数，不等于最终入库数。

`CollectRun.newCount`：
本轮新增入库的 `RawItem` 数。

`duplicateCount`：
候选已经存在于库中，被 `sourceId + url` 去重跳过。该字段保存在 `CollectRun.metadataJson` 中，前端状态栏会显示为 `重复 N`。

`skippedCount`：
由于缺少来源配置等原因跳过的条数，也保存在 `metadataJson` 中。

常见诊断：

- `抓取 0 / 新增 0`：搜索没有命中候选，或者搜索页面解析失败。
- `抓取 N / 新增 0 / 重复 N`：能搜到内容，但本轮结果已入库。
- `抓取 N / 新增 0 / 重复 0`：候选被相关性过滤或落地页处理逻辑拦下，需要看采集代码和日志。
- 落地页 `403 Forbidden`：站点禁止抓正文。当前会降级保存搜索标题/摘要，可信度为 `SEARCH_SNIPPET`。

## 关键词搜索机制

关键词采集入口：

```text
src/lib/watch-keywords/search-queries.ts
src/lib/collectors/run-collectors.ts
```

当前规则：

- 只对 `enabled=true` 的关注关键词执行搜索。
- 每个关键词会生成多条查询语句。
- 对已知中文关键词会做语义扩展。例如 `AI编程` 会扩展为：
  - `AI programming`
  - `AI coding`
  - `AI developer tools`
  - `AI code assistant`
  - `coding agent`
  - `programming agent`
  - `AI IDE`
- 相关性过滤不再只要求搜索结果包含原始中文关键词，也会接受扩展词命中。
- 抓取落地页失败时，会保存搜索摘要作为线索，而不是直接丢弃。

当前限制：

- Google/Bing 仍使用网页抓取，不如正式 Search API 稳定。
- 中文关键词需要维护扩展词，否则容易漏掉英文结果。
- 搜索摘要线索只能作为低可信线索，需要 AI 或用户继续核验。

## 前端交互约定

时间刷新条：

- 放在主题筛选白色容器内部右侧。
- 仅保留 `1天 / 7天`。
- 使用浅色主题。
- 文案格式：`更新于 刚刚 · 将于 60 分钟后刷新`。

AI 分析：

- 不提供单独点击按钮。
- 状态通过顶部状态栏展示。
- 采集后自动分析，前提是 `OPENROUTER_API_KEY` 已配置。

卡片详情：

- 卡片用稳定的 `id` 选中，不用标题匹配。
- 点击卡片后，右侧 `当前焦点` 展示该卡片标题、摘要、价值说明、分类、可信度、日期和来源链接。

关注关键词：

- 开关点击后立即更新本地视觉状态。
- PATCH 保存失败时回滚，并在状态栏显示错误。

## 当前限制

- 页面内 1 小时自动刷新依赖浏览器页面打开；还没有独立后端 scheduler。
- 邮件推送尚未实现。
- 搜索结果质量依赖网页搜索页面结构，建议后续接入正式搜索 API、SerpAPI 或 Firecrawl。
- 本地数据库里仍有早期测试数据和部分噪声结果，后续可清洗或重建。
- AI 热点聚类仍是初版，尚未做同事件持续合并。

## 下一步建议

1. 引入正式搜索服务，替代 Google/Bing 网页抓取。
2. 为关键词增加可配置同义词/扩展词表，而不是只在代码里写死。
3. 增加采集详情页，展示每次运行的 query、候选 URL、过滤原因、落地页错误和去重原因。
4. 实现后端定时任务，不依赖浏览器页面打开。
5. 增加数据清洗脚本，清理早期噪声和乱码数据。
