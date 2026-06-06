import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { analyzeRawItems } from "@/lib/ai/analyze-raw-items";
import { buildRawItemNewsDateWhere } from "@/lib/stats/raw-item-date-range";
import { getSourceCoverage } from "@/lib/stats/source-coverage";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const analyzeRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).optional()
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const searchTerm = (searchParams.get("q") ?? "").trim();
  const topicWhere = buildTopicWhere(searchParams, searchTerm);
  const [topics, pendingRawItems, sourceCoverage] = await Promise.all([
    prisma.hotTopic.findMany({
      where: topicWhere,
      orderBy: [{ hotScore: "desc" }, { lastSeenAt: "desc" }],
      take: searchTerm ? 60 : 24,
      include: {
        sources: {
          include: {
            rawItem: {
              select: {
                id: true,
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
    }),
    prisma.rawItem.count({
      where: {
        status: "NEW"
      }
    }),
    getSourceCoverage(searchParams)
  ]);

  const dedupedTopics = dedupeTopics(topics).slice(0, searchTerm ? 50 : 12);

  return NextResponse.json({
    analysisConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
    pendingRawItems,
    sourceCoverage,
    topics: dedupedTopics.map((topic) => ({
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
        publishedAt: source.rawItem.publishedAt,
        fetchedAt: source.rawItem.fetchedAt,
        viewCount: source.rawItem.viewCount,
        likeCount: source.rawItem.likeCount,
        retweetCount: source.rawItem.retweetCount,
        replyCount: source.rawItem.replyCount
      }))
    }))
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = analyzeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid analyze request",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        {
          error: "OPENROUTER_API_KEY is not configured",
          code: "OPENROUTER_NOT_CONFIGURED"
        },
        { status: 409 }
      );
    }

    const result = await analyzeRawItems(parsed.data.limit ?? 5);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "AI 输出结构不完整，请重试或降低分析数量",
          issues: error.flatten()
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/** When a keyword is present, search across all topics (ignoring the date window) so
 * older posts and X sources can still be found; otherwise constrain by the date range. */
function buildTopicWhere(
  searchParams: URLSearchParams,
  searchTerm: string
): Prisma.HotTopicWhereInput | undefined {
  if (searchTerm) {
    return buildTopicSearchWhere(searchTerm);
  }
  return buildTopicNewsDateWhere(searchParams);
}

function buildTopicSearchWhere(term: string): Prisma.HotTopicWhereInput {
  return {
    OR: [
      { title: { contains: term } },
      { summary: { contains: term } },
      { whyItMatters: { contains: term } },
      { category: { contains: term } },
      {
        sources: {
          some: {
            rawItem: {
              OR: [
                { title: { contains: term } },
                { author: { contains: term } },
                { source: { name: { contains: term } } }
              ]
            }
          }
        }
      }
    ]
  };
}

/** Collapse duplicate topics (same title or shared rawItem) — keep first/highest-scored. */
function dedupeTopics<
  T extends { title: string; hotScore: number; sources: Array<{ rawItem: { id: string } }> }
>(topics: T[]): T[] {
  const result: T[] = [];
  const seenTitles = new Set<string>();
  const seenRawItemIds = new Set<string>();

  for (const topic of topics) {
    const titleKey = topic.title.replace(/\s+/g, "").toLowerCase();
    const rawItemIds = topic.sources.map((source) => source.rawItem.id);

    if (seenTitles.has(titleKey)) {
      continue;
    }
    if (rawItemIds.some((rawItemId) => seenRawItemIds.has(rawItemId))) {
      continue;
    }

    seenTitles.add(titleKey);
    rawItemIds.forEach((rawItemId) => seenRawItemIds.add(rawItemId));
    result.push(topic);
  }

  return result;
}

function buildTopicNewsDateWhere(searchParams: URLSearchParams): Prisma.HotTopicWhereInput | undefined {
  const rawDateWhere = buildRawItemNewsDateWhere(searchParams);

  if (!rawDateWhere) {
    return undefined;
  }

  return {
    sources: {
      some: {
        rawItem: rawDateWhere
      }
    }
  };
}

