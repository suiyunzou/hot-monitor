import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import {
  computeEngagementScore,
  isTweetWorthKeeping,
  resolveAuthority
} from "@/lib/scoring/engagement";
import { twitterQueries } from "./default-sources";
import type {
  CollectedItem,
  CollectorResult,
  CollectOptions,
  KolAccountRef,
  SourceCollector
} from "./types";
import { makeLogger } from "@/lib/logger";

const logger = makeLogger("collect:twitter");

type TwitterApiTweet = {
  id?: string;
  id_str?: string;
  url?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  createdAt?: string;
  author?: {
    userName?: string;
    username?: string;
    name?: string;
    isBlueVerified?: boolean;
  };
  user?: {
    screen_name?: string;
    name?: string;
    verified?: boolean;
  };
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  viewCount?: number;
};

export class TwitterApiIoCollector implements SourceCollector {
  kind = "twitterapi-io" as const;

  async collect(options: CollectOptions = {}): Promise<CollectorResult> {
    const apiKey = process.env.TWITTERAPI_IO_KEY;

    if (!apiKey) {
      logger.warn("TWITTERAPI_IO_KEY 未配置，跳过 X 采集");
      return {
        collector: this.kind,
        fetchedCount: 0,
        items: [],
        errors: ["TWITTERAPI_IO_KEY is not configured"]
      };
    }

    const kolTierByHandle = buildKolTierMap(options.kolAccounts);
    const kolQueries = buildKolFromQueries(options.kolAccounts);
    const queries = options.query
      ? [options.query]
      : [...twitterQueries, ...kolQueries];
    const items: CollectedItem[] = [];
    const errors: string[] = [];
    const until = new Date();
    const since = options.since ?? new Date(until.getTime() - 2 * 60 * 60 * 1000);
    const perQueryLimit = options.limit ?? 20;

    logger.info(
      `X 采集开始：${queries.length} 条查询（含 ${kolQueries.length} 条 KOL from:查询），时间窗口 ${since.toISOString()} ~ ${until.toISOString()}`
    );

    for (const query of queries) {
      try {
        const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
        url.searchParams.set("query", query);
        url.searchParams.set("queryType", "Latest");
        url.searchParams.set("since_time", Math.floor(since.getTime() / 1000).toString());
        url.searchParams.set("until_time", Math.floor(until.getTime() / 1000).toString());

        logger.debug(`执行 X 查询：${query}`);

        const response = await fetch(url, {
          headers: {
            "X-API-Key": apiKey
          }
        });

        if (!response.ok) {
          throw new Error(`twitterapi.io returned ${response.status} ${response.statusText}`);
        }

        const json = (await response.json()) as Record<string, unknown>;
        const rawTweets = getTweets(json);
        const scored: CollectedItem[] = [];
        let droppedLowValue = 0;
        let droppedNoId = 0;

        for (const tweet of rawTweets) {
          const id = tweet.id_str ?? tweet.id;
          const text = tweet.full_text ?? tweet.text;
          const username =
            tweet.author?.userName ??
            tweet.author?.username ??
            tweet.user?.screen_name ??
            "unknown";

          if (!id || !text) {
            droppedNoId += 1;
            continue;
          }

          const metrics = {
            viewCount: tweet.viewCount,
            likeCount: tweet.likeCount,
            retweetCount: tweet.retweetCount,
            replyCount: tweet.replyCount
          };
          const isVerified = Boolean(tweet.author?.isBlueVerified || tweet.user?.verified);
          const authority = resolveAuthority(username, isVerified, kolTierByHandle);

          // Hard gate: drop low-value posts (e.g. a tweet with 5 views) unless
          // the author is an official / curated KOL / verified account.
          if (!isTweetWorthKeeping(metrics, authority)) {
            logger.debug(
              `  丢弃低价值推文 @${username}（权威=${authority} 浏览=${tweet.viewCount ?? "?"}  赞=${tweet.likeCount ?? "?"}）`
            );
            droppedLowValue += 1;
            continue;
          }

          const engagementScore = computeEngagementScore(metrics, authority);

          scored.push({
            sourceKey: "twitterapi-io",
            sourceType: SourceType.TWITTER,
            credibilityLevel:
              authority === "official"
                ? CredibilityLevel.PRIMARY
                : isVerified || authority === "kol"
                  ? CredibilityLevel.SOCIAL_VERIFIED
                  : CredibilityLevel.SOCIAL,
            externalId: id,
            url: tweet.url ?? `https://x.com/${username}/status/${id}`,
            title: text.slice(0, 180),
            author: username,
            excerpt: text.slice(0, 600),
            content: text,
            publishedAt: parseTweetDate(tweet.createdAt ?? tweet.created_at),
            language: undefined,
            viewCount: toCount(tweet.viewCount),
            likeCount: toCount(tweet.likeCount),
            retweetCount: toCount(tweet.retweetCount),
            replyCount: toCount(tweet.replyCount),
            engagementScore,
            metadata: {
              query,
              authority,
              authorName: tweet.author?.name ?? tweet.user?.name
            }
          });
        }

        // Keep the most engaging posts per query rather than the first N.
        scored.sort((a, b) => (b.engagementScore ?? 0) - (a.engagementScore ?? 0));
        const kept = scored.slice(0, perQueryLimit);
        items.push(...kept);

        logger.info(
          `查询「${query.slice(0, 60)}」→ 原始 ${rawTweets.length} | 无效 ${droppedNoId} | 低价值丢弃 ${droppedLowValue} | 保留 ${kept.length}（评分前 ${perQueryLimit}）`
        );

        if (kept.length > 0) {
          for (const item of kept.slice(0, 3)) {
            logger.debug(
              `  @${item.author} score=${item.engagementScore} 👁${item.viewCount ?? "?"} ♥${item.likeCount ?? "?"} ─ ${item.title?.slice(0, 60)}`
            );
          }
        }
      } catch (error) {
        logger.error(`X 查询失败「${query}」：${error instanceof Error ? error.message : String(error)}`);
        errors.push(formatError(`twitterapi.io query ${query}`, error));
      }
    }

    const deduped = dedupeTweets(items);
    deduped.sort((a, b) => (b.engagementScore ?? 0) - (a.engagementScore ?? 0));

    logger.info(`X 采集完成：所有查询合计保留 ${items.length} 条，去重后 ${deduped.length} 条，错误 ${errors.length} 个`);

    return {
      collector: this.kind,
      fetchedCount: deduped.length,
      items: deduped,
      errors
    };
  }
}

function buildKolTierMap(accounts?: KolAccountRef[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const account of accounts ?? []) {
    const handle = account.handle.trim().replace(/^@/, "").toLowerCase();
    if (handle) {
      map.set(handle, account.tier);
    }
  }
  return map;
}

/** Build `(from:a OR from:b ...)` queries to actively pull KOL accounts. */
function buildKolFromQueries(accounts?: KolAccountRef[]): string[] {
  const handles = (accounts ?? [])
    .map((account) => account.handle.trim().replace(/^@/, ""))
    .filter(Boolean);

  const queries: string[] = [];
  for (let i = 0; i < handles.length; i += 10) {
    const chunk = handles.slice(i, i + 10);
    queries.push(`(${chunk.map((handle) => `from:${handle}`).join(" OR ")})`);
  }
  return queries;
}

function toCount(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getTweets(json: Record<string, unknown>) {
  const candidates = [json.tweets, json.data, json.results, json.list];
  const tweets = candidates.find(Array.isArray);
  return (tweets ?? []) as TwitterApiTweet[];
}

function parseTweetDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dedupeTweets(items: CollectedItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.externalId ?? item.url;
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
