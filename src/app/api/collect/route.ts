import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { runCollectors } from "@/lib/collectors/run-collectors";

export const dynamic = "force-dynamic";

const collectRequestSchema = z.object({
  collectors: z.array(z.enum(["official", "search", "twitterapi-io"])).optional(),
  limit: z.number().int().min(1).max(30).optional(),
  query: z.string().min(2).max(240).optional(),
  keywordOnly: z.boolean().optional()
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
    const result = await runCollectors(parsed.data);
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
