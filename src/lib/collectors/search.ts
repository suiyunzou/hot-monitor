import * as cheerio from "cheerio";
import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import { extractArticle, normalizeWhitespace, stripTracking } from "@/lib/extractors/article-extractor";
import { absoluteUrl, fetchText, sleep } from "@/lib/http/fetch-page";
import { aiSearchQueries } from "./default-sources";
import type { CollectedItem, CollectorResult, CollectOptions, SourceCollector } from "./types";
import { makeLogger } from "@/lib/logger";

const logger = makeLogger("collect:search");

const RELEVANT_PATTERNS = [
  /\bai\b/i,
  /\bartificial intelligence\b/i,
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bclaude\b/i,
  /\bdeepmind\b/i,
  /\bgemini\b/i,
  /\bdeepseek\b/i,
  /\bllm\b/i,
  /\bmodel\b/i,
  /\bagent\b/i,
  /\bagents\b/i
];

const BLOCKED_HOSTS = ["bing.com", "www.bing.com", "google.com", "www.google.com"];

type SearchHit = {
  title: string;
  url: string;
  excerpt?: string;
  provider: "bing" | "google";
  query: string;
  watchKeywordId?: string;
};

export class SearchCollector implements SourceCollector {
  kind = "search" as const;

  async collect(options: CollectOptions = {}): Promise<CollectorResult> {
    const queries = options.query ? [options.query] : aiSearchQueries.slice(0, options.limit ?? 5);
    const hits: SearchHit[] = [];
    const items: CollectedItem[] = [];
    const errors: string[] = [];

    logger.info(`开始搜索采集，共 ${queries.length} 条查询`);
    if (options.runId) {
      await logger.runInfo({
        runId: options.runId,
        phase: "search",
        eventType: "collector_start",
        message: `搜索采集开始，共 ${queries.length} 条查询`,
        details: { queries }
      });
    }

    for (const query of queries) {
      let bingCount = 0;
      let googleCount = 0;

      try {
        const bingHits = await searchBing(query);
        bingCount = bingHits.length;
        hits.push(...bingHits);
      } catch (error) {
        logger.error(`Bing 搜索失败「${query}」：${error instanceof Error ? error.message : String(error)}`);
        if (options.runId) {
          await logger.runWarn({
            runId: options.runId,
            phase: "search",
            eventType: "provider_failed",
            message: `Bing 搜索失败：${query}`,
            details: { provider: "bing", query, error: error instanceof Error ? error.message : String(error) }
          });
        }
        errors.push(formatError(`bing search ${query}`, error));
      }

      try {
        const googleHits = await searchGoogle(query);
        googleCount = googleHits.length;
        hits.push(...googleHits);
      } catch (error) {
        logger.error(`Google 搜索失败「${query}」：${error instanceof Error ? error.message : String(error)}`);
        if (options.runId) {
          await logger.runWarn({
            runId: options.runId,
            phase: "search",
            eventType: "provider_failed",
            message: `Google 搜索失败：${query}`,
            details: { provider: "google", query, error: error instanceof Error ? error.message : String(error) }
          });
        }
        errors.push(formatError(`google search ${query}`, error));
      }

      logger.info(`查询「${query}」→ Bing ${bingCount} 条 / Google ${googleCount} 条`);
      if (options.runId) {
        await logger.runInfo({
          runId: options.runId,
          phase: "search",
          eventType: "query_result",
          message: `查询完成：${query}`,
          details: { query, providers: { bing: bingCount, google: googleCount } }
        });
      }
      await sleep(500);
    }

    const deduped = dedupeHits(hits);
    const takeCount = options.limit ?? 12;
    logger.info(`搜索命中合计 ${hits.length} 条，去重后 ${deduped.length} 条，取前 ${takeCount} 条抓落地页`);
    if (options.runId) {
      await logger.runInfo({
        runId: options.runId,
        phase: "search",
        eventType: "dedupe_result",
        message: `搜索结果去重完成：${hits.length} → ${deduped.length}`,
        details: { hitCount: hits.length, dedupedCount: deduped.length, takeCount }
      });
    }

    for (const hit of deduped.slice(0, takeCount)) {
      try {
        await sleep(350);
        logger.debug(`抓取落地页 [${hit.provider}]：${hit.url}`);
        if (options.runId) {
          await logger.runDebug({
            runId: options.runId,
            phase: "evidence",
            eventType: "landing_fetch_start",
            message: `抓取落地页：${hit.title}`,
            details: { provider: hit.provider, query: hit.query, url: hit.url }
          });
        }
        const html = await fetchText(hit.url);
        const article = extractArticle(html, hit.url);

        logger.info(`落地页成功 [${hit.provider}]：${article.title || hit.title}`);
        if (options.runId) {
          await logger.runInfo({
            runId: options.runId,
            phase: "evidence",
            eventType: "landing_fetch_success",
            message: `落地页抓取成功：${article.title || hit.title}`,
            details: {
              provider: hit.provider,
              query: hit.query,
              url: hit.url,
              credibilityLevel: CredibilityLevel.MEDIA
            }
          });
        }

        items.push({
          sourceKey: "web-search",
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
            provider: hit.provider,
            query: hit.query,
            watchKeywordId: hit.watchKeywordId,
            searchTitle: hit.title,
            searchExcerpt: hit.excerpt
          }
        });
      } catch (error) {
        logger.warn(`落地页抓取失败（丢弃）：${hit.url} → ${error instanceof Error ? error.message : String(error)}`);
        if (options.runId) {
          await logger.runWarn({
            runId: options.runId,
            phase: "evidence",
            eventType: "landing_fetch_dropped",
            message: `落地页抓取失败并丢弃：${hit.title}`,
            details: {
              provider: hit.provider,
              query: hit.query,
              url: hit.url,
              error: error instanceof Error ? error.message : String(error)
            }
          });
        }
        errors.push(formatError(`search landing page ${hit.url}`, error));
      }
    }

