import { RadarDashboard } from "@/components/radar-dashboard";
import type { HotTopicApiItem, RawNewsItem, WatchKeyword } from "@/components/radar-dashboard";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [rawItems, hotTopics, watchKeywords] = await Promise.all([
    getInitialRawItems(),
    getInitialHotTopics(),
    getInitialWatchKeywords()
  ]);

  return (
    <RadarDashboard
      initialHotTopics={hotTopics}
      initialRawItems={rawItems}
      initialWatchKeywords={watchKeywords}
    />
  );
}

async function getInitialRawItems(): Promise<RawNewsItem[]> {
  const items = await prisma.rawItem.findMany({
    orderBy: { fetchedAt: "desc" },
    take: 40,
    include: {
      source: {
        select: {
          name: true,
          type: true
        }
      },
      watchKeyword: {
        select: {
          keyword: true
        }
      }
    }
  });
  const filteredItems = items.filter((item) =>
    isRelevantToWatchKeyword(item.watchKeyword?.keyword, {
      title: item.title,
      url: item.url,
      excerpt: item.excerpt
    })
  );
  const keywordItems = filteredItems.filter((item) => item.watchKeyword);
  const generalItems = filteredItems.filter(
    (item) =>
      !item.watchKeyword &&
      item.sourceType !== "SEARCH" &&
      isGeneralAiSignal({
        title: item.title,
        url: item.url,
        excerpt: item.excerpt
      })
  );

  return [...keywordItems, ...generalItems].slice(0, 12).map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    excerpt: item.excerpt ?? undefined,
    sourceName: item.source.name,
    sourceType: item.source.type,
    credibilityLevel: item.credibilityLevel,
    watchKeyword: item.watchKeyword?.keyword ?? null,
    fetchedAt: item.fetchedAt.toISOString(),
    publishedAt: item.publishedAt?.toISOString()
  }));
}

async function getInitialHotTopics(): Promise<HotTopicApiItem[]> {
  const topics = await prisma.hotTopic.findMany({
    orderBy: [{ hotScore: "desc" }, { lastSeenAt: "desc" }],
    take: 12,
    include: {
      sources: {
        include: {
          rawItem: {
            select: {
              title: true,
              url: true,
              sourceType: true,
              credibilityLevel: true,
              source: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      }
    }
  });

  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    summary: topic.summary,
    whyItMatters: topic.whyItMatters,
    category: topic.category,
    hotScore: topic.hotScore,
    confidence: topic.confidence,
    status: topic.status,
    needsVerification: topic.needsVerification,
    sources: topic.sources.map((source) => ({
      title: source.rawItem.title,
      url: source.rawItem.url,
      sourceType: source.rawItem.sourceType,
      sourceName: source.rawItem.source.name,
      credibilityLevel: source.rawItem.credibilityLevel
    }))
  }));
}

async function getInitialWatchKeywords(): Promise<WatchKeyword[]> {
  const keywords = await prisma.watchKeyword.findMany({
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }]
  });

  return keywords.map((keyword) => ({
    id: keyword.id,
    keyword: keyword.keyword,
    enabled: keyword.enabled
  }));
}

function isRelevantToWatchKeyword(
  keyword: string | undefined,
  item: {
    title: string;
    url: string;
    excerpt: string | null;
  }
) {
  if (!keyword) {
    return true;
  }

  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const haystack = `${item.title} ${item.url} ${item.excerpt ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function isGeneralAiSignal(item: {
  title: string;
  url: string;
  excerpt: string | null;
}) {
  const haystack = `${item.title} ${item.url} ${item.excerpt ?? ""}`.toLowerCase();
  return [
    "artificial intelligence",
    "openai",
    "anthropic",
    "claude",
    "deepseek",
    "grok",
    "gemini",
    "llm",
    "agentic",
    "ai agent",
    "ai model",
    "model release"
  ].some((term) => haystack.includes(term));
}
