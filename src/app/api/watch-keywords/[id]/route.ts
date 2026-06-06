import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const updateKeywordSchema = z.object({
  enabled: z.boolean()
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  const parsed = updateKeywordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid keyword update",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const saved = await prisma.watchKeyword.update({
    where: { id },
    data: {
      enabled: parsed.data.enabled
    }
  });

  return NextResponse.json({ keyword: saved });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await prisma.watchKeyword.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
