# AI 热点监控网站需求与开发方案

更新时间：2026-06-06

> 2026-06-06 设计共识：本次讨论确定了「以社交/官方为热度主导、搜索降级为验证富化层」的新方向，并对打分机制、X 发现-验证流程、搜索相关性、时效分层做了重大需求修订。新方向集中写在第 12 节，分阶段开发计划（P0–P3）写在第 13 节。第 1–11 节为原始需求，凡与新方向冲突处已加注「以第 12 节为准」。

## 0. 当前开发进度快照

更新时间：2026-06-06

- 本地开发地址：`http://localhost:3000`（务必用 localhost，不要用 127.0.0.1，否则 HMR 被拦会出现“按钮点击无反应”假象）
- 数据库：SQLite，文件路径 `prisma/dev.db`（Navicat 用 SQLite 连接直接选该文件）
- 最新提交：`7c59901 信息检索/处理/展示重构 + 邮件日报(阶段5)`

已完成（截至 2026-06-05）：

- Next.js + TypeScript + Prisma + SQLite 数据模型与迁移。
- 采集闭环：官网抓取、twitterapi.io、Google/Bing 搜索适配器、通用正文提取、采集日志与运行状态轮询。
- 关注关键词：`/api/watch-keywords`(+`[id]`)，新增/回显/启用停用，中文关键词语义扩展。
- OpenRouter 分析：识别/聚类/摘要/评分 + AI 审计记录；采集后自动分析（无需手动按钮）。
- 顶部改为紧凑 topbar：动态雷达缩为图标 + 3 个动态状态药丸，去掉旧的大 hero 和 5 格状态栏。
- 修复“按钮点击无反应”：根因是经 127.0.0.1 访问时 HMR 跨域被拦导致水合失败；已加 `allowedDevOrigins` + 时间文案 `mounted` 门控。
- 阶段 5 邮件日报：`lib/email/digest-mailer.ts` + `/api/email`（状态/预览/发送）+ 去重 + 推送记录 + 左栏控件。
- 信息检索/处理/展示重构（回应可信度、X 贴价值、卡片中文三问题）：
  - 互动打分 `lib/scoring/engagement.ts`（log 缩放 浏览/赞/转/评 + 作者权威加成 → `engagementScore`）。
  - X 贴硬过滤（浏览<1000 或 赞<30 且非白名单作者直接丢；按分数取头部）。
  - 可信度与热度拆分：可信度=来源层级+独立来源数；热度=`0.6*AI + 0.4*engagementScore`。
  - 卡片仅展示已分析+已中文化热点；AI 强制中文输出；未分析项显示“分析中”；X 贴展示 👁/♥/💬。
  - KOL 白名单 `KolAccount` + `/api/kol-accounts` + 左栏增删/启停/分层，用于 `from:` 抓取与权威加成（首次种入 13 个默认账号）。
- 数据清理脚本 `scripts/reset-content.mjs`（`npm run db:reset-content`）：清采集/分析内容、保留配置。

环境变量说明：

- `OPENROUTER_API_KEY`、`TWITTERAPI_IO_KEY` 等当前以 Windows 用户级系统环境变量配置，`process.env` 直接读取，`.env` 文件可为空。
- 注意 dotenv 默认不覆盖已存在的 `process.env`：同名时系统环境变量优先，`.env` 被忽略。要以 `.env` 为准需删掉系统变量或开启 override。

当前未完成或待优化：

- **P0 阻断（2026-06-06 新增，详见第 13 节）**：
  - 配置：项目原先无 `.env`，`TWITTERAPI_IO_KEY` / `OPENROUTER_API_KEY` 为空导致 X 采集与 AI 分析空跑。用户已在本地环境变量配置，正在另行验证生效中。
  - 采集编排 bug：自动扫描 `triggerScan` 只发 `collectors:["search"]`；且 `run-collectors.ts` 中 `keywordOnly=true` 会令 `selectedKinds=[]`，导致连 search/official/twitterapi-io 都不跑、X 采集器从未被自动调用。
- 没有后端定时调度器；自动采集靠前端页面内 1 小时定时器，仅页面打开时生效。
- `COLLECT_INTERVAL_HOURS` 是死配置（代码未引用）；真实间隔硬编码 1 小时（`radar-dashboard.tsx`）。
- 邮件自动发送依赖调度器，目前仅手动触发；真实投递待用户配置 SMTP 验收。
- Google/Bing 仍是网页抓取，质量/稳定性不如正式搜索 API。
- 热点聚类仍是初版，尚未做同事件持续合并。
- 旧英文/无指标的 HotTopic 已用 reset 脚本清空；需配 key 后重新采集生成中文+评分卡片。

