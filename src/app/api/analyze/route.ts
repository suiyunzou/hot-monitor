import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { analyzeRawItems } from "@/lib/ai/analyze-raw-items";
import { buildRawItemNewsDateWhere } from "@/lib/stats/raw-item-date-range";
import { getSourceCoverage } from "@/lib/stats/source-coverage";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const analyzeRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).optional()
});

const statusFilterValues = ["all", "confirmed", "multi-source", "social", "verify"] as const;
const sourceFilterValues = ["all", "official", "search", "social"] as const;
const sortValues = ["time", "score", "views", "replies"] as const;

type StatusFilter = (typeof statusFilterValues)[number];
type SourceFilter = (typeof sourceFilterValues)[number];
type TopicSort = (typeof sortValues)[number];
type FilterIssue = {
  field: string;
  value: string;
  reason: string;
};
type TopicWithSources = Prisma.HotTopicGetPayload<{
  include: {
    sources: {
      include: {
        rawItem: {
          select: {
            id: true;
            title: true;
            url: true;
            sourceType: true;
            credibilityLevel: true;
            author: true;
            excerpt: true;
            publishedAt: true;
            fetchedAt: true;
            viewCount: true;
            likeCount: true;
            retweetCount: true;
            replyCount: true;
            source: {
              select: {
                name: true;
              };
            };
          };
        };
      };
    };
  };
}>;

const DEFAULT_TOPIC_LIMIT = 30;
const MAX_TOPIC_LIMIT = 100;
const METRIC_SORT_CANDIDATE_LIMIT = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filterIssues: FilterIssue[] = [];
  const searchTerm = (searchParams.get("q") ?? "").trim();
  const statusFilter = parseStatusFilter(searchParams.get("status"), filterIssues);
  const sourceFilter = parseSourceFilter(searchParams.get("source"), filterIssues);
  const sortKey = parseSortKey(searchParams.get("sort"), filterIssues);
  const minScore = parseIntegerFilter(searchParams.get("minScore"), "minScore", 0, 100, filterIssues);
  const minConfidence = parseIntegerFilter(searchParams.get("minConfidence"), "minConfidence", 0, 100, filterIssues);
  const topicWhere = buildTopicWhere(searchParams, searchTerm, statusFilter, sourceFilter, minScore, minConfidence);
  const topicLimit = parseLimit(searchParams.get("limit"), filterIssues);
  const sortNeedsSourceMetrics = sortKey === "views" || sortKey === "replies";
  const queryLimit = sortNeedsSourceMetrics ? Math.max(topicLimit, METRIC_SORT_CANDIDATE_LIMIT) : topicLimit;
  const [topics, totalTopics, pendingRawItems, sourceCoverage] = await Promise.all([
    prisma.hotTopic.findMany({
      where: topicWhere,
      orderBy: buildTopicOrderBy(sortKey),
      take: queryLimit,
      include: {
        sources: {
          include: {
            rawItem: {
              select: {
                id: true,
                title: true,
                url: true,
                sourceType: true,
                credibilityLevel: true,
                author: true,
                excerpt: true,
                publishedAt: true,
                fetchedAt: true,
                viewCount: true,
                likeCount: true,
                retweetCount: true,
                replyCount: true,
                source: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        }
      }
    }),
    prisma.hotTopic.count({
      where: topicWhere
    }),
    prisma.rawItem.count({
      where: {
        status: "NEW"
      }
    }),
    getSourceCoverage(searchParams)
  ]);

  const limitedTopics = sortNeedsSourceMetrics ? sortTopics(topics, sortKey).slice(0, topicLimit) : topics;

  return NextResponse.json({
    analysisConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
    pendingRawItems,
    sourceCoverage,
    totalTopics,
    filters: {
      q: searchTerm,
      status: statusFilter,
      source: sourceFilter,
      sort: sortKey,
      minScore,
      minConfidence,
      dateRangeApplied: searchParams.has("startDate") || searchParams.has("endDate"),
      active: Boolean(
        searchTerm ||
          statusFilter !== "all" ||
          sourceFilter !== "all" ||
          minScore !== undefined ||
          minConfidence !== undefined ||
          searchParams.has("limit") ||
          searchParams.has("startDate") ||
          searchParams.has("endDate")
      ),
      issues: filterIssues,
      resultLimit: topicLimit,
      returnedTopics: limitedTopics.length,
      optimized: {
        databaseCount: true,
        databaseLimit: true,
        databaseSort: !sortNeedsSourceMetrics,
        candidateLimit: queryLimit
      }
    },
    topics: limitedTopics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      whyItMatters: topic.whyItMatters,
      category: topic.category,
      hotScore: topic.hotScore,
      confidence: topic.confidence,
      status: topic.status,
      needsVerification: topic.needsVerification,
      sources: topic.sources.map((source) => ({
        title: source.rawItem.title,
        url: source.rawItem.url,
        sourceType: source.rawItem.sourceType,
        sourceName: source.rawItem.source.name,
        credibilityLevel: source.rawItem.credibilityLevel,
        author: source.rawItem.author,
        excerpt: source.rawItem.excerpt,
        publishedAt: source.rawItem.publishedAt,
        fetchedAt: source.rawItem.fetchedAt,
        viewCount: source.rawItem.viewCount,
        likeCount: source.rawItem.likeCount,
        retweetCount: source.rawItem.retweetCount,
        replyCount: source.rawItem.replyCount
      }))
    }))
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = analyzeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid analyze request",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        {
          error: "OPENROUTER_API_KEY is not configured",
          code: "OPENROUTER_NOT_CONFIGURED"
        },
        { status: 409 }
      );
    }

    const result = await analyzeRawItems(parsed.data.limit ?? 5);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "AI 输出结构不完整，请重试或降低分析数量",
          issues: error.flatten()
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

