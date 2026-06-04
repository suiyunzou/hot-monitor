import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { analyzeRawItems } from "@/lib/ai/analyze-raw-items";

export const dynamic = "force-dynamic";

const analyzeRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).optional()
});

export async function GET() {
  const [topics, pendingRawItems] = await Promise.all([
    prisma.hotTopic.findMany({
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
    }),
    prisma.rawItem.count({
      where: {
        status: "NEW"
      }
    })
  ]);

  return NextResponse.json({
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
        credibilityLevel: source.rawItem.credibilityLevel
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
    const result = await analyzeRawItems(parsed.data.limit ?? 5);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
