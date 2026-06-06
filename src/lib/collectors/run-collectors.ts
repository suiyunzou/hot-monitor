import { CollectRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { allDefaultSources, defaultKolAccounts } from "./default-sources";
import { buildKeywordSearchQueries } from "@/lib/watch-keywords/search-queries";
import { OfficialCollector } from "./official";
import { collectSearchQuery, SearchCollector } from "./search";
import { TwitterApiIoCollector } from "./twitterapi-io";
import type { CollectedItem, CollectorKind, SourceCollector } from "./types";
import { fetchText, sleep } from "@/lib/http/fetch-page";
import { extractArticle, stripTracking } from "@/lib/extractors/article-extractor";
import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import { makeLogger } from "@/lib/logger";

const logger = makeLogger("collect:run");

type RunCollectorOptions = {
  collectors?: CollectorKind[];
  limit?: number;
  query?: string;
  keywordOnly?: boolean;
};

const collectorMap: Record<CollectorKind, SourceCollector> = {
  official: new OfficialCollector(),
  search: new SearchCollector(),
  "twitterapi-io": new TwitterApiIoCollector()
};

export async function runCollectors(options: RunCollectorOptions = {}) {
  await ensureDefaultSources();
  await ensureDefaultKolAccounts();
  // `keywordOnly` only means "also prioritize the watched-keyword search"; it
  // must NOT zero out the regular collectors. Selected collectors and the
  // keyword search run in parallel, so X / official / search keep running even
  // when keywordOnly is true.
  const selectedKinds = options.collectors?.length
    ? options.collectors
    : (Object.keys(collectorMap) as CollectorKind[]);

  const run = await prisma.collectRun.create({
    data: {
      status: CollectRunStatus.RUNNING,
      metadataJson: JSON.stringify({
        selectedKinds,
        limit: options.limit,
        query: options.query,
        keywordOnly: options.keywordOnly
      })
    }
  });

  await logger.runSection(run.id, "采集任务开始", {
    selectedKinds,
    limit: options.limit,
    query: options.query,
    keywordOnly: options.keywordOnly
  });
  await logger.runInfo({
    runId: run.id,
    phase: "collect",
    eventType: "run_start",
    message: `采集器：[${selectedKinds.join(", ") || "仅关键词搜索"}]${options.query ? ` | 指定查询：${options.query}` : ""}`,
    details: { selectedKinds, query: options.query, keywordOnly: options.keywordOnly }
  });

  const errors: string[] = [];
  let fetchedCount = 0;
  let newCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  try {
    // ── 关键词搜索 ──────────────────────────────────────────────
    await logger.runSection(run.id, "关键词搜索采集");
    const keywordResult = await collectEnabledKeywordSearches(options.limit, run.id);

    if (keywordResult.keywords.length === 0) {
      await logger.runWarn({
        runId: run.id,
        phase: "keyword",
        eventType: "keyword_empty",
        message: "没有启用的关注关键词，跳过关键词搜索"
      });
    } else {
      await logger.runInfo({
        runId: run.id,
        phase: "keyword",
        eventType: "keyword_enabled",
        message: `启用关键词 ${keywordResult.keywords.length} 个：${keywordResult.keywords.map((k) => k.keyword).join(" / ")}`,
        details: { keywords: keywordResult.keywords.map((keyword) => keyword.keyword) }
      });
    }

    await prisma.collectRun.update({
      where: { id: run.id },
      data: {
        metadataJson: JSON.stringify({
          selectedKinds,
          limit: options.limit,
          query: options.query,
          keywordOnly: options.keywordOnly,
          keywords: keywordResult.keywords.map((keyword) => keyword.keyword)
        })
      }
    });

    const keywordSaveResult = await saveCollectedItems(keywordResult.items, run.id);
    newCount += keywordSaveResult.newCount;
    duplicateCount += keywordSaveResult.duplicateCount;
    skippedCount += keywordSaveResult.skippedCount;
    fetchedCount += keywordResult.fetchedCount;
    errors.push(...keywordResult.errors);

    await logger.runInfo({
      runId: run.id,
      phase: "keyword",
      eventType: "keyword_save_result",
      message: `关键词搜索结果 → 候选 ${keywordResult.fetchedCount} | 新增 ${keywordSaveResult.newCount} | 重复 ${keywordSaveResult.duplicateCount} | 跳过 ${keywordSaveResult.skippedCount}`,
      details: {
        fetchedCount: keywordResult.fetchedCount,
        newCount: keywordSaveResult.newCount,
        duplicateCount: keywordSaveResult.duplicateCount,
        skippedCount: keywordSaveResult.skippedCount
      }
    });

    if (keywordResult.errors.length > 0) {
      for (const err of keywordResult.errors) {
        await logger.runError({
          runId: run.id,
          phase: "keyword",
          eventType: "keyword_error",
          message: `关键词搜索错误：${err}`,
          details: { error: err }
        });
      }
    }

    // ── 各采集器 ────────────────────────────────────────────────
    const kolAccounts = await prisma.kolAccount.findMany({
      where: { enabled: true },
      select: { handle: true, tier: true }
    });

    await logger.runInfo({
      runId: run.id,
      phase: "kol",
      eventType: "kol_enabled",
      message: `已启用 KOL 账号 ${kolAccounts.length} 个`,
      details: { accounts: kolAccounts.map((account) => account.handle) }
    });

    for (const kind of selectedKinds) {
      await logger.runSection(run.id, `采集器：${kind}`, { collector: kind });
      const collector = collectorMap[kind];
      const result = await collector.collect({
        limit: options.limit,
        query: options.query,
        runId: run.id,
        kolAccounts
      });

      fetchedCount += result.fetchedCount;
      errors.push(...result.errors);

      const saveResult = await saveCollectedItems(result.items, run.id);
      newCount += saveResult.newCount;
      duplicateCount += saveResult.duplicateCount;
      skippedCount += saveResult.skippedCount;

      await logger.runInfo({
        runId: run.id,
        phase: kind,
        eventType: "collector_save_result",
        message: `${kind} 结果 → 候选 ${result.fetchedCount} | 新增 ${saveResult.newCount} | 重复 ${saveResult.duplicateCount} | 跳过 ${saveResult.skippedCount}`,
        details: {
          collector: kind,
          fetchedCount: result.fetchedCount,
          newCount: saveResult.newCount,
          duplicateCount: saveResult.duplicateCount,
          skippedCount: saveResult.skippedCount
        }
      });

      for (const err of result.errors) {
        await logger.runError({
          runId: run.id,
          phase: kind,
          eventType: "collector_error",
          message: `${kind} 错误：${err}`,
          details: { collector: kind, error: err }
        });
      }
    }

    // ── 汇总 ────────────────────────────────────────────────────
    await logger.runSection(run.id, "采集任务完成");

    const status =
      errors.length === 0
        ? CollectRunStatus.SUCCESS
        : newCount > 0
          ? CollectRunStatus.PARTIAL_SUCCESS
          : CollectRunStatus.FAILED;

    await logger.runInfo({
      runId: run.id,
      phase: "collect",
      eventType: "run_complete",
      message: `总计 → 候选 ${fetchedCount} | 新增 ${newCount} | 重复 ${duplicateCount} | 跳过 ${skippedCount} | 错误 ${errors.length} | 状态 ${status}`,
      details: { fetchedCount, newCount, duplicateCount, skippedCount, errorCount: errors.length, status }
    });

    await prisma.collectRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        fetchedCount,
        newCount,
        errorMessage: errors.length ? errors.slice(0, 8).join("\n") : null,
        metadataJson: JSON.stringify({
          selectedKinds,
          limit: options.limit,
          query: options.query,
          keywordOnly: options.keywordOnly,
          keywords: keywordResult.keywords.map((keyword) => keyword.keyword),
          duplicateCount,
          skippedCount
        })
      }
    });

    return {
      runId: run.id,
      status,
      fetchedCount,
      newCount,
      errors,
      keywordCount: keywordResult.keywords.length,
      keywords: keywordResult.keywords.map((keyword) => keyword.keyword),
      duplicateCount,
      skippedCount
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.runError({
      runId: run.id,
      phase: "collect",
      eventType: "run_crashed",
      message: `采集任务崩溃：${message}`,
      details: { error: message }
    });
    await prisma.collectRun.update({
      where: { id: run.id },
      data: {
        status: CollectRunStatus.FAILED,
        finishedAt: new Date(),
        fetchedCount,
        newCount,
        errorMessage: message
      }
    });

    throw error;
  }
}

