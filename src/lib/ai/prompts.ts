type AnalyzeInputItem = {
  id: string;
  sourceType: string;
  credibilityLevel: string;
  sourceName: string;
  title: string;
  url: string;
  excerpt?: string | null;
  content?: string | null;
  publishedAt?: Date | null;
  viewCount?: number | null;
  likeCount?: number | null;
  retweetCount?: number | null;
  replyCount?: number | null;
  engagementScore?: number | null;
};

export function buildAnalyzeMessages(items: AnalyzeInputItem[]) {
  return [
    {
      role: "system" as const,
      content:
        "You are an AI news verification analyst. Only analyze the provided source items. Do not invent facts, URLs, names, dates, scores, or sources. If evidence is weak, set needs_verification=true. ALL output text (topic, summary, why_it_matters) MUST be written in Simplified Chinese; if a source is not in Chinese, translate it. topic must be a non-empty Chinese title."
    },
    {
      role: "user" as const,
      content: JSON.stringify(
        {
          task:
            "For each source item, decide whether it is relevant to AI news. Produce structured analyses. source_ids must contain only ids from the input. If an item is not AI-related, set is_ai_related=false and keep a short reason in summary.",
          reliability_rules: [
            "Official sources are stronger than social/search snippets.",
            "Social-only signals need verification.",
            "Search results require landing page evidence.",
            "No source id means no valid hot topic."
          ],
          scoring_rules: [
            "hot_score reflects attention-worthiness: reach (view_count), engagement (like/reply/retweet counts) and recency. A higher engagement_score means more reach and engagement.",
            "A single social post with low engagement_score must get a low hot_score and needs_verification=true.",
            "confidence reflects source credibility and corroboration, NOT popularity: official/primary sources and multiple independent sources raise it; lone social or search-snippet sources lower it."
          ],
          output_language: "All topic/summary/why_it_matters text must be Simplified Chinese.",
          items: items.map((item) => ({
            id: item.id,
            source_type: item.sourceType,
            credibility_level: item.credibilityLevel,
            source_name: item.sourceName,
            title: item.title,
            url: item.url,
            published_at: item.publishedAt?.toISOString() ?? null,
            view_count: item.viewCount ?? null,
            like_count: item.likeCount ?? null,
            retweet_count: item.retweetCount ?? null,
            reply_count: item.replyCount ?? null,
            engagement_score: item.engagementScore ?? null,
            excerpt: item.excerpt ?? null,
            content: item.content?.slice(0, 4000) ?? null
          }))
        },
        null,
        2
      )
    }
  ];
}
