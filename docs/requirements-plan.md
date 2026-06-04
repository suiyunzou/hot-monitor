# AI 热点监控网站需求与开发方案

更新时间：2026-06-04

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

产出：

- 本文档。
- 经用户确认的信息源范围。
- 经用户确认的技术栈和分阶段计划。

验收：

- 用户确认可以进入编码阶段。

### 阶段 2：项目初始化与基础页面

内容：

- 初始化 Next.js + TypeScript。
- 配置 Prisma + SQLite。
- 建立基础数据模型。
- 完成网页端静态骨架。

验收：

- 本地网页可打开。
- 页面能展示模拟热点数据。

### 阶段 3：采集器实现

内容：

- 官方网站采集器。
- twitterapi.io 采集器。
- Google/Bing 搜索适配器。
- 用户自定义关键词管理。
- 启用关键词参与搜索采集。
- 通用网页正文提取。
- 采集日志。

验收：

- 手动触发采集后，数据库有真实数据。
- 页面能展示真实来源链接。

### 阶段 4：OpenRouter 热点分析

内容：

- 接入 OpenRouter。
- 实现 AI 相关新闻识别。
- 实现聚类、评分、摘要。
- 保存 AI 输入输出审计记录。

验收：

- 页面能看到 AI 生成的热点摘要。
- 每个摘要能追溯来源。

### 阶段 5：邮件推送

内容：

- SMTP 配置。
- HTML 日报模板。
- 每 2 小时抓取一次信息。
- 抓取完成后将新增热点以邮件形式转发。
- 支持手动触发抓取与发送，便于调试和验收。
- 推送记录。

验收：

- 用户能收到 AI 热点邮件。
- 系统不会重复推送已发送过的热点。

### 阶段 6：测试与页面验收

内容：

- 单元测试。
- 集成测试。
- 浏览器实际检查。
- 抓取失败、AI 失败、邮件失败的错误状态。

验收：

- 用户确认网页版功能正常。

### 阶段 7：Agent Skill

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
