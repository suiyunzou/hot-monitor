import * as cheerio from "cheerio";
import { absoluteUrl } from "@/lib/http/fetch-page";

export type ExtractedArticle = {
  url: string;
  canonicalUrl?: string;
  title: string;
  excerpt?: string;
  content?: string;
  author?: string;
  publishedAt?: Date;
  language?: string;
  links: Array<{ title: string; url: string; excerpt?: string }>;
};

const noisySelectors = [
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "header",
  "form",
  "[aria-hidden='true']"
];

export function extractArticle(html: string, pageUrl: string): ExtractedArticle {
  const $ = cheerio.load(html);
  noisySelectors.forEach((selector) => $(selector).remove());

  const canonicalUrl =
    $("link[rel='canonical']").attr("href") ??
    $("meta[property='og:url']").attr("content") ??
    undefined;
  const title =
    $("meta[property='og:title']").attr("content") ??
    $("meta[name='twitter:title']").attr("content") ??
    $("h1").first().text() ??
    $("title").first().text() ??
    pageUrl;
  const excerpt =
    $("meta[name='description']").attr("content") ??
    $("meta[property='og:description']").attr("content") ??
    undefined;
  const author =
    $("meta[name='author']").attr("content") ??
    $("[rel='author']").first().text() ??
    undefined;
  const publishedRaw =
    $("meta[property='article:published_time']").attr("content") ??
    $("time[datetime]").first().attr("datetime") ??
    $("meta[name='date']").attr("content") ??
    undefined;
  const language = $("html").attr("lang") ?? undefined;

  const content = normalizeWhitespace(
    $("article").first().text() || $("main").first().text() || $("body").text()
  ).slice(0, 12000);

  const links = $("a")
    .toArray()
    .map((element): { title: string; url: string; excerpt?: string } | undefined => {
      const linkText = normalizeWhitespace($(element).text());
      const href = $(element).attr("href");
      const url = href ? absoluteUrl(pageUrl, href) : undefined;

      if (!url || !linkText || linkText.length < 8) {
        return undefined;
      }

      return {
        title: linkText.slice(0, 220),
        url,
        excerpt: undefined
      };
    })
    .filter(isDefined);

  return {
    url: pageUrl,
    canonicalUrl: canonicalUrl ? absoluteUrl(pageUrl, canonicalUrl) : undefined,
    title: normalizeWhitespace(title).slice(0, 260),
    excerpt: excerpt ? normalizeWhitespace(excerpt).slice(0, 600) : undefined,
    content,
    author: author ? normalizeWhitespace(author).slice(0, 160) : undefined,
    publishedAt: parseDate(publishedRaw),
    language,
    links: uniqueLinks(links)
  };
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function uniqueLinks(links: Array<{ title: string; url: string; excerpt?: string }>) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const normalized = stripTracking(link.url);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    link.url = normalized;
    return true;
  });
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function stripTracking(url: string) {
  try {
    const parsed = new URL(url);
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "fbclid",
      "gclid"
    ].forEach((param) => parsed.searchParams.delete(param));
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}
