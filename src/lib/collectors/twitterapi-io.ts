import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import { twitterQueries } from "./default-sources";
import type { CollectedItem, CollectorResult, CollectOptions, SourceCollector } from "./types";

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
      return {
        collector: this.kind,
        fetchedCount: 0,
        items: [],
        errors: ["TWITTERAPI_IO_KEY is not configured"]
      };
    }

    const queries = options.query ? [options.query] : twitterQueries;
    const items: CollectedItem[] = [];
    const errors: string[] = [];
    const until = new Date();
    const since = options.since ?? new Date(until.getTime() - 2 * 60 * 60 * 1000);

    for (const query of queries) {
      try {
        const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
        url.searchParams.set("query", query);
        url.searchParams.set("queryType", "Latest");
        url.searchParams.set("since_time", Math.floor(since.getTime() / 1000).toString());
        url.searchParams.set("until_time", Math.floor(until.getTime() / 1000).toString());

        const response = await fetch(url, {
          headers: {
            "X-API-Key": apiKey
          }
        });

        if (!response.ok) {
          throw new Error(`twitterapi.io returned ${response.status} ${response.statusText}`);
        }

        const json = (await response.json()) as Record<string, unknown>;
        const tweets = getTweets(json).slice(0, options.limit ?? 20);

        for (const tweet of tweets) {
          const id = tweet.id_str ?? tweet.id;
          const text = tweet.full_text ?? tweet.text;
          const username =
            tweet.author?.userName ??
            tweet.author?.username ??
            tweet.user?.screen_name ??
            "unknown";

          if (!id || !text) {
            continue;
          }

          items.push({
            sourceKey: "twitterapi-io",
            sourceType: SourceType.TWITTER,
            credibilityLevel:
              tweet.author?.isBlueVerified || tweet.user?.verified
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
            metadata: {
              query,
              likeCount: tweet.likeCount,
              retweetCount: tweet.retweetCount,
              replyCount: tweet.replyCount,
              viewCount: tweet.viewCount,
              authorName: tweet.author?.name ?? tweet.user?.name
            }
          });
        }
      } catch (error) {
        errors.push(formatError(`twitterapi.io query ${query}`, error));
      }
    }

    return {
      collector: this.kind,
      fetchedCount: items.length,
      items: dedupeTweets(items),
      errors
    };
  }
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
