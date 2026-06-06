import type { CredibilityLevel, SourceType } from "@/generated/prisma/enums";

export type CollectorKind = "official" | "twitterapi-io" | "search";

export type SourceConfig = {
  key: string;
  name: string;
  type: SourceType;
  credibilityLevel: CredibilityLevel;
  homepageUrl?: string;
  entryUrl?: string;
};

export type KolAccountRef = {
  handle: string;
  tier: number;
};

export type CollectOptions = {
  since?: Date;
  limit?: number;
  query?: string;
  runId?: string;
  kolAccounts?: KolAccountRef[];
};

export type CollectedItem = {
  sourceKey: string;
  watchKeywordId?: string;
  sourceType: SourceType;
  credibilityLevel: CredibilityLevel;
  externalId?: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  author?: string;
  excerpt?: string;
  content?: string;
  language?: string;
  publishedAt?: Date;
  viewCount?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  engagementScore?: number;
  metadata?: Record<string, unknown>;
};

export type CollectorResult = {
  collector: CollectorKind;
  fetchedCount: number;
  items: CollectedItem[];
  errors: string[];
};

export interface SourceCollector {
  kind: CollectorKind;
  collect(options?: CollectOptions): Promise<CollectorResult>;
}
