# Suiyunzou AI Hot Monitor

网页端 AI 热点监控工具。系统围绕默认来源和用户关注关键词执行采集，保存原始线索，再通过 OpenRouter 做 AI 分析和热点展示。

## 快速运行

```powershell
npm install
npm run dev
```

开发地址：

```text
http://localhost:3000
```

验证命令：

```powershell
npm run typecheck
npm run build
```

## 文档

- [开发指南](docs/development-guide.md)
- [当前项目状态](docs/current-status.md)
- [OpenRouter 配置](docs/openrouter-config.md)
- [twitterapi.io 配置](docs/twitterapi-io-config.md)
- [需求与开发方案](docs/requirements-plan.md)

## 关键概念

- `fetchedCount`: 搜索候选数。
- `newCount`: 本轮新增入库数。
- `duplicateCount`: 已存在 URL 数，保存在 `CollectRun.metadataJson`。
- `SEARCH_SNIPPET`: 落地页无法抓取时保存的搜索摘要线索，可信度较低，需要继续核验。

## 当前注意事项

- 本地交互验证请使用 `http://localhost:3000`。
- `127.0.0.1:3000` 在 Next.js dev 模式下可能触发 HMR 跨 origin 限制。
- 搜索仍使用 Google/Bing 网页抓取，稳定性不如正式搜索 API。
