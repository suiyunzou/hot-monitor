import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ensureDefaultKolAccounts } from "@/lib/collectors/run-collectors";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  handle: z.string().min(1).max(40),
  displayName: z.string().max(80).optional(),
  tier: z.union([z.literal(1), z.literal(2)]).optional()
});

function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "");
}

export async function GET() {
  await ensureDefaultKolAccounts();
  const accounts = await prisma.kolAccount.findMany({
    orderBy: [{ tier: "asc" }, { enabled: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({
    accounts: accounts.map((account) => ({
      id: account.id,
      handle: account.handle,
      displayName: account.displayName,
      tier: account.tier,
      enabled: account.enabled
    }))
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid KOL account", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const handle = normalizeHandle(parsed.data.handle);
  if (!handle) {
    return NextResponse.json({ error: "handle 不能为空" }, { status: 400 });
  }

  try {
    const account = await prisma.kolAccount.create({
      data: {
        handle,
        displayName: parsed.data.displayName?.trim() || null,
        tier: parsed.data.tier ?? 2,
        enabled: true
      }
    });
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "该账号已在白名单中", code: "DUPLICATE" }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
