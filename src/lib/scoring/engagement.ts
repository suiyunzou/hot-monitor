/**
 * Deterministic engagement scoring for social (X/Twitter) posts.
 *
 * Engagement counts are power-law distributed, so we log-scale each component
 * before combining. The result is a 0-100 "signal score" that the AI analysis
 * and the UI both consume, plus a hard gate that drops obvious low-value posts
 * (e.g. a tweet with 5 views) before they reach the AI or the database.
 */

export type EngagementMetrics = {
  viewCount?: number | null;
  likeCount?: number | null;
  retweetCount?: number | null;
  replyCount?: number | null;
};

/** Author authority tiers, strongest first. */
export type AuthorAuthority = "official" | "kol" | "verified" | "none";

const AUTHORITY_BONUS: Record<AuthorAuthority, number> = {
  official: 15,
  kol: 10,
  verified: 5,
  none: 0
};

// Hard-gate thresholds for non-authority authors.
const MIN_VIEWS = 1000;
const MIN_LIKES = 30;
const SOLO_LIKE_EXEMPT = 100;

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function nonNegative(value?: number | null): number {
  return value && value > 0 ? value : 0;
}

/**
 * Compute a 0-100 engagement score from raw metrics + author authority.
 */
export function computeEngagementScore(
  metrics: EngagementMetrics,
  authority: AuthorAuthority = "none"
): number {
  const views = nonNegative(metrics.viewCount);
  const likes = nonNegative(metrics.likeCount);
  const retweets = nonNegative(metrics.retweetCount);
  const replies = nonNegative(metrics.replyCount);

  const viewsScore = clamp01(Math.log10(views + 1) / Math.log10(1_000_000)); // ~1M views ≈ full
  const likesScore = clamp01(Math.log10(likes + 1) / Math.log10(100_000)); // ~100k likes ≈ full
  const interactScore = clamp01(Math.log10(retweets + replies + 1) / Math.log10(10_000));
  // Engagement rate rewards quality over raw reach; replies/retweets weigh more.
  const engagementRate = (likes + 2 * retweets + 3 * replies) / Math.max(views, 1);
  const rateScore = clamp01(engagementRate / 0.05); // 5% engagement ≈ excellent

  const base =
    100 * (0.35 * viewsScore + 0.3 * likesScore + 0.2 * interactScore + 0.15 * rateScore);
  const score = Math.round(base) + AUTHORITY_BONUS[authority];
  return Math.max(0, Math.min(100, score));
}

/**
 * Hard gate: should this tweet be kept at all? Authority authors (official /
 * curated KOL / verified) are always kept — an official low-engagement
 * announcement still matters. Everyone else must clear an engagement floor.
 */
export function isTweetWorthKeeping(
  metrics: EngagementMetrics,
  authority: AuthorAuthority = "none"
): boolean {
  if (authority !== "none") {
    return true;
  }

  const likes = nonNegative(metrics.likeCount);
  if (likes >= SOLO_LIKE_EXEMPT) {
    return true;
  }

  const views = metrics.viewCount;
  if (views == null) {
    // No view data from the API — fall back to a likes-only floor.
    return likes >= MIN_LIKES;
  }

  return views >= MIN_VIEWS && likes >= MIN_LIKES;
}

/**
 * Resolve an author's authority tier from a curated handle→tier map and the
 * blue-verification flag. Handles are matched case-insensitively without "@".
 */
export function resolveAuthority(
  username: string | undefined,
  isVerified: boolean,
  kolTierByHandle: Map<string, number>
): AuthorAuthority {
  const handle = (username ?? "").trim().replace(/^@/, "").toLowerCase();
  const tier = handle ? kolTierByHandle.get(handle) : undefined;

  if (tier === 1) {
    return "official";
  }
  if (tier === 2) {
    return "kol";
  }
  if (isVerified) {
    return "verified";
  }
  return "none";
}
