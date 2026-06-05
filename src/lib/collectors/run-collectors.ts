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
  const selectedKinds = options.keywordOnly
    ? []
    : options.collectors?.length
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

  const errors: string[] = [];
  let fetchedCount = 0;
  let newCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  try {
    const keywordResult = await collectEnabledKeywordSearches(options.limit);
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

    const keywordSaveResult = await saveCollectedItems(keywordResult.items);
    newCount += keywordSaveResult.newCount;
    duplicateCount += keywordSaveResult.duplicateCount;
    skippedCount += keywordSaveResult.skippedCount;
    fetchedCount += keywordResult.fetchedCount;
    errors.push(...keywordResult.errors);

    const kolAccounts = await prisma.kolAccount.findMany({
      where: { enabled: true },
      select: { handle: true, tier: true }
    });

    for (const kind of selectedKinds) {
      const collector = collectorMap[kind];
      const result = await collector.collect({
        limit: options.limit,
        query: options.query,
        kolAccounts
      });

      fetchedCount += result.fetchedCount;
      errors.push(...result.errors);
      const saveResult = await saveCollectedItems(result.items);
      newCount += saveResult.newCount;
      duplicateCount += saveResult.duplicateCount;
      skippedCount += saveResult.skippedCount;
    }

    const status =
      errors.length === 0
        ? CollectRunStatus.SUCCESS
        : newCount > 0
          ? CollectRunStatus.PARTIAL_SUCCESS
          : CollectRunStatus.FAILED;

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

async function collectEnabledKeywordSearches(limit = 2) {
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

    for (const query of queries) {
      const hits = await collectSearchQuery(query, {
        watchKeywordId: keyword.id,
        limit: perQueryLimit
      });
      fetchedCount += hits.length;
      const relevantHits = hits.filter((hit) => isKeywordRelevant(keyword.keyword, hit));

      for (const hit of relevantHits.slice(0, perQueryLimit)) {
        try {
          await sleep(350);
          const html = await fetchText(hit.url);
          const article = extractArticle(html, hit.url);

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
              extractionError: error instanceof Error ? error.message : String(error)
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

async function saveCollectedItems(items: CollectedItem[]) {
  let newCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    const source = await prisma.source.findUnique({
      where: { key: item.sourceKey }
    });

    if (!source) {
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
      duplicateCount += 1;
      continue;
    }

    await prisma.rawItem.create({
      data: {
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
      }
    });

    newCount += 1;
  }

  return {
    newCount,
    duplicateCount,
    skippedCount
  };
}
