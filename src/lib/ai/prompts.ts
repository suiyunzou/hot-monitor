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
};

export function buildAnalyzeMessages(items: AnalyzeInputItem[]) {
  return [
    {
      role: "system" as const,
      content:
        "You are an AI news verification analyst. Only analyze the provided source items. Do not invent facts, URLs, names, dates, scores, or sources. If evidence is weak, set needs_verification=true. Return concise Chinese summaries."
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
          items: items.map((item) => ({
            id: item.id,
            source_type: item.sourceType,
            credibility_level: item.credibilityLevel,
            source_name: item.sourceName,
            title: item.title,
            url: item.url,
            published_at: item.publishedAt?.toISOString() ?? null,
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
