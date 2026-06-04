export function buildKeywordSearchQueries(keyword: string) {
  const normalized = keyword.trim();
  const expandedTerms = expandKnownKeyword(normalized);

  return Array.from(new Set([
    normalized,
    `${normalized} 新闻`,
    `${normalized} 最新`,
    ...expandedTerms.flatMap((term) => [
      `${term} news`,
      `${term} latest update`,
      `${term} product launch`
    ]),
    `${normalized} AI news 2026 official announcement`,
    `${normalized} artificial intelligence update`,
    `${normalized} LLM model release`
  ])).filter((query) => query.length >= 2);
}

function expandKnownKeyword(keyword: string) {
  const compact = keyword.toLowerCase().replace(/\s+/g, "");

  if (compact === "ai编程" || compact === "ai程序" || compact === "ai开发") {
    return [
      "AI programming",
      "AI coding",
      "AI developer tools",
      "AI code assistant",
      "coding agent",
      "programming agent",
      "AI IDE"
    ];
  }

  return [];
}
