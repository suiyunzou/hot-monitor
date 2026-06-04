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

export async function GET() {
  const [latestRuns, rawItemCount, sourceCount] = await Promise.all([
    prisma.collectRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 8
    }),
    prisma.rawItem.count(),
    prisma.source.count()
  ]);

  return NextResponse.json({
    rawItemCount,
    sourceCount,
    latestRuns
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
      void runCollectors(parsed.data).then(async () => {
        if (parsed.data.autoAnalyze && process.env.OPENROUTER_API_KEY) {
          await analyzeRawItems(8);
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
      const analysis = await analyzeRawItems(8);
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