function buildTopicWhere(
  searchParams: URLSearchParams,
  searchTerm: string,
  statusFilter: StatusFilter,
  sourceFilter: SourceFilter,
  minScore?: number,
  minConfidence?: number
): Prisma.HotTopicWhereInput | undefined {
  const conditions: Prisma.HotTopicWhereInput[] = [];
  const dateWhere = buildTopicNewsDateWhere(searchParams);
  if (searchTerm) {
    conditions.push(buildTopicSearchWhere(searchTerm));
  }
  if (dateWhere) {
    conditions.push(dateWhere);
  }
  const statusWhere = buildTopicStatusWhere(statusFilter);
  if (statusWhere) {
    conditions.push(statusWhere);
  }
  const sourceWhere = buildTopicSourceWhere(sourceFilter);
  if (sourceWhere) {
    conditions.push(sourceWhere);
  }
  if (minScore !== undefined) {
    conditions.push({ hotScore: { gte: minScore } });
  }
  if (minConfidence !== undefined) {
    conditions.push({ confidence: { gte: minConfidence } });
  }

  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { AND: conditions };
}

function buildTopicSearchWhere(term: string): Prisma.HotTopicWhereInput {
  return {
    OR: [
      { title: { contains: term } },
      { summary: { contains: term } },
      { whyItMatters: { contains: term } },
      { category: { contains: term } },
      {
        sources: {
          some: {
            rawItem: {
              OR: [
                { title: { contains: term } },
                { author: { contains: term } },
                { source: { name: { contains: term } } }
              ]
            }
          }
        }
      }
    ]
  };
}

function buildTopicStatusWhere(statusFilter: StatusFilter): Prisma.HotTopicWhereInput | undefined {
  if (statusFilter === "all") {
    return undefined;
  }
  if (statusFilter === "confirmed") {
    return {
      status: "CONFIRMED",
      needsVerification: false
    };
  }
  if (statusFilter === "multi-source") {
    return {
      status: "MULTI_SOURCE_SIGNAL",
      needsVerification: false
    };
  }
  if (statusFilter === "social") {
    return {
      status: "SOCIAL_BUZZ"
    };
  }
  return {
    OR: [{ status: "NEEDS_VERIFICATION" }, { needsVerification: true }]
  };
}

