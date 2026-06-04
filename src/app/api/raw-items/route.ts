import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateWhere = buildNewsDateWhere(searchParams);
  const items = await prisma.rawItem.findMany({
    where: dateWhere,
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
      watchKeyword: {
        select: {
          keyword: true
        }
      }
    }
  });

  const relevantItems = items.slice(0, 40);

  return NextResponse.json({
    items: relevantItems.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
      sourceName: item.source.name,
      sourceType: item.source.type,
      credibilityLevel: item.credibilityLevel,
      watchKeyword: item.watchKeyword?.keyword ?? null,
      fetchedAt: item.fetchedAt,
      publishedAt: item.publishedAt,
      content: item.content
    }))
  });
}

function buildNewsDateWhere(searchParams: URLSearchParams): Prisma.RawItemWhereInput | undefined {
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