    logger.info(`搜索采集完成：成功入队 ${items.length} 条，错误 ${errors.length} 个`);
    if (options.runId) {
      await logger.runInfo({
        runId: options.runId,
        phase: "search",
        eventType: "collector_complete",
        message: `搜索采集完成：入队 ${items.length} 条，错误 ${errors.length} 个`,
        details: { itemCount: items.length, errorCount: errors.length }
      });
    }

    return {
      collector: this.kind,
      fetchedCount: hits.length,
      items,
      errors
    };
  }
}

export async function collectSearchQuery(query: string, options: { watchKeywordId?: string; limit?: number; runId?: string } = {}) {
  const hits: SearchHit[] = [];
  let bingCount = 0;
  let googleCount = 0;

  try {
    const bingHits = await searchBing(query, options);
    bingCount = bingHits.length;
    hits.push(...bingHits);
  } catch (error) {
    logger.warn(`Bing 搜索失败「${query}」：${error instanceof Error ? error.message : String(error)}`);
    if (options.runId) {
      await logger.runWarn({
        runId: options.runId,
        phase: "search",
        eventType: "provider_failed",
        message: `Bing 搜索失败：${query}`,
        details: { provider: "bing", query, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  try {
    const googleHits = await searchGoogle(query, options);
    googleCount = googleHits.length;
    hits.push(...googleHits);
  } catch (error) {
    logger.warn(`Google 搜索失败「${query}」：${error instanceof Error ? error.message : String(error)}`);
    if (options.runId) {
      await logger.runWarn({
        runId: options.runId,
        phase: "search",
        eventType: "provider_failed",
        message: `Google 搜索失败：${query}`,
        details: { provider: "google", query, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  const result = dedupeHits(hits).slice(0, options.limit ?? 10);
  logger.debug(`关键词查询「${query}」→ Bing ${bingCount} / Google ${googleCount} → 去重后 ${result.length} 条`);
  if (options.runId) {
    await logger.runInfo({
      runId: options.runId,
      phase: "search",
      eventType: "query_result",
      message: `关键词查询完成：${query}`,
      details: {
        query,
        providers: { bing: bingCount, google: googleCount },
        dedupedCount: result.length,
        watchKeywordId: options.watchKeywordId
      }
    });
  }
  return result;
}

async function searchBing(query: string, options: { watchKeywordId?: string } = {}): Promise<SearchHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  return $("li.b_algo")
    .toArray()
    .map((element): SearchHit | undefined => {
      const title = normalizeWhitespace($(element).find("h2").first().text());
      const href = $(element).find("h2 a").first().attr("href");
      const excerpt = normalizeWhitespace($(element).find(".b_caption p").first().text());
      const unwrappedUrl = href ? unwrapBingUrl(href) : undefined;

      if (!title || !unwrappedUrl || !isRelevantHit(title, unwrappedUrl, excerpt)) {
        return undefined;
      }

      return {
        title,
        url: stripTracking(unwrappedUrl),
        excerpt,
        provider: "bing" as const,
        query,
        watchKeywordId: options.watchKeywordId
      };
    })
    .filter(isDefined);
}

async function searchGoogle(query: string, options: { watchKeywordId?: string } = {}): Promise<SearchHit[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  return $("a")
    .toArray()
    .map((element): SearchHit | undefined => {
      const href = $(element).attr("href");
      const title = normalizeWhitespace($(element).text());
      const extractedUrl = extractGoogleUrl(href);

      if (!title || !extractedUrl || title.length < 12 || !isRelevantHit(title, extractedUrl)) {
        return undefined;
      }

      return {
        title: title.slice(0, 220),
        url: stripTracking(extractedUrl),
        provider: "google" as const,
        query,
        watchKeywordId: options.watchKeywordId
      };
    })
    .filter(isDefined);
}

function extractGoogleUrl(href?: string) {
  if (!href) {
    return undefined;
  }

  if (href.startsWith("/url?")) {
    const parsed = new URL(href, "https://www.google.com");
    const target = parsed.searchParams.get("q");
    return target ? absoluteUrl("https://www.google.com", target) : undefined;
  }

  if (href.startsWith("http")) {
    return href;
  }

  return undefined;
}

function unwrapBingUrl(href: string) {
  try {
    const parsed = new URL(href, "https://www.bing.com");
    const encodedTarget = parsed.searchParams.get("u");

    if (encodedTarget?.startsWith("a1")) {
      const base64Url = encodedTarget.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(base64Url, "base64").toString("utf8");
      if (decoded.startsWith("http")) {
        return decoded;
      }
    }

    if (href.startsWith("http")) {
      return href;
    }

    return undefined;
  } catch {
    return href.startsWith("http") ? href : undefined;
  }
}

function isRelevantHit(title: string, url: string, excerpt = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (BLOCKED_HOSTS.includes(host) || host.endsWith(".bing.com") || host.endsWith(".google.com")) {
      return false;
    }
  } catch {
    return false;
  }

  const haystack = `${title} ${url} ${excerpt}`.toLowerCase();
  return RELEVANT_PATTERNS.some((pattern) => pattern.test(haystack));
}

function dedupeHits(hits: SearchHit[]) {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const normalized = stripTracking(hit.url);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    hit.url = normalized;
    return true;
  });
}

function formatError(context: string, error: unknown) {
  return `${context}: ${error instanceof Error ? error.message : String(error)}`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
