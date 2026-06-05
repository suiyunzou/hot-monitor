import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  tier: z.union([z.literal(1), z.literal(2)]).optional(),
  displayName: z.string().max(80).optional()
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid KOL update", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const account = await prisma.kolAccount.update({
    where: { id },
    data: {
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.tier !== undefined ? { tier: parsed.data.tier } : {}),
      ...(parsed.data.displayName !== undefined
        ? { displayName: parsed.data.displayName.trim() || null }
        : {})
    }
  });

  return NextResponse.json({ account });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await prisma.kolAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
