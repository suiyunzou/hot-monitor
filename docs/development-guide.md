# 开发指南

更新时间：2026-06-06

> 本指南记录的是**当前实现现状**。2026-06-06 设计共识带来的改造方向（采集编排修复、打分确定性锚点、X 发现-验证流程、搜索分词、时效分层）见 `docs/requirements-plan.md` 第 12、13 节；下文在受影响处加了「⚠️ 待改造」提示。

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
src/app/page.tsx                         首页服务端首屏数据读取（只取已分析 HotTopic）
src/components/radar-dashboard.tsx       首页主要交互组件（紧凑 topbar、卡片、关键词/KOL/邮件控件）
src/app/api/collect/route.ts             采集 API
src/app/api/raw-items/route.ts           原始线索 API（前端已不再展示，仅调试）
src/app/api/analyze/route.ts             AI 分析 API
src/app/api/email/route.ts               邮件日报 API（GET 状态/?preview=1 预览/POST 发送）
src/app/api/kol-accounts/route.ts        KOL 白名单列表/新增（首次自动种入默认账号）
src/app/api/kol-accounts/[id]/route.ts   KOL 启停/改层级/删除
src/app/api/watch-keywords/route.ts      关注关键词新增和列表
src/app/api/watch-keywords/[id]/route.ts 关注关键词启用/停用
src/lib/collectors/run-collectors.ts     采集总调度、关键词采集、去重统计、KOL 种子
src/lib/collectors/twitterapi-io.ts      X 采集 + 互动打分 + 硬过滤 + KOL from: 抓取
src/lib/collectors/search.ts             Google/Bing 搜索解析
src/lib/collectors/default-sources.ts    默认来源、twitter 查询、默认 KOL 名单
src/lib/scoring/engagement.ts            互动打分（engagementScore）+ 硬过滤 + 作者权威
src/lib/watch-keywords/search-queries.ts 关键词查询扩展
src/lib/ai/analyze-raw-items.ts          RawItem -> HotTopic（喂指标、热度融合、来源可信度）
src/lib/ai/prompts.ts                    分析提示词（喂互动指标 + 强制中文输出）
src/lib/ai/openrouter.ts                 OpenRouter 调用
src/lib/email/digest-mailer.ts           Nodemailer 发送 + 日报模板 + 去重
prisma/schema.prisma                     数据模型
scripts/reset-content.mjs                清采集/分析内容、保留配置（npm run db:reset-content）
```

## 环境变量

- 关键变量：`OPENROUTER_API_KEY`、`OPENROUTER_MODEL`(默认 `deepseek/deepseek-v4-flash`)、`TWITTERAPI_IO_KEY`、`SMTP_*`/`MAIL_*`。
- 当前以 Windows 用户级系统环境变量配置，`.env` 可为空；`process.env` 同时读两者。
- dotenv 默认不覆盖已存在的 `process.env`：同名时系统变量优先、`.env` 被忽略。
- 环境变量只对设置之后启动的进程生效；改 key 后要重开终端再 `npm run dev`。
- `COLLECT_INTERVAL_HOURS` 是死配置（代码未引用）；真实自动采集间隔硬编码 1 小时（`radar-dashboard.tsx`，仅页面打开时生效）。后端 scheduler 待做。

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
- `keywordOnly`: 为 `true` 时只跑已启用关注关键词。⚠️ 待改造（P0）：当前 `run-collectors.ts` 中 `keywordOnly=true` 会把 `selectedKinds` 清零，导致 official/search/twitterapi-io 全部不跑、X 采集器从不被自动调用；自动扫描 `triggerScan` 也只发 `collectors:["search"]`。需改为「关键词搜索 + 选定采集器并行」并带上 `twitterapi-io`。
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

## X 互动打分与硬过滤

入口：

```text
src/lib/scoring/engagement.ts
src/lib/collectors/twitterapi-io.ts
```

规则：

- `computeEngagementScore`：对 浏览/赞/转/评 做 log 缩放综合 + 作者权威加成（官方 +15 / KOL +10 / 蓝V +5），得 0-100 `engagementScore`，落库到 `RawItem`。
- `isTweetWorthKeeping` 硬过滤：非白名单作者且 `浏览<1000 或 赞<30` 直接丢（`赞≥100` 豁免）；官方/KOL/认证作者一律保留。
- 每个查询按 `engagementScore` 排序取头部，不再“前 N 条”。
- `engagementScore` 同时参与 AI 输入与热度融合（见 AI 分析规则）。

## KOL 白名单

入口：

```text
src/app/api/kol-accounts/route.ts (+ [id])
src/lib/collectors/default-sources.ts (defaultKolAccounts)
src/lib/collectors/run-collectors.ts (ensureDefaultKolAccounts 首次种子)
```

规则：

- `KolAccount`：`handle`(唯一) / `displayName` / `tier`(1 官方, 2 大V) / `enabled`。
- 启用账号用于：twitter 采集追加 `(from:a OR from:b …)` 主动抓取；命中作者时给权威加成与硬过滤豁免。
- 表为空时自动种入 13 个默认账号；之后由前端左栏“关注账号·X KOL”增删/启停/改层级管理。

## 邮件日报

入口：

```text
src/lib/email/digest-mailer.ts
src/app/api/email/route.ts
```

规则：

- SMTP 配置缺失时降级为“未配置”，不报错。587 走 STARTTLS、465 走 SSL。
- 选取“未进过 SUCCESS 推送”的热点；发送前置 `SENDING`，成功/失败更新为 `SUCCESS`/`FAILED`。
- 去重：进过一封 `SUCCESS` `EmailDigest` 的热点不再重复发送。
- `GET /api/email?preview=1` 不发信直接渲染日报 HTML，便于调模板。

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
- 输入会带上 X 互动指标（浏览/赞/转/评 + `engagementScore`），提示词约束：hot_score 反映触达与互动、confidence 反映来源权威与佐证。
- 强制 `topic/summary/why_it_matters` 输出简体中文（非中文则翻译）。
- 入库前做确定性融合（`src/lib/ai/analyze-raw-items.ts`）：
  - 热度 `hotScore = 0.6*AI hot_score + 0.4*max(engagementScore)`（无社交互动时退化为纯 AI 分）。
  - 可信度 `confidence = 0.7*来源可信度 + 0.3*AI confidence`；来源可信度=最高来源层级基分 + 独立来源数佐证加成。

> ⚠️ 待改造（P1，见 requirements-plan §12.2/12.3）：热度对「搜索/官方」来源目前退化为纯 AI 主观分，缺确定性锚点；且当前只做评分、不做 X 声明抽取与分档验证（来源可靠 ≠ 信息为真）。规划：为非社交来源加「来源档位+新鲜度+多源佐证」基线分；新增 X 发现-验证流程与状态升级。

前端不再提供单独的 `AI 分析` 按钮。采集后自动分析，状态在顶部状态栏展示。**卡片只展示已分析+已中文化的 HotTopic**；未分析的原始线索不再作为卡片，显示为“分析中 N 条”。

## 日期筛选规则

API 支持：

```text
?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

筛选逻辑：

- 优先使用新闻发布日期 `publishedAt`。
- 没有 `publishedAt` 时使用抓取时间 `fetchedAt`。

> ⚠️ 待改造（P2，见 requirements-plan §12.5）：缺 `publishedAt` 时回退 `fetchedAt` 会把旧页伪装成新闻。规划改为按来源类型指数衰减（社交快、官方/研究慢）、缺真实发布时间不计入热度，X 默认只抓最近 2 小时。

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
