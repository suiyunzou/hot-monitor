const DEFAULT_TIMEOUT_MS = 15000;

export async function fetchText(url: string, init?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; SuiyunzouHotMonitor/0.1; +https://localhost)",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        ...init?.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status} ${response.statusText} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function absoluteUrl(baseUrl: string, maybeUrl: string) {
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