## 1. 项目目标

开发一个网页端 AI 热点监控网站，帮助程序员每天自动获取、筛选、归纳最新 AI 新闻，减少手动查看官网、X、搜索引擎结果的重复工作。

项目必须先完成网页版。网页版功能稳定并通过人工验收后，再沉淀为 Agent Skill。

核心原则：

- 新闻事实必须来自真实来源，不允许 AI 凭空生成。
- AI 只做识别、聚类、摘要、评分和分类。
- 信息源必须多元化，避免单一渠道造成偏差。
- 每条热点必须保留原始来源链接、发布时间、抓取时间和来源类型。
- 单一来源内容可以展示，但必须标记为“单源线索”。

## 2. 明确排除的信息源

以下来源在当前阶段不做：

- YouTube：以视频为主，用户仍需观看视频，不能有效节省时间。
- 哔哩哔哩：同样以视频为主，当前阶段不接入。
- RSS：当前阶段不作为采集方式。
- 官方 X API：不使用，X 数据使用 twitterapi.io。

## 3. 当前阶段信息源

当前阶段只使用三类来源：

- 官方网站与官方新闻
- X / Twitter，通过 twitterapi.io 搜索
- Google / Bing 搜索结果与落地页抓取

### 3.0 用户自定义关注关键词

系统必须支持用户自定义关注关键词。

目标：

- 用户可以输入自己想关注的关键词，例如 `Claude Code`、`AI Agent`、`MCP`、`DeepSeek`、`OpenAI Agents SDK`。
- 每个关键词都有启用/停用状态。
- 启用后，后台采集任务会围绕该关键词搜索最新 AI 资讯。
- 停用后，该关键词不再参与雷达扫描和邮件推送。
- 系统默认关键词仍然存在，用于覆盖通用 AI 热点；用户关键词用于补充个性化关注。

关键词采集规则：

- 只对启用关键词执行搜索。
- 搜索时必须组合 AI 语义约束，避免普通同名词污染结果。
- 搜索结果仍需抓取落地页正文，不能只依赖搜索摘要。
- 关键词采集出来的内容需要保存关键词 ID，后续页面和邮件中可以标记“来自哪个关注词”。

建议搜索模板：

```text
{keyword} AI news official announcement
{keyword} artificial intelligence update
{keyword} LLM model release
site:openai.com/news {keyword}
site:anthropic.com/news {keyword}
```

界面要求：

- 页面提供关键词输入框。
- 用户输入关键词后生成一个可开关的关注项。
- 每个关注项可以启用或停用。
- 雷达扫描和后台任务只使用启用项。

### 3.1 官方网站与官方新闻

这是最高可信度来源。

默认优先监控列表：

- OpenAI / ChatGPT 官方新闻、博客、产品更新
- Anthropic / Claude 官方新闻、博客、产品更新
- Google DeepMind / Google AI 官方新闻
- Meta AI 官方新闻
- xAI 官方新闻
- NVIDIA AI 官方新闻
- Microsoft AI / Azure AI 官方新闻
- Hugging Face 官方博客
- Mistral AI 官方新闻
- GitHub Blog / GitHub Changelog 中的 AI 相关更新

说明：

- 这份列表是项目第一版内置的官网来源配置。
- 后续会做成可配置项，可以增删官网。
- 如果用户没有指定更精确的官网列表，开发阶段默认采用上述列表。

实现方式：

- 使用后端网页抓取。
- 按来源配置抓取入口 URL。
- 对页面标题、正文、发布时间、canonical URL 做结构化提取。
- 对不同官网建立独立解析器，解析失败时降级为通用正文提取。
- 控制抓取频率，避免对目标站点造成压力。

### 3.2 X / Twitter

使用 twitterapi.io，不使用官方 X API。

用途：

- 发现早期热点。
- 捕捉模型发布、产品更新、研究者讨论、开源项目传播。
- 作为热度信号，不作为唯一事实来源。

实现约束：

- 使用 `X-API-Key` 鉴权。
- 优先使用 `GET /twitter/tweet/advanced_search`。
- 查询按关键词、重点账号、时间窗口拆分。
- 根据 twitterapi.io 文档提示，避免依赖分页；使用 `since_time` 和 `until_time` 控制每次请求规模。
- 每条推文保存原文链接、作者、发布时间、互动指标、查询来源。

