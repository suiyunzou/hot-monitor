import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await prisma.rawItem.findMany({
    orderBy: { fetchedAt: "desc" },
    take: 40,
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

  const filteredItems = items.filter((item) => isRelevantToWatchKeyword(item.watchKeyword?.keyword, {
      title: item.title,
      url: item.url,
      excerpt: item.excerpt
    }));
  const keywordItems = filteredItems.filter((item) => item.watchKeyword);
  const generalItems = filteredItems.filter(
    (item) => !item.watchKeyword && item.sourceType !== "SEARCH" && isGeneralAiSignal({
      title: item.title,
      url: item.url,
      excerpt: item.excerpt
    })
  );
  const relevantItems = [...keywordItems, ...generalItems].slice(0, 12);

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
      publishedAt: item.publishedAt
    }))
  });
}

function isGeneralAiSignal(item: {
  title: string;
  url: string;
  excerpt: string | null;
}) {
  const haystack = `${item.title} ${item.url} ${item.excerpt ?? ""}`.toLowerCase();
  return [
    "artificial intelligence",
    "openai",
    "anthropic",
    "claude",
    "deepseek",
    "grok",
    "gemini",
    "llm",
    "agentic",
    "ai agent",
    "ai model",
    "model release"
  ].some((term) => haystack.includes(term));
}

function isRelevantToWatchKeyword(
  keyword: string | undefined,
  item: {
    title: string;
    url: string;
    excerpt: string | null;
  }
) {
  if (!keyword) {
    return true;
  }

  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const haystack = `${item.title} ${item.url} ${item.excerpt ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
