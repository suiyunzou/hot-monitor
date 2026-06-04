import * as cheerio from "cheerio";
import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import { extractArticle, normalizeWhitespace, stripTracking } from "@/lib/extractors/article-extractor";
import { absoluteUrl, fetchText, sleep } from "@/lib/http/fetch-page";
import { aiSearchQueries } from "./default-sources";
import type { CollectedItem, CollectorResult, CollectOptions, SourceCollector } from "./types";

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

    for (const query of queries) {
      try {
        hits.push(...(await searchBing(query)));
      } catch (error) {
        errors.push(formatError(`bing search ${query}`, error));
      }

      try {
        hits.push(...(await searchGoogle(query)));
      } catch (error) {
        errors.push(formatError(`google search ${query}`, error));
      }

      await sleep(500);
    }

    for (const hit of dedupeHits(hits).slice(0, options.limit ?? 12)) {
      try {
        await sleep(350);
        const html = await fetchText(hit.url);
        const article = extractArticle(html, hit.url);

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
        errors.push(formatError(`search landing page ${hit.url}`, error));
      }
    }

    return {
      collector: this.kind,
      fetchedCount: hits.length,
      items,
      errors
    };
  }
}

export async function collectSearchQuery(query: string, options: { watchKeywordId?: string; limit?: number } = {}) {
  const hits: SearchHit[] = [];

  try {
    hits.push(...(await searchBing(query, options)));
  } catch {
    // Individual keyword searches should not block the whole collect run.
  }

  try {
    hits.push(...(await searchGoogle(query, options)));
  } catch {
    // Individual keyword searches should not block the whole collect run.
  }

  return dedupeHits(hits).slice(0, options.limit ?? 10);
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