### 3.3 Google / Bing 搜索

> 定位修正（2026-06-06，以第 12.1 节为准）：搜索引擎**降级为「验证与富化层」，不再作为热度来源**。它的职责是交叉验证社交/官方发现的事件、锚定原始权威 URL、补全细节，而不是贡献「热度」。

用途：

- 发现官网以外的公开网页新闻。
- 补充验证同一事件是否被多个独立来源报道。
- 找到原始公告、论文、GitHub 仓库、公司博客等更可靠来源。

实现方式：

- 第一版使用网页抓取方式获取 Google/Bing 搜索结果。
- 同时保留可替换搜索适配器接口，后续可以替换为正式搜索 API。
- 搜索关键词由系统配置，例如：
  - `AI model release`
  - `OpenAI new model`
  - `Claude update`
  - `AI agent framework`
  - `LLM benchmark`
  - `AI open source release`
  - `site:openai.com AI`
  - `site:anthropic.com Claude`
- 搜索结果只作为入口，最终仍要抓取落地页正文并保存原始 URL。

## 4. OpenRouter 使用边界

OpenRouter 是统一模型 API 网关，用于接入不同厂商模型，不是信息源。

项目通过 OpenRouter 调用模型完成：

- AI 相关新闻判定
- 标题与正文摘要
- 事件聚类
- 热点评分
- 可信度评分
- 影响范围判断
- 分类标签生成
- 邮件日报内容整理

禁止：

- 禁止让 AI 直接编造新闻。
- 禁止没有来源 URL 的摘要进入正式热点。
- 禁止把 X 上的单条推文直接当作已确认事实。

推荐模型输出结构：

```json
{
  "is_ai_related": true,
  "topic": "string",
  "category": "model_release | product_update | research | open_source | business | policy | security | other",
  "summary": "string",
  "why_it_matters": "string",
  "hot_score": 0,
  "confidence": 0,
  "source_ids": ["string"],
  "needs_verification": false
}
```

## 5. 可靠性与反幻觉机制

> 重要补充（2026-06-06，以第 12.2、12.3 节为准）：本节的「来源分级」描述的是**来源可靠性（谁说的）**，它**不等于信息为真（说的对不对）**。新方向要求把「来源可靠」与「信息已验证」拆成两个维度，并为非社交来源也引入确定性基线分。详见第 12 节。

### 5.1 来源分级

可信度从高到低：

1. 官方公告、官方博客、官方文档、官方 changelog
2. GitHub release、论文页面、产品发布页
3. 主流媒体或技术媒体网页
4. X 上官方账号或核心研究者账号
5. X 普通用户讨论
6. 搜索结果摘要

### 5.2 热点确认规则

- 有官方来源：可进入“已确认热点”。
- 无官方来源，但有多个独立网页来源：可进入“多源线索”。
- 只有 X 来源：只能进入“社交热议”，标记待核验。
- 只有搜索结果标题，没有落地页正文：不进入正式热点。

### 5.3 AI 输出约束

- AI 输入必须包含来源 ID、标题、正文片段、URL、发布时间。
- AI 输出必须引用 `source_ids`。
- 如果证据不足，模型必须返回 `needs_verification: true`。
- 后端保存 AI 原始输入与输出，便于审计。

## 6. 技术选型

### 6.1 Web 框架

使用 Next.js + TypeScript。

原因：

- 适合网页端和后端 API 一体化开发。
- App Router 支持服务端组件和 Route Handlers。
- 后续部署和扩展成本较低。

开发约束：

- 使用最新官方文档和 Context7 MCP 文档查询结果。
- 不照搬旧版 Pages Router 写法。
- API 使用 App Router 的 Route Handlers。
- 页面数据获取优先使用服务端组件或服务端 API。

Context7 文档源：

- Next.js：`/vercel/next.js`

### 6.2 数据库

第一版使用 SQLite + Prisma。

原因：

- 本地开发简单。
- 适合 MVP 和单用户部署。
- 后续可以迁移到 PostgreSQL。

开发约束：

- 使用 Prisma 最新文档。
- 使用迁移管理 schema。
- 保留采集日志、AI 输入输出、邮件推送记录。

Context7 文档源：

- Prisma：`/prisma/web`

### 6.3 邮件

使用 Nodemailer + SMTP。

原因：

- 通用 SMTP 兼容性好。
- 可对接 Gmail、企业邮箱、QQ 邮箱、163 邮箱等。

