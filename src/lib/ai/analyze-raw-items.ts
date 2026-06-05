import { RawItemStatus, TopicStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { buildAnalyzeMessages } from "./prompts";
import { analyzeWithOpenRouter } from "./openrouter";
import type { RawItemAnalysis } from "./schemas";

export async function analyzeRawItems(limit = 5) {
  const rawItems = await prisma.rawItem.findMany({
    where: {
      status: RawItemStatus.NEW
    },
    orderBy: {
      fetchedAt: "desc"
    },
    take: limit,
    include: {
      source: {
        select: {
          name: true
        }
      }
    }
  });

  if (rawItems.length === 0) {
    return {
      analyzedCount: 0,
      topicCount: 0,
      message: "No new raw items to analyze"
    };
  }

  const messages = buildAnalyzeMessages(
    rawItems.map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      credibilityLevel: item.credibilityLevel,
      sourceName: item.source.name,
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
      content: item.content,
      publishedAt: item.publishedAt,
      viewCount: item.viewCount,
      likeCount: item.likeCount,
      retweetCount: item.retweetCount,
      replyCount: item.replyCount,
      engagementScore: item.engagementScore
    }))
  );
  const openRouterResult = await analyzeWithOpenRouter(messages);
  const rawItemById = new Map(rawItems.map((item) => [item.id, item]));
  const validSourceIds = new Set(rawItemById.keys());
  let topicCount = 0;

  for (const analysis of openRouterResult.result.analyses) {
    const sourceIds = analysis.source_ids.filter((sourceId) => validSourceIds.has(sourceId));

    if (sourceIds.length === 0) {
      continue;
    }

    await prisma.aiAnalysis.create({
      data: {
        model: openRouterResult.model,
        task: "raw_item_hot_analysis",
        inputJson: JSON.stringify({ sourceIds }),
        outputJson: JSON.stringify(analysis),
        promptTokens: openRouterResult.promptTokens,
        completionTokens: openRouterResult.completionTokens
      }
    });

    if (!analysis.is_ai_related) {
      await prisma.rawItem.updateMany({
        where: { id: { in: sourceIds } },
        data: { status: RawItemStatus.IGNORED }
      });
      continue;
    }

    const linkedRawItems = sourceIds
      .map((sourceId) => rawItemById.get(sourceId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const isSocialOnly =
      linkedRawItems.length > 0 && linkedRawItems.every((item) => item.sourceType === "TWITTER");
    const needsVerification = analysis.needs_verification || isSocialOnly;
    const hotScore = fuseHotScore(analysis.hot_score, linkedRawItems);
    const confidence = computeCredibility(analysis.confidence, linkedRawItems);

    const topic = await prisma.hotTopic.create({
      data: {
        title: cleanText(analysis.topic) || linkedRawItems[0]?.titleZh || linkedRawItems[0]?.title || "未命名 AI 热点",
        summary: analysis.summary,
        whyItMatters:
          cleanText(analysis.why_it_matters) ||
          "该热点来自已采集的真实来源，需要继续核验影响范围。",
        category: analysis.category,
        hotScore,
        confidence,
        status: inferTopicStatus(analysis, {
          isSocialOnly,
          sourceCount: sourceIds.length,
          needsVerification
        }),
        needsVerification,
        sources: {
          create: sourceIds.map((rawItemId) => ({
            rawItemId
          }))
        },
        aiAnalyses: {
          create: {
            model: openRouterResult.model,
            task: "hot_topic_creation",
            inputJson: JSON.stringify({ sourceIds }),
            outputJson: JSON.stringify(analysis),
            promptTokens: openRouterResult.promptTokens,
            completionTokens: openRouterResult.completionTokens
          }
        }
      }
    });

    await prisma.rawItem.updateMany({
      where: { id: { in: sourceIds } },
      data: { status: RawItemStatus.ANALYZED }
    });

    if (topic.id) {
      topicCount += 1;
    }
  }

  return {
    analyzedCount: rawItems.length,
    topicCount,
    model: openRouterResult.model
  };
}

function cleanText(value: string) {
  return value.trim();
}

type ScoredRawItem = {
  sourceType: string;
  credibilityLevel: string;
  url: string;
  engagementScore: number | null;
};

// Base credibility per source tier (trust, not popularity).
const CREDIBILITY_BASE: Record<string, number> = {
  OFFICIAL: 92,
  PRIMARY: 84,
  MEDIA: 70,
  SOCIAL_VERIFIED: 58,
  SOCIAL: 45,
  SEARCH_SNIPPET: 35
};

/**
 * Blend the AI's hot_score with the deterministic engagement signal. When at
 * least one social source carries an engagement score, weight it 40%; otherwise
 * fall back to the AI score (official/search items have no engagement metrics).
 */
function fuseHotScore(aiHotScore: number, items: ScoredRawItem[]): number {
  const engagementScores = items
    .filter((item) => item.sourceType === "TWITTER" && item.engagementScore != null)
    .map((item) => item.engagementScore as number);

  if (engagementScores.length === 0) {
    return clampScore(aiHotScore);
  }

  const maxEngagement = Math.max(...engagementScores);
  return clampScore(Math.round(0.6 * aiHotScore + 0.4 * maxEngagement));
}

/**
 * Credibility is driven mainly by the strongest source tier plus corroboration
 * from independent sources, lightly adjusted by the AI's confidence.
 */
function computeCredibility(aiConfidence: number, items: ScoredRawItem[]): number {
  if (items.length === 0) {
    return clampScore(aiConfidence);
  }

  const maxBase = Math.max(...items.map((item) => CREDIBILITY_BASE[item.credibilityLevel] ?? 40));
  const independentSources = new Set(items.map((item) => hostOf(item.url) || item.url)).size;
  const corroboration = Math.min(18, 6 * Math.max(0, independentSources - 1));
  const sourceCred = Math.min(100, maxBase + corroboration);

  return clampScore(Math.round(0.7 * sourceCred + 0.3 * aiConfidence));
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function inferTopicStatus(
  analysis: RawItemAnalysis,
  context: {
    isSocialOnly: boolean;
    sourceCount: number;
    needsVerification: boolean;
  }
) {
  if (context.isSocialOnly) {
    return TopicStatus.SOCIAL_BUZZ;
  }

  if (context.needsVerification) {
    return TopicStatus.NEEDS_VERIFICATION;
  }

  if (analysis.category === "social_signal") {
    return TopicStatus.SOCIAL_BUZZ;
  }

  if (context.sourceCount > 1) {
    return TopicStatus.MULTI_SOURCE_SIGNAL;
  }

  return TopicStatus.CONFIRMED;
}
