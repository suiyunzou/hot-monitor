import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import { extractArticle, stripTracking } from "@/lib/extractors/article-extractor";
import { fetchText, sleep } from "@/lib/http/fetch-page";
import { officialSources } from "./default-sources";
import type { CollectedItem, CollectorResult, CollectOptions, SourceCollector } from "./types";

const AI_TERMS = [
  "ai",
  "artificial intelligence",
  "agent",
  "agents",
  "llm",
  "model",
  "gpt",
  "claude",
  "gemini",
  "deepseek",
  "open source",
  "benchmark"
];

export class OfficialCollector implements SourceCollector {
  kind = "official" as const;

  async collect(options: CollectOptions = {}): Promise<CollectorResult> {
    const limit = options.limit ?? 4;
    const items: CollectedItem[] = [];
    const errors: string[] = [];

    for (const source of officialSources) {
      if (!source.entryUrl) {
        continue;
      }

      try {
        const entryHtml = await fetchText(source.entryUrl);
        const entryArticle = extractArticle(entryHtml, source.entryUrl);
        const candidateLinks = entryArticle.links
          .filter((link) => isLikelyAiOrNewsLink(link.title, link.url))
          .slice(0, limit);

        if (candidateLinks.length === 0) {
          items.push({
            sourceKey: source.key,
            sourceType: SourceType.OFFICIAL,
            credibilityLevel: source.credibilityLevel,
            url: entryArticle.canonicalUrl ?? source.entryUrl,
            canonicalUrl: entryArticle.canonicalUrl,
            title: entryArticle.title,
            excerpt: entryArticle.excerpt,
            content: entryArticle.content,
            author: entryArticle.author,
            publishedAt: entryArticle.publishedAt,
            language: entryArticle.language,
            metadata: { mode: "entry-page-fallback" }
          });
          continue;
        }

        for (const link of candidateLinks) {
          try {
            await sleep(350);
            const articleHtml = await fetchText(link.url);
            const article = extractArticle(articleHtml, link.url);

            items.push({
              sourceKey: source.key,
              sourceType: SourceType.OFFICIAL,
              credibilityLevel: source.credibilityLevel,
              url: stripTracking(article.canonicalUrl ?? article.url),
              canonicalUrl: article.canonicalUrl,
              title: article.title || link.title,
              excerpt: article.excerpt ?? link.excerpt,
              content: article.content,
              author: article.author,
              publishedAt: article.publishedAt,
              language: article.language,
              metadata: {
                discoveredFrom: source.entryUrl,
                sourceName: source.name
              }
            });
          } catch (error) {
            errors.push(formatError(`official article ${link.url}`, error));
          }
        }
      } catch (error) {
        errors.push(formatError(`official source ${source.key}`, error));
      }
    }

    return {
      collector: this.kind,
      fetchedCount: items.length,
      items: dedupeItems(items),
      errors
    };
  }
}

function isLikelyAiOrNewsLink(title: string, url: string) {
  if (!url.startsWith("http")) {
    return false;
  }

  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }

  if (/\/(contact|sales|pricing|login|signin|signup|subscribe|careers?|events?)\/?/i.test(pathname)) {
    return false;
  }

  const titleText = title.toLowerCase();
  const urlText = url.toLowerCase();
  const isArticlePath = /\/(news|blog|posts|research|changelog|announcements?|updates?)\//i.test(
    pathname
  );
  const titleMentionsAi = AI_TERMS.some((term) => titleText.includes(term));
  const urlMentionsAi = AI_TERMS.some((term) => urlText.includes(term));

  return titleMentionsAi || (isArticlePath && urlMentionsAi);
}

function dedupeItems(items: CollectedItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.canonicalUrl ?? item.url;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatError(context: string, error: unknown) {
  return `${context}: ${error instanceof Error ? error.message : String(error)}`;
}
