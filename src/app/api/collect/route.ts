import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { runCollectors } from "@/lib/collectors/run-collectors";
import { analyzeRawItems } from "@/lib/ai/analyze-raw-items";

export const dynamic = "force-dynamic";

const collectRequestSchema = z.object({
  collectors: z.array(z.enum(["official", "search", "twitterapi-io"])).optional(),
  limit: z.number().int().min(1).max(30).optional(),
  query: z.string().min(2).max(240).optional(),
  keywordOnly: z.boolean().optional(),
  background: z.boolean().optional(),
  autoAnalyze: z.boolean().optional()
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const [latestRuns, rawItemCount, sourceCount] = await Promise.all([
    prisma.collectRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 8
    }),
    prisma.rawItem.count(),
    prisma.source.count()
  ]);
  const requestedRunId = searchParams.get("runId");
  const activeRunId = requestedRunId || latestRuns[0]?.id;
  const runDetails = activeRunId ? await buildRunDetails(activeRunId).catch(() => null) : null;

  return NextResponse.json({
    rawItemCount,
    sourceCount,
    latestRuns,
    runDetails
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = collectRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid collect request",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.background) {
      void runCollectors(parsed.data).then(async (result) => {
        if (parsed.data.autoAnalyze && process.env.OPENROUTER_API_KEY) {
          await analyzeRawItems(8, { collectRunId: result.runId });
        }
      }).catch((error) => {
        console.error("Background collect failed", error);
      });

      return NextResponse.json({
        status: "STARTED",
        message: "Collect job started in background"
      });
    }

    const result = await runCollectors(parsed.data);
    if (parsed.data.autoAnalyze && process.env.OPENROUTER_API_KEY) {
      const analysis = await analyzeRawItems(8, { collectRunId: result.runId });
      return NextResponse.json({ ...result, analysis });
    }

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

type RunRawItemSummary = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  credibilityLevel: string;
  status: string;
  fetchedAt: Date;
  query?: string;
  provider?: string;
  keyword?: string;
  snippetOnly: boolean;
  extractionError?: string;
  linkedTopics: unknown[];
};

async function buildRunDetails(runId: string) {
  const [run, events, rawItems, aiAnalyses, hotTopics] = await Promise.all([
    prisma.collectRun.findUnique({
      where: { id: runId }
    }),
    (prisma as any).collectRunEvent.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
      take: 120
    }),
    (prisma.rawItem as any).findMany({
      where: { collectRunId: runId },
      orderBy: { fetchedAt: "desc" },
      take: 80,
      include: {
        source: {
          select: {
            name: true,
            type: true,
            credibilityLevel: true
          }
        },
        topicLinks: {
          include: {
            topic: {
              select: {
                id: true,
                title: true,
                hotScore: true,
                confidence: true,
                status: true,
                needsVerification: true
              }
            }
          }
        }
      }
    }),
    (prisma.aiAnalysis as any).findMany({
      where: { collectRunId: runId },
      orderBy: { createdAt: "asc" },
      take: 50
    }),
    (prisma.hotTopic as any).findMany({
      where: { collectRunId: runId },
      orderBy: [{ hotScore: "desc" }, { createdAt: "desc" }],
      take: 30,
      include: {
        sources: {
          include: {
            rawItem: {
              select: {
                id: true,
                title: true,
                url: true,
                sourceType: true,
                credibilityLevel: true
              }
            }
          }
        }
      }
    })
  ]);

  if (!run) {
    return null;
  }

  const rawItemSummaries: RunRawItemSummary[] = rawItems.map((item: any) => {
    const metadata = parseJson(item.metadataJson);
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      sourceName: item.source.name,
      sourceType: item.sourceType,
      credibilityLevel: item.credibilityLevel,
      status: item.status,
      fetchedAt: item.fetchedAt,
      query: stringFromMetadata(metadata, "query"),
      provider: stringFromMetadata(metadata, "provider"),
      keyword: stringFromMetadata(metadata, "keyword"),
      snippetOnly: Boolean(valueFromMetadata(metadata, "snippetOnly")),
      extractionError: stringFromMetadata(metadata, "extractionError"),
      linkedTopics: item.topicLinks.map((link: any) => link.topic)
    };
  });

  const providerCounts = countBy(rawItemSummaries, (item) => item.provider || "unknown");
  const credibilityCounts = countBy(rawItemSummaries, (item) => item.credibilityLevel);
  const adoptedRawItemIds = new Set(hotTopics.flatMap((topic: any) => topic.sources.map((source: any) => source.rawItem.id)));

  return {
    run,
    events: events.map((event: any) => ({
      ...event,
      details: parseJson(event.detailsJson)
    })),
    evidenceSummary: {
      rawItemCount: rawItemSummaries.length,
      adoptedCount: adoptedRawItemIds.size,
      snippetOnlyCount: rawItemSummaries.filter((item) => item.snippetOnly).length,
      providerCounts,
      credibilityCounts
    },
    rawItems: rawItemSummaries.map((item) => ({
      ...item,
      adoptedByAi: adoptedRawItemIds.has(item.id)
    })),
    aiAnalyses: aiAnalyses.map((analysis: any) => ({
      id: analysis.id,
      task: analysis.task,
      model: analysis.model,
      topicId: analysis.topicId,
      input: parseJson(analysis.inputJson),
      output: parseJson(analysis.outputJson),
      promptTokens: analysis.promptTokens,
      completionTokens: analysis.completionTokens,
      createdAt: analysis.createdAt
    })),
    hotTopics: hotTopics.map((topic: any) => ({
      id: topic.id,
      title: topic.title,
      hotScore: topic.hotScore,
      confidence: topic.confidence,
      status: topic.status,
      needsVerification: topic.needsVerification,
      sources: topic.sources.map((source: any) => source.rawItem)
    }))
  };
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

function valueFromMetadata(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  return (metadata as Record<string, unknown>)[key];
}

function stringFromMetadata(metadata: unknown, key: string) {
  const value = valueFromMetadata(metadata, key);
  return typeof value === "string" ? value : undefined;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