Context7 文档源：

- Nodemailer：`/nodemailer/nodemailer-homepage`

### 6.4 AI 接入

使用 OpenRouter。

默认模型：

- `deepseek/deepseek-v4-flash`

选择原因：

- OpenRouter 当前模型页显示 DeepSeek V4 Flash 是面向快速推理和高吞吐任务的效率优化模型。
- 适合本项目的高频摘要、分类、聚类、热点评分任务。
- 仍通过环境变量允许用户替换为其他 OpenRouter 模型。

环境变量：

```env
OPENROUTER_API_KEY=
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
```

### 6.5 X 接入

使用 twitterapi.io。

环境变量：

```env
TWITTERAPI_IO_KEY=
```

### 6.6 搜索接入

第一版使用搜索适配器模式：

```ts
interface SearchProvider {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}
```

后续可接入：

- Google 搜索抓取
- Bing 搜索抓取
- Bing Search API
- SerpAPI
- Firecrawl
- 其他搜索服务

## 7. 后端模块设计

```text
src/
  app/
    page.tsx
    api/
      collect/route.ts
      analyze/route.ts
      digest/route.ts
      email/route.ts
  lib/
    collectors/
      official.ts
      twitterapi-io.ts
      search.ts
    extractors/
      article-extractor.ts
      official-sites.ts
    ai/
      openrouter.ts
      prompts.ts
      schemas.ts
    db/
      prisma.ts
    email/
      digest-mailer.ts
    scheduler/
      jobs.ts
```

## 8. 核心数据模型

建议实体：

- `Source`：来源配置。
- `WatchKeyword`：用户自定义关注关键词。
- `RawItem`：原始采集内容。
- `Article`：清洗后的网页文章。
- `Tweet`：X 推文内容。
- `HotTopic`：聚类后的热点。
- `TopicSource`：热点与来源关联。
- `AiAnalysis`：AI 输入输出记录。
- `CollectRun`：采集任务日志。
- `EmailDigest`：邮件推送记录。

关键字段：

- `url`
- `title`
- `content`
- `publishedAt`
- `fetchedAt`
- `sourceType`
- `sourceName`
- `credibilityLevel`
- `hotScore`
- `confidence`
- `needsVerification`
- `watchKeywordId`

## 9. 网页端设计方向

页面不是传统新闻列表，而是“AI 情报雷达”。

核心视图：

- 今日热点雷达
- 已确认热点
- 多源线索
- 社交热议
- 待核验
- 来源覆盖情况
- 最近采集任务

每条热点展示：

- 标题
- 中文摘要
- 为什么重要
- 热点分数
- 可信度
- 来源数量
- 来源类型
- 原始链接
- 是否已推送邮件

设计要求：

- 页面要独具一格，避免普通后台模板。
- 信息密度高，但不能杂乱。
- 适合程序员快速扫读。
- 必须有加载、空状态、错误状态。

## 10. 开发阶段

### 阶段 1：需求文档与人工确认

状态：已完成。

产出：

- 本文档。
- 经用户确认的信息源范围。
- 经用户确认的技术栈和分阶段计划。

验收：

- 用户确认可以进入编码阶段。

### 阶段 2：项目初始化与基础页面

状态：已完成。

内容：

- 初始化 Next.js + TypeScript。
- 配置 Prisma + SQLite。
- 建立基础数据模型。
- 完成网页端静态骨架。

验收：

- 本地网页可打开。
- 页面能展示真实数据库线索；数据库为空时才回退展示模拟热点数据。

### 阶段 3：采集器实现

状态：采集闭环已完成；X 互动打分/硬过滤/KOL 白名单已加入。仍需优化搜索质量、错误日志和重试体验。

内容：

- 官方网站采集器。
- twitterapi.io 采集器（已加入互动打分 `engagementScore`、硬过滤废帖、按分数取头部、KOL `from:` 主动抓取）。
- Google/Bing 搜索适配器。
- 用户自定义关键词管理。
- KOL 白名单管理（`KolAccount` + `/api/kol-accounts` + 左栏 UI，官方/大V 分层，参与抓取与权威加成）。
- 启用关键词参与搜索采集。
- 通用网页正文提取。
- 采集日志。
- 采集运行状态轮询。

验收：

- 手动触发采集后，数据库有真实数据。
- 页面能展示真实来源链接。
- 关注关键词可新增、回显、启用和停用。
- 手动同步采集已改为后台启动模式，避免前端等待搜索抓取超时。
- 手动同步采集已在浏览器中验证：点击后状态进入运行中，完成后显示新增数量。

