# 开发指南

更新时间：2026-06-04

## 目标

本项目是一个网页端 AI 热点监控工具，核心流程是：

```text
关注关键词 / 默认来源
  -> 搜索和网页抓取
  -> RawItem 入库
  -> AI 分析和聚类
  -> HotTopic 展示
```

开发时要优先保证三件事：

- 页面展示真实数据库内容，不展示伪造新闻。
- 每条内容都能追溯到原始 URL。
- `新增 0` 必须能解释原因，不能让用户误以为系统没工作。

## 目录速查

```text
src/app/page.tsx                         首页服务端首屏数据读取
src/components/radar-dashboard.tsx       首页主要交互组件
src/app/api/collect/route.ts             采集 API
src/app/api/raw-items/route.ts           原始线索 API
src/app/api/analyze/route.ts             AI 分析 API
src/app/api/watch-keywords/route.ts      关注关键词新增和列表
src/app/api/watch-keywords/[id]/route.ts 关注关键词启用/停用
src/lib/collectors/run-collectors.ts     采集总调度、关键词采集、去重统计
src/lib/collectors/search.ts             Google/Bing 搜索解析
src/lib/watch-keywords/search-queries.ts 关键词查询扩展
src/lib/ai/analyze-raw-items.ts          RawItem -> HotTopic
src/lib/ai/openrouter.ts                 OpenRouter 调用
prisma/schema.prisma                     数据模型
```

## 采集 API

手动触发：

```powershell
$body = @{
  collectors = @("search")
  keywordOnly = $true
  limit = 3
  autoAnalyze = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/collect `
  -ContentType "application/json" `
  -Body $body
```

常用参数：

- `collectors`: 可选，`official`、`search`、`twitterapi-io`。
- `keywordOnly`: 为 `true` 时只跑已启用关注关键词。
- `limit`: 每类采集的候选数量上限。
- `background`: 为 `true` 时立即返回，后台继续跑采集。
- `autoAnalyze`: 采集后自动分析，要求配置 `OPENROUTER_API_KEY`。

返回字段：

- `fetchedCount`: 搜索候选数。
- `newCount`: 新增入库数。
- `duplicateCount`: 已存在 URL 数。
- `skippedCount`: 跳过数。
- `errors`: 抓取或解析错误。

## 关键词采集规则

入口：

```text
src/lib/watch-keywords/search-queries.ts
src/lib/collectors/run-collectors.ts
```

当前实现：

- 每个启用关键词生成多条搜索 query。
- 已知关键词可做中英扩展。
- 搜索结果先经搜索适配器过滤，再经关键词相关性过滤。
- 相关性过滤接受：
  - 原始关键词完整命中；
  - 扩展词命中；
  - 当前 query 本身命中扩展词。
- 抓取落地页成功时保存正文。
- 抓取落地页失败时保存搜索标题/摘要，可信度标记为 `SEARCH_SNIPPET`。

示例：`AI编程`

```text
AI programming
AI coding
AI developer tools
AI code assistant
coding agent
programming agent
AI IDE
```

后续建议把扩展词表改成数据库或配置文件，避免每次改代码。

## 去重规则

Prisma 模型中 `RawItem` 有唯一约束：

```prisma
@@unique([sourceId, url])
```

因此同一来源同一 URL 只会入库一次。

不要只看 `newCount` 判断采集是否成功。正确判断顺序：

1. `fetchedCount` 是否大于 0。
2. `newCount` 是否大于 0。
3. `duplicateCount` 是否大于 0。
4. `errors` 是否包含 403、超时、解析失败。
5. `RawItem.watchKeywordId` 是否正确写入。

## AI 分析规则

入口：

```text
src/app/api/analyze/route.ts
src/lib/ai/analyze-raw-items.ts
```

当前规则：

- 只分析 `RawItem.status = NEW` 的线索。
- 使用 OpenRouter。
- AI 输出必须引用输入中的 `source_ids`。
- 非 AI 相关内容会被标记为 `IGNORED`。
- AI 相关内容会生成 `HotTopic`，并把对应 `RawItem` 标记为 `ANALYZED`。

前端不再提供单独的 `AI 分析` 按钮。采集后自动分析，状态在顶部状态栏展示。

## 日期筛选规则

API 支持：

```text
?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

筛选逻辑：

- 优先使用新闻发布日期 `publishedAt`。
- 没有 `publishedAt` 时使用抓取时间 `fetchedAt`。

前端当前只提供：

- `1天`
- `7天`

时间条位置：主题筛选白色容器内部右侧。

## 前端交互注意事项

开发验证时使用：

```text
http://localhost:3000
```

不要用 `127.0.0.1:3000` 做最终交互验证。Next.js dev server 会阻止跨 origin HMR 资源，可能出现“按钮点击无反应”的假象。

关键交互：

- `立即抓取`: 启动后台采集。
- 主题筛选: 修改 `activeFilter`。
- `1天 / 7天`: 修改 `datePreset`，重新请求数据。
- 关键词开关: 先本地乐观更新，再 PATCH 保存。
- 卡片点击: 使用 `topic.id` 选中，右侧详情跟随变化。

## 调试 SQL

查看关键词和入库数量：

```js
const Database = require("better-sqlite3");
const db = new Database("prisma/dev.db");

console.log(db.prepare(`
  select wk.keyword, count(ri.id) c
  from WatchKeyword wk
  left join RawItem ri on ri.watchKeywordId = wk.id
  group by wk.id
  order by c desc
`).all());
```

查看最近采集：

```js
console.log(db.prepare(`
  select status, fetchedCount, newCount, metadataJson, errorMessage, startedAt, finishedAt
  from CollectRun
  order by startedAt desc
  limit 5
`).all());
```

查看某关键词线索：

```js
console.log(db.prepare(`
  select ri.title, ri.url, ri.credibilityLevel, ri.status, ri.fetchedAt
  from RawItem ri
  join WatchKeyword wk on wk.id = ri.watchKeywordId
  where wk.keyword like '%AI%'
  order by ri.fetchedAt desc
  limit 20
`).all());
```

## 推荐后续重构

1. `CollectRun` 增加结构化字段：
   - `duplicateCount`
   - `skippedCount`
   - `snippetOnlyCount`
   - `queryCount`
2. 新增 `CollectRunDetail` 表，保存每条候选的 query、URL、处理状态和失败原因。
3. 把关键词扩展词从代码迁移到配置。
4. 使用正式搜索 API，减少网页抓取不稳定性。
5. 加后端 scheduler，避免依赖页面打开触发 1 小时采集。
