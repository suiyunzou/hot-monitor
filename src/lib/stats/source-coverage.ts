import { prisma } from "@/lib/db/prisma";
import { buildRawItemNewsDateWhere } from "@/lib/stats/raw-item-date-range";
import type { CredibilityLevel, Prisma, SourceType } from "@/generated/prisma/client";

export type SourceCoverage = {
  official: number;
  search: number;
  social: number;
  total: number;
};

type RawItemBucketFields = {
  sourceType: SourceType;
  credibilityLevel: CredibilityLevel;
};

export async function getSourceCoverage(searchParams: URLSearchParams): Promise<SourceCoverage> {
  const where = buildRawItemNewsDateWhere(searchParams) ?? buildDefaultRawItemDateWhere();
  const items = await prisma.rawItem.findMany({
    where,
    select: {
      sourceType: true,
      credibilityLevel: true
    }
  });

  const total = items.length;
  if (total === 0) {
    return { official: 0, search: 0, social: 0, total: 0 };
  }

  let official = 0;
  let search = 0;
  let social = 0;

  for (const item of items) {
    if (isOfficialBucket(item)) {
      official += 1;
    }
    if (isSearchBucket(item)) {
      search += 1;
    }
    if (isSocialBucket(item)) {
      social += 1;
    }
  }

  return {
    official: toPercent(official, total),
    search: toPercent(search, total),
    social: toPercent(social, total),
    total
  };
}

function isOfficialBucket(item: RawItemBucketFields) {
  return (
    item.sourceType === "OFFICIAL" ||
    item.credibilityLevel === "OFFICIAL" ||
    item.credibilityLevel === "PRIMARY"
  );
}

function isSearchBucket(item: RawItemBucketFields) {
  return (
    item.sourceType === "SEARCH" ||
    item.credibilityLevel === "SEARCH_SNIPPET" ||
    item.credibilityLevel === "MEDIA"
  );
}

function isSocialBucket(item: RawItemBucketFields) {
  return (
    item.sourceType === "TWITTER" ||
    item.credibilityLevel === "SOCIAL" ||
    item.credibilityLevel === "SOCIAL_VERIFIED"
  );
}

function toPercent(count: number, total: number) {
  return Math.round((count / total) * 100);
}

function buildDefaultRawItemDateWhere(): Prisma.RawItemWhereInput {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const range: Prisma.DateTimeFilter = {
    gte: start,
    lte: end
  };

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