### 阶段 4：OpenRouter 热点分析

状态：已完成可用闭环；已加入互动指标喂模型、强制中文输出、热度融合与来源可信度。仍需优化同事件聚类、去重和长期合并策略。

内容：

- 接入 OpenRouter。
- 实现 AI 相关新闻识别。
- 实现聚类、评分、摘要。
- 保存 AI 输入输出审计记录。
- 采集后自动分析（已取消单独的“AI 分析”按钮）。
- `/api/analyze` 返回模型名、OpenRouter 配置状态、待分析数量和热点列表。
- 把 X 互动指标（浏览/赞/转/评 + `engagementScore`）喂给模型，提示词约束 hot_score 反映触达与互动、confidence 反映来源权威与佐证。
- 强制 `topic/summary/why` 输出简体中文（非中文则翻译）。
- 入库时做确定性融合：热度 `0.6*AI + 0.4*engagementScore`；可信度由来源层级 + 独立来源数计算后与 AI confidence 融合。

验收：

- 页面能看到 AI 生成的热点摘要。
- 每个摘要能追溯来源。
- 已在浏览器验证：点击“AI 分析”后状态进入“分析中”，完成后待分析数量从 28 条降到 22 条。
- 已验证数据库：`RawItem` 中 `ANALYZED` 为 4、`IGNORED` 为 4、`HotTopic` 总数为 4、`AiAnalysis` 总数为 12。

### 阶段 5：邮件推送

状态：网页端能力已完成，等待用户填写真实 SMTP 凭据做投递验收；后端定时调度仍未做。

已完成：

- SMTP 配置读取（`SMTP_HOST/PORT/USER/PASS`、`MAIL_FROM/MAIL_TO`），缺值时降级为“未配置 SMTP”，不报错。
- Nodemailer 发送实现：`src/lib/email/digest-mailer.ts`（587 走 STARTTLS、465 走 SSL）。
- HTML + 纯文本日报模板，沿用站点暖色圆角风格，每条热点含标题、状态、热度、摘要、为什么重要、来源链接、日期。
- 推送去重：热点只要进过一封 `SUCCESS` 的 `EmailDigest` 就不再重复发送；失败的推送保留可重试。
- 推送记录：`EmailDigest` + `EmailDigestItem` 落库，发送前置 `SENDING`，成功/失败更新为 `SUCCESS`/`FAILED`。
- `/api/email`：`GET` 返回配置状态、待发送数量、最近推送记录；`GET ?preview=1` 直接渲染日报 HTML 便于不发信预览；`POST` 手动触发发送。
- 前端左栏新增“邮件日报”控件：显示配置状态、收件人、待发送数量、上次发送结果，并提供“发送热点日报”按钮（未配置时禁用）。

待完成：

- 后端定时任务（每 2 小时抓取后自动发送），目前只有手动触发，仍依赖页面内定时。
- 真实 SMTP 投递验收：需用户在 `.env` 填入凭据后实际收信确认。

验收：

- 用户能收到 AI 热点邮件。（待用户配置 SMTP 后确认）
- 系统不会重复推送已发送过的热点。（已用数据库校验：进入 SUCCESS 推送后该热点从待发送列表移除）

### 阶段 6：测试与页面验收

状态：进行中。

内容：

- 单元测试。
- 集成测试。
- 浏览器实际检查。
- 抓取失败、AI 失败、邮件失败的错误状态。
- 已通过 `npm run typecheck` 和 `npm run build`。
- 已完成一轮真实浏览器交互验收：同步采集按钮、采集状态栏、关键词开关均可工作。
- 仍需要继续验收搜索结果质量、长期运行稳定性、失败状态和重试流程。

验收：

- 用户确认网页版功能正常。

### 阶段 7：Agent Skill

状态：未开始。

前提：

- 网页版已完成并验收。

内容：

- 将核心能力沉淀为 Agent Skill。
- 编写 `SKILL.md`。
- 支持命令式生成日报、查看热点、发送邮件。

验收：

- 用户能通过 Agent Skill 调用热点监控能力。

## 11. 待用户确认问题

进入编码前需要确认：

