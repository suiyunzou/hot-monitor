import type { Prisma } from "@/generated/prisma/client";

/** Match analyze route: publishedAt in range, or missing publish date with fetchedAt in range. */
export function buildRawItemNewsDateWhere(searchParams: URLSearchParams): Prisma.RawItemWhereInput | undefined {
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

export function parseDateParam(value: string | null, boundary: "start" | "end") {
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