async function collectEnabledKeywordSearches(limit = 2, runId?: string) {
  const kwLogger = makeLogger("collect:keyword");
  const perQueryLimit = Math.max(2, Math.min(limit, 5));
  const keywords = await prisma.watchKeyword.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  const items: CollectedItem[] = [];
  const errors: string[] = [];
  let fetchedCount = 0;

  for (const keyword of keywords) {
    const queries = buildKeywordSearchQueries(keyword.keyword).slice(0, 5);
    kwLogger.info(`关键词「${keyword.keyword}」生成 ${queries.length} 条查询`);
    if (runId) {
      await kwLogger.runInfo({
        runId,
        phase: "keyword",
        eventType: "keyword_queries",
        message: `关键词「${keyword.keyword}」生成 ${queries.length} 条查询`,
        details: { keyword: keyword.keyword, keywordId: keyword.id, queries }
      });
    }

    for (const query of queries) {
      kwLogger.debug(`执行查询：${query}`);
      const hits = await collectSearchQuery(query, {
        watchKeywordId: keyword.id,
        limit: perQueryLimit,
        runId
      });
      fetchedCount += hits.length;
      const relevantHits = hits.filter((hit) => isKeywordRelevant(keyword.keyword, hit));
      const droppedCount = hits.length - relevantHits.length;

      kwLogger.info(
        `「${keyword.keyword}」查询命中 ${hits.length} 条，相关性过滤后保留 ${relevantHits.length} 条${droppedCount > 0 ? `（丢弃 ${droppedCount} 条不相关）` : ""}`
      );
      if (runId) {
        await kwLogger.runInfo({
          runId,
          phase: "filter",
          eventType: "relevance_filter",
          message: `「${keyword.keyword}」相关性过滤：${hits.length} → ${relevantHits.length}`,
          details: {
            keyword: keyword.keyword,
            keywordId: keyword.id,
            query,
            hitCount: hits.length,
            keptCount: relevantHits.length,
            droppedCount
          }
        });
      }

      for (const hit of relevantHits.slice(0, perQueryLimit)) {
        try {
          await sleep(350);
          kwLogger.debug(`抓取落地页：${hit.url}`);
          if (runId) {
            await kwLogger.runDebug({
              runId,
              phase: "evidence",
              eventType: "landing_fetch_start",
              message: `抓取落地页：${hit.title}`,
              details: { keyword: keyword.keyword, query, provider: hit.provider, url: hit.url }
            });
          }
          const html = await fetchText(hit.url);
          const article = extractArticle(html, hit.url);

          kwLogger.info(`落地页成功：${article.title || hit.title} [${hit.url}]`);
          if (runId) {
            await kwLogger.runInfo({
              runId,
              phase: "evidence",
              eventType: "landing_fetch_success",
              message: `落地页抓取成功：${article.title || hit.title}`,
              details: {
                keyword: keyword.keyword,
                keywordId: keyword.id,
                query,
                provider: hit.provider,
                url: hit.url,
                credibilityLevel: CredibilityLevel.MEDIA
              }
            });
          }

          items.push({
            sourceKey: "web-search",
            watchKeywordId: keyword.id,
            sourceType: SourceType.SEARCH,
            credibilityLevel: CredibilityLevel.MEDIA,
            url: stripTracking(article.canonicalUrl ?? article.url),
            canonicalUrl: article.canonicalUrl,
            title: article.title || hit.title,
            excerpt: article.excerpt ?? hit.excerpt,
            content: article.content,
            author: article.author,
            publishedAt: article.publishedAt,
            language: article.language,
            metadata: {
              keyword: keyword.keyword,
              keywordId: keyword.id,
              query,
              provider: hit.provider
            }
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          kwLogger.warn(`落地页抓取失败，降级为搜索摘要：${hit.url} → ${errMsg}`);
          if (runId) {
            await kwLogger.runWarn({
              runId,
              phase: "evidence",
              eventType: "landing_fetch_fallback",
              message: `落地页抓取失败，降级为搜索摘要：${hit.title}`,
              details: {
                keyword: keyword.keyword,
                keywordId: keyword.id,
                query,
                provider: hit.provider,
                url: hit.url,
                credibilityLevel: CredibilityLevel.SEARCH_SNIPPET,
                error: errMsg
              }
            });
          }
          items.push({
            sourceKey: "web-search",
            watchKeywordId: keyword.id,
            sourceType: SourceType.SEARCH,
            credibilityLevel: CredibilityLevel.SEARCH_SNIPPET,
            url: stripTracking(hit.url),
            title: hit.title,
            excerpt: hit.excerpt,
            metadata: {
              keyword: keyword.keyword,
              keywordId: keyword.id,
              query,
              provider: hit.provider,
              snippetOnly: true,
              extractionError: errMsg
            }
          });
        }
      }
    }
  }

  return {
    items,
    keywords,
    fetchedCount,
    errors
  };
}

function isKeywordRelevant(
  keyword: string,
  hit: {
    title: string;
    url: string;
    excerpt?: string;
    query?: string;
  }
) {
  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const haystack = `${hit.title} ${hit.url} ${hit.excerpt ?? ""}`.toLowerCase();
  const expandedTerms = expandKeywordRelevanceTerms(keyword);
  const query = hit.query?.toLowerCase() ?? "";
  return (
    terms.every((term) => haystack.includes(term)) ||
    expandedTerms.some((term) => haystack.includes(term)) ||
    expandedTerms.some((term) => query.includes(term))
  );
}

function expandKeywordRelevanceTerms(keyword: string) {
  const compact = keyword.toLowerCase().replace(/\s+/g, "");

  if (compact === "ai编程" || compact === "ai程序" || compact === "ai开发") {
    return [
      "ai programming",
      "ai coding",
      "ai developer",
      "ai code",
      "code assistant",
      "coding agent",
      "programming agent",
      "developer tools",
      "cursor",
      "github copilot",
      "codex",
      "claude code"
    ];
  }

  return [];
}

// Seed the KOL whitelist once (only when empty) so X collection works out of
// the box; afterwards the user owns the list via the UI.
export async function ensureDefaultKolAccounts() {
  const count = await prisma.kolAccount.count();
  if (count > 0) {
    return;
  }

  for (const account of defaultKolAccounts) {
    await prisma.kolAccount.create({
      data: {
        handle: account.handle,
        displayName: account.displayName,
        tier: account.tier,
        enabled: true
      }
    });
  }
}

export async function ensureDefaultSources() {
  for (const source of allDefaultSources) {
    await prisma.source.upsert({
      where: { key: source.key },
      update: {
        name: source.name,
        type: source.type,
        homepageUrl: source.homepageUrl,
        entryUrl: source.entryUrl,
        enabled: true,
        credibilityLevel: source.credibilityLevel
      },
      create: {
        key: source.key,
        name: source.name,
        type: source.type,
        homepageUrl: source.homepageUrl,
        entryUrl: source.entryUrl,
        enabled: true,
        credibilityLevel: source.credibilityLevel
      }
    });
  }
}

async function saveCollectedItems(items: CollectedItem[], runId?: string) {
  const saveLogger = makeLogger("collect:save");
  let newCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    const source = await prisma.source.findUnique({
      where: { key: item.sourceKey }
    });

    if (!source) {
      saveLogger.warn(`找不到来源配置，跳过：sourceKey=${item.sourceKey} url=${item.url}`);
      if (runId) {
        await saveLogger.runWarn({
          runId,
          phase: "save",
          eventType: "save_skipped",
          message: `找不到来源配置，跳过：${item.title || item.url}`,
          details: { sourceKey: item.sourceKey, url: item.url, reason: "source_missing" }
        });
      }
      skippedCount += 1;
      continue;
    }

    const existing = await prisma.rawItem.findUnique({
      where: {
        sourceId_url: {
          sourceId: source.id,
          url: item.url
        }
      }
    });

    if (existing) {
      saveLogger.debug(`已存在，跳过重复：${item.url}`);
      if (runId) {
        await saveLogger.runDebug({
          runId,
          phase: "save",
          eventType: "duplicate_skipped",
          message: `已存在，跳过重复：${item.title || item.url}`,
          details: {
            rawItemId: existing.id,
            sourceKey: item.sourceKey,
            url: item.url,
            title: item.title
          }
        });
      }
      duplicateCount += 1;
      continue;
    }

    const rawItem = await prisma.rawItem.create({
      data: {
        collectRunId: runId,
        sourceId: source.id,
        watchKeywordId: item.watchKeywordId,
        externalId: item.externalId,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        title: item.title,
        author: item.author,
        excerpt: item.excerpt,
        content: item.content,
        language: item.language,
        publishedAt: item.publishedAt,
        sourceType: item.sourceType,
        credibilityLevel: item.credibilityLevel,
        viewCount: item.viewCount,
        likeCount: item.likeCount,
        retweetCount: item.retweetCount,
        replyCount: item.replyCount,
        engagementScore: item.engagementScore,
        metadataJson: item.metadata ? JSON.stringify(item.metadata) : undefined
      } as any
    });

    saveLogger.info(`入库成功 [${item.credibilityLevel}]：${item.title?.slice(0, 60) || item.url}`);
    if (runId) {
      await saveLogger.runInfo({
        runId,
        phase: "save",
        eventType: "raw_item_created",
        message: `入库成功 [${item.credibilityLevel}]：${item.title?.slice(0, 80) || item.url}`,
        details: {
          rawItemId: rawItem.id,
          sourceKey: item.sourceKey,
          sourceType: item.sourceType,
          credibilityLevel: item.credibilityLevel,
          title: item.title,
          url: item.url,
          metadata: item.metadata
        }
      });
    }
    newCount += 1;
  }

  return {
    newCount,
    duplicateCount,
    skippedCount
  };
}
