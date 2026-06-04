import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createKeywordSchema = z.object({
  keyword: z.string().min(2).max(80)
});

export async function GET() {
  const keywords = await prisma.watchKeyword.findMany({
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({ keywords });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createKeywordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid keyword",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const keyword = parsed.data.keyword.trim();

  const saved = await prisma.watchKeyword.upsert({
    where: { keyword },
    update: {
      enabled: true
    },
    create: {
      keyword,
      enabled: true
    }
  });

  return NextResponse.json({ keyword: saved });
}
