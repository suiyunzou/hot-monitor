import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import { extractArticle, stripTracking } from "@/lib/extractors/article-extractor";
import { fetchText, sleep } from "@/lib/http/fetch-page";
import { officialSources } from "./default-sources";
import type { CollectedItem, CollectorResult, CollectOptions, SourceCollector } from "./types";
import { makeLogger } from "@/lib/logger";

const logger = makeLogger("collect:official");

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

    logger.info(`开始抓取 ${officialSources.length} 个官网来源，每源最多取 ${limit} 篇`);

    for (const source of officialSources) {
      if (!source.entryUrl) {
        logger.warn(`${source.name} 没有配置入口 URL，跳过`);
        continue;
      }

      try {
        logger.info(`抓取入口页：${source.name} → ${source.entryUrl}`);
        const entryHtml = await fetchText(source.entryUrl);
        const entryArticle = extractArticle(entryHtml, source.entryUrl);
        const allLinks = entryArticle.links;
        const candidateLinks = allLinks
          .filter((link) => isLikelyAiOrNewsLink(link.title, link.url))
          .slice(0, limit);

        logger.info(
          `${source.name} 入口页解析到 ${allLinks.length} 个链接，AI/新闻相关候选 ${candidateLinks.length} 个`
        );

        if (candidateLinks.length === 0) {
          logger.warn(`${source.name} 未找到候选文章链接，降级保存入口页内容`);
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
            logger.debug(`  抓取文章：${link.title || link.url}`);
            const articleHtml = await fetchText(link.url);
            const article = extractArticle(articleHtml, link.url);

            logger.info(`  ✓ ${source.name}：${article.title || link.title}`);

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
            const msg = formatError(`official article ${link.url}`, error);
            logger.error(`  文章抓取失败：${link.url} → ${error instanceof Error ? error.message : String(error)}`);
            errors.push(msg);
          }
        }
      } catch (error) {
        const msg = formatError(`official source ${source.key}`, error);
        logger.error(`${source.name} 入口页抓取失败：${error instanceof Error ? error.message : String(error)}`);
        errors.push(msg);
      }
    }

    const deduped = dedupeItems(items);
    logger.info(`官网采集完成：共 ${items.length} 条，去重后 ${deduped.length} 条，错误 ${errors.length} 个`);

    return {
      collector: this.kind,
      fetchedCount: deduped.length,
      items: deduped,
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
