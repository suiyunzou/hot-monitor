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

  return items.slice(0, 40).map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    excerpt: item.excerpt ?? undefined,
    content: item.content ?? undefined,
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
                excerpt: true,
                publishedAt: true,
                fetchedAt: true,
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
      credibilityLevel: source.rawItem.credibilityLevel,
      excerpt: source.rawItem.excerpt,
      publishedAt: source.rawItem.publishedAt?.toISOString(),
      fetchedAt: source.rawItem.fetchedAt.toISOString()
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