1. 当前阶段已确认只做：官方网站、X/twitterapi.io、Google/Bing 搜索。
2. Google/Bing 搜索已确认第一版使用网页抓取方式，并预留正式 API 替换。
3. 官网默认监控列表待用户确认；如果用户没有指定，默认采用本文档第 3.1 节列表。
4. OpenRouter 默认模型已确认使用 DeepSeek 快速版，当前默认值为 `deepseek/deepseek-v4-flash`，并允许环境变量覆盖。
5. 邮件推送已确认：每 2 小时抓取一次，抓取后以邮件形式转发新增热点。

## 12. 更新后需求：发现与验证分层（2026-06-06 设计共识）

本节是 2026-06-06 设计讨论达成的新方向，是对第 1–11 节的修订与扩展。凡与旧文冲突，以本节为准。下文区分【现状】（代码已有的事实）与【目标 / 拟改造】（规划，尚未实现）。

### 12.1 产品定位修正：社交/官方主导热度，搜索降级为验证层

- 核心共识：**热点的发现与「热度」以社交/论坛（X/Twitter）和官方来源为主导；搜索引擎降级为「验证与富化层」，不作为热度来源。**
- 三类来源的职责分层（与侧栏文案保持一致，要让实现真正贯彻）：
  - 社交（X）：早期趋势信号——发现热点、提供「热度」。
  - 官方：事实锚点——确认事件、提供最高可信度。
  - 搜索发现：发现与交叉验证——验证社交/官方发现的声明、锚定原始 URL、富化细节；**不贡献热度**。
- 【现状】对「搜索/官方」来源 `hotScore` 实际等于 AI 主观分（见 12.2），与该分层定位不符。
- 【目标】热度计算只承认社交互动 + 新鲜度 + 多源佐证 + 来源档位等确定性信号，搜索 snippet 仅作验证证据，不抬高热度。

### 12.2 打分机制改造：为非社交来源引入确定性锚点

要解决的问题：热度纯 AI 主观给分；登陆页/维基等也能拿高分；`hotScore` 在 5/95 之间跳变，缺乏稳定锚点。

【现状】（代码事实）：

- 热度 `fuseHotScore`（`src/lib/ai/analyze-raw-items.ts`）：仅当存在 `TWITTER` 来源且带 `engagementScore` 时，才用 `0.6·AI + 0.4·参与度`；否则**退化为纯 AI 主观分**。即「搜索/官方」来源的热度 = AI 主观分。
- 可信度 `computeCredibility`：由来源档位基线 `CREDIBILITY_BASE`（`OFFICIAL 92 / PRIMARY 84 / MEDIA 70 / SOCIAL_VERIFIED 58 / SOCIAL 45 / SEARCH_SNIPPET 35`）+ 多源独立佐证加成算出，相对客观。
- 社交互动 `computeEngagementScore`（`src/lib/scoring/engagement.ts`）：log 压缩浏览/赞/转/评 + 作者权威加成，得 0–100。

【目标 / 拟改造】：

- 为**非社交来源也引入确定性基线分**：由「来源档位 + 新鲜度（见 12.5）+ 多源佐证」构成，与 AI 分加权融合（建议 `0.5·确定性基线 + 0.5·AI`，权重可调）。
- 社交来源继续用 `engagementScore`：log 压缩（浏览 0.35 / 赞 0.30 / 互动 0.20 / 互动率 0.15）+ 权威加成（官方 +15 / KOL +10 / 认证 +5）。（注：当前权重比例为本次规划目标，落地时以代码实现为准。）
- 对**抓取失败 / snippet-only 证据强制降权或标 `NEEDS_VERIFICATION`**，避免登陆页/维基/纯摘要拿到高热度。

### 12.3 X 优先的「发现 + 分档验证」流程（核心新增需求）

关键认知：**来源可靠（谁说的）≠ 信息为真（说的对不对）。** 大 V / 官方也会爆未证实消息、做预测、玩梗、炒旧闻。因此可信度高的来源不能直接当「已确认事实」。

对每条值得处理的推文：

1. **抽取**（LLM）：核心实体 / 事件 + 可核查声明（claim）+ 推文类型（官方自宣 / 爆料 / 观点 / 反应）。
2. **按类型分档验证**：
   - 官方自宣 → 只富化：抓官方链接与细节，轻验证，不证真。
   - 爆料 / 转述 → 重验证：必须找独立权威来源印证。
   - 观点 / 玩梗 / 反应 → 不证真：仅作趋势信号，或不入库。
