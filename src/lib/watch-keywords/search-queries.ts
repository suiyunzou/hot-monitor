export function buildKeywordSearchQueries(keyword: string) {
  const normalized = keyword.trim();

  return [
    `${normalized} AI news 2026 official announcement`,
    `${normalized} artificial intelligence update`,
    `${normalized} LLM model release`
  ];
}
