import { RawItemStatus, TopicStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { buildAnalyzeMessages } from "./prompts";
import { analyzeWithOpenRouter } from "./openrouter";
import type { RawItemAnalysis } from "./schemas";
import { makeLogger } from "@/lib/logger";

const logger = makeLogger("analyze");

type AnalyzeRawItemsOptions = {
  collectRunId?: string;
};

type RawItemForLineage = {
  id: string;
  sourceType: string;
  credibilityLevel: string;
  title: string;
  url: string;
  metadataJson: string | null;
};

export async function analyzeRawItems(limit = 5, options: AnalyzeRawItemsOptions = {}) {
  const rawItems = await prisma.rawItem.findMany({
    where: {
      status: RawItemStatus.NEW,
      ...(options.collectRunId ? { collectRunId: options.collectRunId } : {})
    } as any,
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
    logger.info("没有待分析的新线索，跳过 AI 分析");
    if (options.collectRunId) {
      await logger.runInfo({
        runId: options.collectRunId,
        phase: "ai",
        eventType: "ai_skipped_empty",
        message: "没有待分析的新线索，跳过 AI 分析"
      });
    }
    return {
      analyzedCount: 0,
      topicCount: 0,
      message: "No new raw items to analyze"
    };
  }

  if (options.collectRunId) {
    await logger.runSection(options.collectRunId, "AI 分析开始", { limit, rawItemCount: rawItems.length });
    await logger.runInfo({
      runId: options.collectRunId,
      phase: "ai",
      eventType: "ai_input",
      message: `AI 分析输入 ${rawItems.length} 条线索`,
      details: {
        rawItems: rawItems.map((item) => ({
          id: item.id,
          sourceType: item.sourceType,
          credibilityLevel: item.credibilityLevel,
          sourceName: item.source.name,
          title: item.title,
          url: item.url,
          metadata: parseJson(item.metadataJson)
        }))
      }
    });
  } else {
    logger.section("AI 分析开始");
    logger.info(`待分析线索 ${rawItems.length} 条（最多取 ${limit} 条）`);
  }

  for (const item of rawItems) {
    logger.debug(
      `  [${item.sourceType}/${item.credibilityLevel}] ${item.source.name} ─ ${item.title?.slice(0, 60) || item.url}`
    );
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

  logger.info("调用 OpenRouter 分析中…");
  const openRouterResult = await analyzeWithOpenRouter(messages);
  logger.info(
    `OpenRouter 返回 model=${openRouterResult.model} | promptTokens=${openRouterResult.promptTokens} | completionTokens=${openRouterResult.completionTokens} | 分析结果 ${openRouterResult.result.analyses.length} 条`
  );
  if (options.collectRunId) {
    await logger.runInfo({
      runId: options.collectRunId,
      phase: "ai",
      eventType: "ai_response",
      message: `OpenRouter 返回 ${openRouterResult.result.analyses.length} 条分析`,
      details: {
        model: openRouterResult.model,
        promptTokens: openRouterResult.promptTokens,
        completionTokens: openRouterResult.completionTokens,
        analysisCount: openRouterResult.result.analyses.length
      }
    });
  }

  const rawItemById = new Map(rawItems.map((item) => [item.id, item]));
  const validSourceIds = new Set(rawItemById.keys());
  let topicCount = 0;
  let ignoredCount = 0;
  let skippedNoSourceCount = 0;

  for (const analysis of openRouterResult.result.analyses) {
    const sourceIds = analysis.source_ids.filter((sourceId) => validSourceIds.has(sourceId));

    if (sourceIds.length === 0) {
      logger.warn(`AI 返回的 source_ids 在本批次中均无效，跳过：${JSON.stringify(analysis.source_ids)}`);
      if (options.collectRunId) {
        await logger.runWarn({
          runId: options.collectRunId,
          phase: "ai",
          eventType: "ai_invalid_sources",
          message: `AI 返回的 source_ids 在本批次中均无效，跳过：${analysis.topic || "无标题"}`,
          details: { sourceIds: analysis.source_ids, analysis }
        });
      }
      skippedNoSourceCount += 1;
      continue;
    }

    await prisma.aiAnalysis.create({
      data: {
        collectRunId: options.collectRunId,
        model: openRouterResult.model,
        task: "raw_item_hot_analysis",
        inputJson: JSON.stringify({ sourceIds, rawItems: summarizeRawItems(sourceIds, rawItemById) }),
        outputJson: JSON.stringify(analysis),
        promptTokens: openRouterResult.promptTokens,
        completionTokens: openRouterResult.completionTokens
      } as any
    });

    if (!analysis.is_ai_related) {
      logger.info(`非 AI 相关，标记忽略（${sourceIds.length} 条线索）：${analysis.topic || "无标题"}`);
      if (options.collectRunId) {
        await logger.runInfo({
          runId: options.collectRunId,
          phase: "ai",
          eventType: "ai_ignored",
          message: `AI 未采用为热点：${analysis.topic || "无标题"}`,
          details: { sourceIds, analysis }
        });
      }
      await prisma.rawItem.updateMany({
        where: { id: { in: sourceIds } },
        data: { status: RawItemStatus.IGNORED }
      });
      ignoredCount += 1;
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
    const topicStatus = inferTopicStatus(analysis, {
      isSocialOnly,
      sourceCount: sourceIds.length,
      needsVerification
    });

    logger.info(
      `创建热点「${analysis.topic?.slice(0, 50)}」category=${analysis.category} hotScore=${hotScore} confidence=${confidence} status=${topicStatus} sources=${sourceIds.length}`
    );
    if (options.collectRunId) {
      await logger.runInfo({
        runId: options.collectRunId,
        phase: "ai",
        eventType: "hot_topic_prepare",
        message: `准备创建热点「${analysis.topic?.slice(0, 50)}」`,
        details: {
          sourceIds,
          sourceSummary: summarizeRawItems(sourceIds, rawItemById),
          category: analysis.category,
          hotScore,
          confidence,
          status: topicStatus,
          needsVerification
        }
      });
    }

    const topic = await prisma.hotTopic.create({
      data: {
        collectRunId: options.collectRunId,
        title: cleanText(analysis.topic) || linkedRawItems[0]?.titleZh || linkedRawItems[0]?.title || "未命名 AI 热点",
        summary: analysis.summary,
        whyItMatters:
          cleanText(analysis.why_it_matters) ||
          "该热点来自已采集的真实来源，需要继续核验影响范围。",
        category: analysis.category,
        hotScore,
        confidence,
        status: topicStatus,
        needsVerification,
        sources: {
          create: sourceIds.map((rawItemId) => ({
            rawItemId
          }))
        },
        aiAnalyses: {
          create: {
            collectRunId: options.collectRunId,
            model: openRouterResult.model,
            task: "hot_topic_creation",
            inputJson: JSON.stringify({ sourceIds, rawItems: summarizeRawItems(sourceIds, rawItemById) }),
            outputJson: JSON.stringify(analysis),
            promptTokens: openRouterResult.promptTokens,
            completionTokens: openRouterResult.completionTokens
          }
        }
      } as any
    });

    await prisma.rawItem.updateMany({
      where: { id: { in: sourceIds } },
      data: { status: RawItemStatus.ANALYZED }
    });

    if (topic.id) {
      if (options.collectRunId) {
        await logger.runInfo({
          runId: options.collectRunId,
          phase: "ai",
          eventType: "hot_topic_created",
          message: `创建热点成功：${topic.title}`,
          details: {
            topicId: topic.id,
            title: topic.title,
            hotScore: topic.hotScore,
            confidence: topic.confidence,
            status: topic.status,
            sourceIds
          }
        });
      }
      topicCount += 1;
    }
  }

  if (options.collectRunId) {
    await logger.runSection(options.collectRunId, "AI 分析完成");
    await logger.runInfo({
      runId: options.collectRunId,
      phase: "ai",
      eventType: "ai_complete",
      message: `结果汇总：分析线索 ${rawItems.length} 条 | 创建热点 ${topicCount} 个 | 忽略非AI ${ignoredCount} 条 | source_ids无效跳过 ${skippedNoSourceCount} 条`,
      details: { analyzedCount: rawItems.length, topicCount, ignoredCount, skippedNoSourceCount }
    });
  } else {
    logger.section("AI 分析完成");
    logger.info(
      `结果汇总：分析线索 ${rawItems.length} 条 | 创建热点 ${topicCount} 个 | 忽略非AI ${ignoredCount} 条 | source_ids无效跳过 ${skippedNoSourceCount} 条`
    );
  }

  return {
    analyzedCount: rawItems.length,
    topicCount,
    model: openRouterResult.model
  };
}

function summarizeRawItems<T extends RawItemForLineage>(sourceIds: string[], rawItemById: Map<string, T>) {
  return sourceIds
    .map((sourceId) => rawItemById.get(sourceId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      credibilityLevel: item.credibilityLevel,
      title: item.title,
      url: item.url,
      metadata: parseJson(item.metadataJson)
    }));
}

function parseJson(value: string | null) {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
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
