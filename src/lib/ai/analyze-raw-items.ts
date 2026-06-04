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
      publishedAt: item.publishedAt
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

    const topic = await prisma.hotTopic.create({
      data: {
        title: analysis.topic,
        summary: analysis.summary,
        whyItMatters: analysis.why_it_matters,
        category: analysis.category,
        hotScore: analysis.hot_score,
        confidence: analysis.confidence,
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
