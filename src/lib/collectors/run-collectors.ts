import { CollectRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { allDefaultSources } from "./default-sources";
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

    newCount += await saveCollectedItems(keywordResult.items);
    fetchedCount += keywordResult.items.length;

    for (const kind of selectedKinds) {
      const collector = collectorMap[kind];
      const result = await collector.collect({
        limit: options.limit,
        query: options.query
      });

      fetchedCount += result.fetchedCount;
      errors.push(...result.errors);
      newCount += await saveCollectedItems(result.items);
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
        errorMessage: errors.length ? errors.slice(0, 8).join("\n") : null
      }
    });

    return {
      runId: run.id,
      status,
      fetchedCount,
      newCount,
      errors,
      keywordCount: keywordResult.keywords.length,
      keywords: keywordResult.keywords.map((keyword) => keyword.keyword)
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
  const perQueryLimit = Math.max(1, Math.min(limit, 1));
  const keywords = await prisma.watchKeyword.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  const items: CollectedItem[] = [];

  for (const keyword of keywords) {
    const queries = buildKeywordSearchQueries(keyword.keyword).slice(0, 2);

    for (const query of queries) {
      const hits = await collectSearchQuery(query, {
        watchKeywordId: keyword.id,
        limit: perQueryLimit
      });
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
        } catch {
          // Keyword searches are best-effort; failed landing pages are skipped.
        }
      }
    }
  }

  return {
    items,
    keywords
  };
}

function isKeywordRelevant(
  keyword: string,
  hit: {
    title: string;
    url: string;
    excerpt?: string;
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
  return terms.every((term) => haystack.includes(term));
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

  for (const item of items) {
    const source = await prisma.source.findUnique({
      where: { key: item.sourceKey }
    });

    if (!source) {
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
        metadataJson: item.metadata ? JSON.stringify(item.metadata) : undefined
      }
    });

    newCount += 1;
  }

  return newCount;
}
