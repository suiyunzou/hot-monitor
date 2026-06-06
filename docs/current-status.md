# 当前项目状态

更新时间：2026-06-06

> 2026-06-06：本次设计讨论确定了新方向（社交/官方主导热度、搜索降级为验证层、X 发现-验证分档、打分加确定性锚点、搜索分词、时效分层），并定位了 P0 阻断问题。完整需求与 P0–P3 计划见 `docs/requirements-plan.md` 第 12、13 节。下文「已知问题/根因」「下一步建议」已与之对齐。

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
npm run db:apply          # 应用增量迁移
npm run db:reset-content  # 清采集/分析内容，保留 Source/WatchKeyword/KolAccount
```

注意：开发时优先使用 `http://localhost:3000`。如果使用 `127.0.0.1:3000`，Next.js dev server 会阻止跨 origin 的 HMR 资源，客户端水合失败 → 出现“按钮点击无反应”假象。已在 `next.config.ts` 加 `allowedDevOrigins` 缓解，但仍建议用 localhost。

## 环境变量

当前以 **Windows 用户级系统环境变量** 配置，`.env` 文件可为空：

- `OPENROUTER_API_KEY`：分析 + 翻译必需（`src/lib/ai/openrouter.ts`）。
- `OPENROUTER_MODEL`：可选，默认 `deepseek/deepseek-v4-flash`；若报模型不存在，设为 OpenRouter 上真实存在的 ID（如 `deepseek/deepseek-chat`）。
- `TWITTERAPI_IO_KEY`：twitterapi.io 的 API 密钥，抓 X 与互动数据必需（`src/lib/collectors/twitterapi-io.ts`）。
- `SMTP_HOST/PORT/USER/PASS`、`MAIL_FROM/MAIL_TO`：邮件日报必需。

要点：

- `process.env` 同时含「系统环境变量」与「`.env`」，进程继承 OS 变量，所以不写进 `.env` 也能用。
- 环境变量只对“设置之后启动”的进程生效；改了 key 要重开终端再 `npm run dev`。
- dotenv 默认**不覆盖**已存在的 `process.env`：同名时系统变量优先、`.env` 被忽略。要以 `.env` 为准须删系统变量或开启 override。
- `COLLECT_INTERVAL_HOURS` 是**死配置**（代码未引用），改它无效；真实自动采集间隔硬编码 **1 小时**（`src/components/radar-dashboard.tsx`，仅页面打开时生效）。

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

## 信息检索 / 处理 / 展示（2026-06-05 重构）

针对“可信度怎么算、什么 X 贴值得看、卡片要中文”三个问题：

- 互动打分：`src/lib/scoring/engagement.ts`，对 X 贴用 log 缩放综合浏览量/点赞/转发/回复 + 作者权威加成，得 0-100 `engagementScore`，落库到 `RawItem`。
- 硬过滤：非白名单作者且 `浏览<1000 或 点赞<30`（点赞≥100 豁免）的贴直接丢弃，解决“5 浏览量废帖”；白名单/认证作者豁免。每个 query 按分数取头部而非前 N 条。
- 可信度与热度拆分：可信度=来源层级(官方>一手>媒体>认证社交>社交>搜索摘要)+独立来源数；热度=`0.6*AI + 0.4*engagementScore`。卡片分别展示“热度”和“可信度”，X 贴加 👁/♥/💬 互动 chip。
- 中文化：AI 分析时把互动指标一并喂给模型，并强制 `topic/summary/why` 输出简体中文（非中文则翻译）。**卡片只展示已分析+已中文化的热点**；未分析的原始线索显示为“分析中 N 条”，不再英文直出。
- KOL 白名单：`KolAccount` 表 + `/api/kol-accounts` + 左栏“关注账号·X KOL”控件（增/删/启停/层级），用于 `from:` 主动抓取与权威加成；首次为空时自动种入 13 个默认账号。

> ⚠️ 前提：以上分析与翻译依赖 `OPENROUTER_API_KEY`。未配置时不分析、不翻译，卡片会停在旧数据/英文。现存的旧 HotTopic 是改造前生成的，需重新采集分析才会变中文并带新评分。

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

## 已知问题与根因（2026-06-06）

按优先级排列，详见 `docs/requirements-plan.md` 第 13 节。

P0（阻断级，须先修）：