3. **验证动作**：由抽取出的声明生成「定向、中英双语、限时间窗」的搜索查询 → 统计独立权威来源的印证 / 反驳数 → 锚定官方 / 规范 URL → 据此升级状态：`SOCIAL_BUZZ → MULTI_SOURCE_SIGNAL → CONFIRMED`，设置 `confidence`、富化摘要；搜不到或被反驳则标 `NEEDS_VERIFICATION`（疑似传闻）。
4. **成本控制**：按推文热度 / 相关性设阈值，只对值得的推文做验证；官方自宣跳过证真。

【现状】当前 AI 分析（`analyze-raw-items.ts` + `prompts.ts`）只做识别 / 聚类 / 摘要 / 评分，**没有**声明抽取、推文类型分档、定向验证查询、状态升级流程。社交单源会被标 `needs_verification`，但不会主动去搜索验证。本流程整体属新增需求。

### 12.4 搜索相关性改造（解决「只能完全匹配」）

【现状】卡片搜索接口 `buildTopicSearchWhere`（`src/app/api/analyze/route.ts`）用 Prisma `contains` 做整串精确子串匹配，中文不分词，导致只能完全匹配。

【目标 / 分阶段】：

- 阶段一：查询切词（中文 bi-gram 兜底）+ 同义 / 中英映射（复用现有 `expandKnownKeyword` / `search-queries.ts` 词表）构造多个 `OR contains`。
- 阶段二：SQLite **FTS5（BM25）** 全文检索。
- 阶段三：embedding 语义检索 + LLM 重排。

### 12.5 时效分层：按来源类型的指数衰减

【现状】日期筛选用一刀切的 `1天 / 7天` 硬窗口；缺 `publishedAt` 时回退 `fetchedAt`，会把旧页伪装成新闻。

【目标 / 拟改造】：

- 用**按来源类型的指数衰减**替代硬窗口：社交 / 快讯衰减快（24–48h），官方 / 研究衰减慢（数天~周）。
- 新鲜度作为热度的一个分量（见 12.2）。
- **缺真实 `publishedAt` 的不计入热度**，仅用于展示；修正当前「回退 `fetchedAt` 把旧页当新闻」的问题。
- X 默认只抓**最近 2 小时**窗口。

## 13. 分阶段开发计划（P0–P3）

优先级框架：P0 先修阻断级问题，P1 做发现-验证与打分锚点（搜索分词可并行），P2 做新鲜度与过滤调优，P3 做检索升级。每个任务给出目标、涉及代码区域、验收标准。本节为规划，未标「已完成」者均为待实现。

### P0 — 阻断级问题（必须先修）

#### P0-1 配置 `.env` 两个 key 并验证生效

- 目标：让 `TWITTERAPI_IO_KEY`、`OPENROUTER_API_KEY` 真正可用，X 采集与 AI 分析不再空跑。
- 涉及：`.env`（新增）、`src/lib/ai/openrouter.ts`、`src/lib/collectors/twitterapi-io.ts`（读取处）；注意 dotenv 默认不覆盖已存在的 `process.env`，系统变量与 `.env` 同名时系统变量优先。
- 现状：用户已在本地系统环境变量配置，正在另行验证生效中。
- 验收：`/api/analyze` 返回 OpenRouter「已配置」；触发一次 X 采集能拿到真实推文与互动指标；AI 分析能产出中文热点。

#### P0-2 修复采集编排（`keywordOnly` 清零 bug + `triggerScan` 带 twitterapi-io）

- 目标：让自动扫描真正「关注关键词搜索 + 选定采集器并行」，X 采集器能被自动调用。
- 涉及：
  - `src/lib/collectors/run-collectors.ts`：`selectedKinds = options.keywordOnly ? [] : ...` —— `keywordOnly=true` 会把 `selectedKinds` 清零，导致 search/official/twitterapi-io 全部不跑。需改为「关键词搜索」与「选定采集器」并存。
  - `src/components/radar-dashboard.tsx`：`triggerScan` 只发 `collectors:["search"]` 且 `keywordOnly` 跟随关键词启用状态。需让自动扫描带上 `twitterapi-io`（与 official）。
  - 参考 `src/app/layout.tsx` 内的预热采集（同样 `collectors:["search"], keywordOnly:true`）。
- 验收：一次自动扫描的 `CollectRun` 日志里 `selectedKinds` 同时包含 `twitterapi-io`（及 official），且关键词搜索仍执行；数据库出现新的 `TWITTER` 来源 `RawItem`。

### P1 — 发现-验证 + 打分锚点 + 搜索分词（可并行）

#### P1-1 X 帖子声明抽取与分档验证流程（对应 12.3）

