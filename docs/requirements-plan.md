# AI 热点监控网站需求与开发方案

更新时间：2026-06-04

## 0. 当前开发进度快照

更新时间：2026-06-04 15:45

当前项目已完成网页端 MVP 的主体能力，并已创建本地 Git 基线提交：

- 本地提交：`876be0c Initial AI hot monitor MVP`
- 本地开发地址：`http://localhost:3000`
- 数据库：SQLite，文件路径 `prisma/dev.db`
- Navicat 查看方式：使用 SQLite 连接，直接选择 `C:\Users\86198\Documents\suiyunzou-hot-monitor\prisma\dev.db`

已完成：

- Next.js + TypeScript 项目初始化。
- Prisma + SQLite 数据模型与迁移。
- 默认来源配置，包括官网、X/twitterapi.io、Google/Bing 搜索入口。
- 手动采集 API：`/api/collect`。
- 原始线索 API：`/api/raw-items`。
- AI 分析 API：`/api/analyze`。
- 健康检查 API：`/api/health`。
- 关注关键词 API：`/api/watch-keywords`、`/api/watch-keywords/[id]`。
- OpenRouter 分析接入与 AI 审计记录保存。
- twitterapi.io 采集器。
- Google/Bing 搜索抓取适配器。
- 官网采集器与通用正文提取。
- 网页端“AI 情报雷达”界面。
- 用户自定义关注关键词输入、回显、启用/停用。
- 关键词搜索结果保存 `watchKeywordId`，页面可显示“关注词：xxx”。
- 页面首屏已改为服务端直接读取数据库真实数据，不再依赖前端加载后才替换测试数据。

最近修整：

- 移除首页 `API health` 入口；接口仍保留用于开发调试。
- 顶部雷达区和状态区高度已压缩。
- 状态区从“下次抓取 2 小时内”改为“自动抓取：未启用定时”，避免误导。
- 关键词开关改为明确的启用/停用控件，并增加本地即时反馈。
- 同步采集按钮改为后台启动模式，避免前端等待搜索抓取超时；点击后状态显示“后台采集中”。
- 采集任务开始时立即写入 `CollectRun`，页面状态栏会轮询数据库运行记录，显示运行中、完成时间和新增数量。
- 已在浏览器中验证同步采集按钮、采集状态栏、关注关键词启用/停用交互。
- 移除右侧栏重复的“最近采集链接”列表；来源链接只展示在每张新闻卡片底部。
- 背景从格子纹理改为柔和渐变背景。
- UI 从硬直角风格调整为圆角 dashboard 风格。
- 搜索结果增加关键词相关性过滤，减少 Naver、百度知道等与关注词无关的结果进入页面。
- 通用搜索结果不再直接混入主列表；主列表优先展示关注关键词线索。

当前未完成或待优化：

- 还没有真正的定时任务调度器；页面不会自动每 2 小时采集。
- 邮件推送功能尚未实现。
- Google/Bing 当前仍是网页抓取，结果质量和稳定性不如正式搜索 API。
- 搜索抓取可能较慢，因此手动按钮目前采用后台启动模式。
- 旧数据库里已有部分乱码或噪声数据，后续可做数据清洗或重建本地库。
- 热点聚类仍是初版，尚未实现同事件持续合并。
- 前端错误提示、详细采集日志、失败重试入口仍可继续增强。

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

状态：已进入第三阶段开发；基础采集闭环已完成，仍需优化搜索质量、错误日志和重试体验。

内容：

- 官方网站采集器。
- twitterapi.io 采集器。
- Google/Bing 搜索适配器。
- 用户自定义关键词管理。
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

状态：已完成可用闭环，仍需优化同事件聚类、去重和长期合并策略。

内容：

- 接入 OpenRouter。
- 实现 AI 相关新闻识别。
- 实现聚类、评分、摘要。
- 保存 AI 输入输出审计记录。
- 前端增加“AI 分析”按钮，可手动把 `NEW` 原始线索转为热点卡片。
- `/api/analyze` 返回模型名、OpenRouter 配置状态、待分析数量和热点列表。
- 非 AI 相关线索允许模型返回空 topic/why；真正入库的 AI 热点会使用来源标题和默认说明兜底。

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