- **两个 key 空导致空跑**：项目原先无 `.env`，`TWITTERAPI_IO_KEY` / `OPENROUTER_API_KEY` 为空时 X 采集与 AI 分析直接空转。用户已在本地系统环境变量配置，正在另行验证生效中。
- **采集编排 bug：X 采集器从未被自动调用**。根因有两处：
  - `src/components/radar-dashboard.tsx` 的 `triggerScan` 只发 `collectors:["search"]`，自动扫描不带 `twitterapi-io` / `official`。
  - `src/lib/collectors/run-collectors.ts` 中 `selectedKinds = options.keywordOnly ? [] : ...`，当 `keywordOnly=true`（有启用关键词时）会把 `selectedKinds` 清零，导致连 search/official/twitterapi-io 都不跑。
  - 修复方向：改为「关注关键词搜索 + 选定采集器并行」，并让自动扫描真正带上 `twitterapi-io`。

P1（核心改造）：

- **热度纯 AI 主观分**：`fuseHotScore`（`src/lib/ai/analyze-raw-items.ts`）仅在存在 `TWITTER`+`engagementScore` 时用 `0.6·AI+0.4·参与度`，否则退化为纯 AI 分；登陆页/维基/纯摘要也能拿高分，`hotScore` 在 5/95 间跳变。需为非社交来源加确定性锚点（来源档位+新鲜度+多源佐证）。
- **来源可靠 ≠ 信息为真**：当前对 X 推文只做识别/摘要/评分，没有声明抽取、推文类型分档、定向验证、状态升级。需新增 X 发现-验证流程。
- **搜索只能完全匹配**：`buildTopicSearchWhere`（`src/app/api/analyze/route.ts`）用 `contains` 整串精确子串、中文不分词。需切词+同义/中英映射。

P2（调优）：

- **时效一刀切 + 旧页伪装新闻**：日期筛选只有 `1天/7天` 硬窗口；缺 `publishedAt` 时回退 `fetchedAt` 会把旧页当新新闻。需按来源类型指数衰减、缺真实发布时间不计入热度、X 默认只抓最近 2 小时。
- **推文过滤阈值**：`isTweetWorthKeeping` 阈值需在 key 配齐、X 采集跑通后按真实数据调优。

## 当前限制

- 页面内 1 小时自动刷新依赖浏览器页面打开；还没有独立后端 scheduler。
- 邮件推送（阶段 5）网页端已实现：`src/lib/email/digest-mailer.ts` + `/api/email` + 左栏“邮件日报”控件，支持手动发送、去重、推送记录、`?preview=1` 预览。需用户在 `.env` 填 `SMTP_*`、`MAIL_FROM/MAIL_TO` 后做真实投递验收；自动定时发送仍待后端 scheduler。
- 搜索结果质量依赖网页搜索页面结构，建议后续接入正式搜索 API、SerpAPI 或 Firecrawl。
- 本地数据库里仍有早期测试数据和部分噪声结果，后续可清洗或重建。
- AI 热点聚类仍是初版，尚未做同事件持续合并。

## 下一步建议（按优先级，对齐 P0–P3）

P0（先修阻断）：

1. 配置 `.env` 的 `TWITTERAPI_IO_KEY` / `OPENROUTER_API_KEY` 并验证生效（X 采集、AI 分析跑通）。
2. 修复采集编排：`run-collectors.ts` 的 `keywordOnly` 清零 bug + `triggerScan` 自动扫描带上 `twitterapi-io`，实现「关键词搜索 + 选定采集器并行」。

P1（核心改造，搜索分词可并行）：

3. X 帖子声明抽取与分档验证流程（官方自宣只富化 / 爆料重验证 / 观点不证真；定向中英双语限时查询 → 状态升级或标 `NEEDS_VERIFICATION`）。
4. 打分加确定性锚点：非社交来源引入「来源档位 + 新鲜度 + 多源佐证」基线，与 AI 分加权；snippet-only / 抓取失败强制降权。
5. 搜索分词 + 同义/中英映射（切词 + 中文 bi-gram 兜底 + 多 `OR contains`，复用 `expandKnownKeyword`）。

P2（调优）：

6. 分来源新鲜度指数衰减；缺真实 `publishedAt` 不计入热度；X 默认只抓最近 2 小时。
7. 调优 `isTweetWorthKeeping` 过滤阈值。

P3（检索升级）：

8. SQLite FTS5（BM25）全文检索。
9. embedding 语义检索 + LLM 重排。

长期工程项（与上面并行推进）：

10. 引入正式搜索服务，替代 Google/Bing 网页抓取。
11. 把关键词同义词/扩展词表从代码迁到配置/数据库。
12. 增加采集详情页，展示每次运行的 query、候选 URL、过滤原因、落地页错误和去重原因。
13. 实现后端定时任务，不依赖浏览器页面打开。
14. 增加数据清洗脚本，清理早期噪声和乱码数据。
