import { RadarDashboard } from "@/components/radar-dashboard";
import type { HotTopicApiItem, WatchKeyword } from "@/components/radar-dashboard";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [hotTopics, watchKeywords] = await Promise.all([
    getInitialHotTopics(),
    getInitialWatchKeywords()
  ]);

  return <RadarDashboard initialHotTopics={hotTopics} initialWatchKeywords={watchKeywords} />;
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
                author: true,
                excerpt: true,
                publishedAt: true,
                fetchedAt: true,
                viewCount: true,
                likeCount: true,
                retweetCount: true,
                replyCount: true,
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
      author: source.rawItem.author,
      excerpt: source.rawItem.excerpt,
      publishedAt: source.rawItem.publishedAt?.toISOString(),
      fetchedAt: source.rawItem.fetchedAt.toISOString(),
      viewCount: source.rawItem.viewCount,
      likeCount: source.rawItem.likeCount,
      retweetCount: source.rawItem.retweetCount,
      replyCount: source.rawItem.replyCount
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
