import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { analyzeRawItems } from "@/lib/ai/analyze-raw-items";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const analyzeRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).optional()
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const topicWhere = buildTopicNewsDateWhere(searchParams);
  const [topics, pendingRawItems] = await Promise.all([
    prisma.hotTopic.findMany({
      where: topicWhere,
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
    }),
    prisma.rawItem.count({
      where: {
        status: "NEW"
      }
    })
  ]);

  return NextResponse.json({
    analysisConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
    pendingRawItems,
    topics: topics.map((topic) => ({
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
        publishedAt: source.rawItem.publishedAt,
        fetchedAt: source.rawItem.fetchedAt
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

function buildRawItemNewsDateWhere(searchParams: URLSearchParams): Prisma.RawItemWhereInput | undefined {
  const start = parseDateParam(searchParams.get("startDate"), "start");
  const end = parseDateParam(searchParams.get("endDate"), "end");

  if (!start && !end) {
    return undefined;
  }

  const range: Prisma.DateTimeFilter = {};
  if (start) {
    range.gte = start;
  }
  if (end) {
    range.lte = end;
  }

  return {
    OR: [
      {
        publishedAt: range
      },
      {
        publishedAt: null,
        fetchedAt: range
      }
    ]
  };
}

function parseDateParam(value: string | null, boundary: "start" | "end") {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (boundary === "start") {
    date.setHours(0, 0, 0, 0);
  } else {
    date.setHours(23, 59, 59, 999);
  }

  return date;
}