- 目标：实现「抽取 → 分档 → 定向验证 → 状态升级 / 标疑似传闻」。
- 涉及：`src/lib/ai/prompts.ts`（新增声明抽取 + 推文类型分类的提示）、`src/lib/ai/analyze-raw-items.ts`（分档逻辑、状态升级 `SOCIAL_BUZZ→MULTI_SOURCE_SIGNAL→CONFIRMED`、`needsVerification` 设置）、`src/lib/collectors/search.ts`（执行验证查询）、`src/lib/watch-keywords/search-queries.ts`（生成中英双语限时窗查询）、`src/app/api/analyze/route.ts`。
- 验收：官方自宣推文只富化不证真；爆料类推文会生成验证查询并按独立来源数升级 / 降级；搜不到佐证的标 `NEEDS_VERIFICATION`；验证仅对超过热度 / 相关性阈值的推文触发（有成本控制）。

#### P1-2 打分加确定性锚点（对应 12.2）

- 目标：非社交来源也有确定性基线分（来源档位 + 新鲜度 + 多源佐证），与 AI 分加权；snippet-only / 抓取失败强制降权。
- 涉及：`src/lib/ai/analyze-raw-items.ts`（`fuseHotScore` 改造、新鲜度分量、snippet 降权）、`src/lib/scoring/engagement.ts`（社交分维持）、`src/components/radar-dashboard.tsx`（展示分解后的热度 / 可信度）。
- 验收：登陆页 / 维基 / 纯摘要不再拿到高热度；同一事件多次分析时 `hotScore` 不再在 5/95 间大幅跳变；非社交热点的热度可解释（能看到档位、新鲜度、佐证三项）。

#### P1-3 搜索分词 + 同义 / 中英映射（对应 12.4 阶段一，可与 P1-1/P1-2 并行）

- 目标：卡片搜索不再只能完全匹配。
- 涉及：`src/app/api/analyze/route.ts`（`buildTopicSearchWhere` 改造：切词 + 中文 bi-gram 兜底 + 多 `OR contains`）、`src/lib/watch-keywords/search-queries.ts`（复用 `expandKnownKeyword` 同义 / 中英词表）。
- 验收：用中文词 / 英文同义词 / 部分词都能命中相关卡片；中文短语不再因不分词而漏召回。

### P2 — 新鲜度衰减 + 过滤阈值调优

#### P2-1 分来源新鲜度衰减（对应 12.5）

- 目标：用按来源类型的指数衰减替代硬窗口；缺真实 `publishedAt` 不计入热度。
- 涉及：`src/lib/ai/analyze-raw-items.ts`（新鲜度分量）、`src/app/api/analyze/route.ts`（日期 where 逻辑、`publishedAt` 回退修正）、`src/lib/collectors/twitterapi-io.ts`（X 默认 2 小时窗口）、`src/components/radar-dashboard.tsx`（展示）。
- 验收：社交内容衰减快、官方 / 研究衰减慢；缺 `publishedAt` 的旧页不再被当作新新闻抬高热度；X 默认只抓最近 2 小时。

#### P2-2 推文过滤阈值 `isTweetWorthKeeping` 调优

- 目标：在配齐 key、X 采集跑通后，按真实数据调阈值，平衡召回与噪声。
- 涉及：`src/lib/scoring/engagement.ts`（`isTweetWorthKeeping` 阈值与白名单豁免）、`src/lib/collectors/twitterapi-io.ts`。
- 验收：废帖（极低浏览 / 互动）被过滤，官方 / KOL / 认证作者豁免；头部按 `engagementScore` 取，噪声明显下降。

### P3 — 检索升级

#### P3-1 SQLite FTS5（BM25）（对应 12.4 阶段二）

- 目标：用全文索引替代 `contains`，提升相关性排序。
- 涉及：`prisma/schema.prisma` / 迁移（FTS5 虚表）、`src/app/api/analyze/route.ts`（查询改走 FTS5）。
- 验收：搜索结果按相关度排序，长文 / 多词查询召回与排序明显优于 `contains`。

#### P3-2 embedding 语义检索 + LLM 重排（对应 12.4 阶段三）

- 目标：语义级检索，支持近义 / 跨语言 / 概念匹配。
- 涉及：embedding 生成与存储（新模块）、`src/app/api/analyze/route.ts`（向量召回 + LLM 重排）、`src/lib/ai/openrouter.ts`。
- 验收：语义相近但用词不同的查询也能召回正确热点，重排后头部结果相关性高。