function buildTopicSourceWhere(sourceFilter: SourceFilter): Prisma.HotTopicWhereInput | undefined {
  if (sourceFilter === "all") {
    return undefined;
  }
  const sourceType = sourceFilter === "social" ? "TWITTER" : sourceFilter.toUpperCase();
  return {
    sources: {
      some: {
        rawItem: {
          sourceType: sourceType as "OFFICIAL" | "SEARCH" | "TWITTER"
        }
      }
    }
  };
}

function sortTopics<T extends TopicWithSources>(topics: T[], sortKey: TopicSort): T[] {
  return [...topics].sort((a, b) => {
    if (sortKey === "views") {
      return sumSourceMetric(b, "viewCount") - sumSourceMetric(a, "viewCount") || compareTopicTime(a, b);
    }
    if (sortKey === "replies") {
      return sumSourceMetric(b, "replyCount") - sumSourceMetric(a, "replyCount") || compareTopicTime(a, b);
    }
    return compareTopicTime(a, b) || b.hotScore - a.hotScore;
  });
}

function buildTopicOrderBy(sortKey: TopicSort): Prisma.HotTopicOrderByWithRelationInput[] {
  if (sortKey === "score") {
    return [{ hotScore: "desc" }, { lastSeenAt: "desc" }];
  }
  return [{ lastSeenAt: "desc" }, { hotScore: "desc" }];
}

function sumSourceMetric(topic: TopicWithSources, key: "viewCount" | "replyCount") {
  return topic.sources.reduce((total, source) => total + (source.rawItem[key] ?? 0), 0);
}

function compareTopicTime(a: TopicWithSources, b: TopicWithSources) {
  return getTopicTime(b) - getTopicTime(a);
}

function getTopicTime(topic: TopicWithSources) {
  const sourceTime = topic.sources.reduce((latest, source) => {
    const value = source.rawItem.publishedAt ?? source.rawItem.fetchedAt;
    const time = value.getTime();
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0);
  return sourceTime || topic.lastSeenAt.getTime();
}

function buildTopicNewsDateWhere(searchParams: URLSearchParams): Prisma.HotTopicWhereInput | undefined {
  const rawDateWhere = buildRawItemNewsDateWhere(searchParams);

  if (!rawDateWhere) {
    return undefined;
  }

  return {
    sources: {
      some: {
        rawItem: rawDateWhere
      }
    }
  };
}

function parseStatusFilter(value: string | null, issues: FilterIssue[]): StatusFilter {
  if (!value) {
    return "all";
  }
  if (statusFilterValues.includes(value as StatusFilter)) {
    return value as StatusFilter;
  }
  issues.push({
    field: "status",
    value,
    reason: "Unsupported status filter; fell back to all."
  });
  return "all";
}

function parseSourceFilter(value: string | null, issues: FilterIssue[]): SourceFilter {
  if (!value) {
    return "all";
  }
  if (sourceFilterValues.includes(value as SourceFilter)) {
    return value as SourceFilter;
  }
  issues.push({
    field: "source",
    value,
    reason: "Unsupported source filter; fell back to all."
  });
  return "all";
}

function parseSortKey(value: string | null, issues: FilterIssue[]): TopicSort {
  if (!value) {
    return "time";
  }
  if (sortValues.includes(value as TopicSort)) {
    return value as TopicSort;
  }
  issues.push({
    field: "sort",
    value,
    reason: "Unsupported sort key; fell back to time."
  });
  return "time";
}

function parseLimit(value: string | null, issues: FilterIssue[]) {
  if (!value) {
    return DEFAULT_TOPIC_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_TOPIC_LIMIT) {
    return parsed;
  }
  issues.push({
    field: "limit",
    value,
    reason: `Limit must be between 1 and ${MAX_TOPIC_LIMIT}; fell back to ${DEFAULT_TOPIC_LIMIT}.`
  });
  return DEFAULT_TOPIC_LIMIT;
}

function parseIntegerFilter(
  value: string | null,
  field: string,
  min: number,
  max: number,
  issues: FilterIssue[]
) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= min && parsed <= max) {
    return parsed;
  }
  issues.push({
    field,
    value,
    reason: `${field} must be between ${min} and ${max}; ignored.`
  });
  return undefined;
}
