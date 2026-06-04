import { CredibilityLevel, SourceType } from "@/generated/prisma/enums";
import type { SourceConfig } from "./types";

export const officialSources: SourceConfig[] = [
  {
    key: "openai-news",
    name: "OpenAI News",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://openai.com",
    entryUrl: "https://openai.com/news/"
  },
  {
    key: "anthropic-news",
    name: "Anthropic News",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://www.anthropic.com",
    entryUrl: "https://www.anthropic.com/news"
  },
  {
    key: "google-deepmind-blog",
    name: "Google DeepMind Blog",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://deepmind.google",
    entryUrl: "https://deepmind.google/discover/blog/"
  },
  {
    key: "meta-ai-blog",
    name: "Meta AI Blog",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://ai.meta.com",
    entryUrl: "https://ai.meta.com/blog/"
  },
  {
    key: "xai-news",
    name: "xAI News",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://x.ai",
    entryUrl: "https://x.ai/news"
  },
  {
    key: "nvidia-ai-news",
    name: "NVIDIA AI News",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://www.nvidia.com",
    entryUrl: "https://www.nvidia.com/en-us/ai/"
  },
  {
    key: "microsoft-ai-blog",
    name: "Microsoft AI Blog",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://www.microsoft.com/ai",
    entryUrl: "https://blogs.microsoft.com/ai/"
  },
  {
    key: "huggingface-blog",
    name: "Hugging Face Blog",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://huggingface.co",
    entryUrl: "https://huggingface.co/blog"
  },
  {
    key: "mistral-news",
    name: "Mistral AI News",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.OFFICIAL,
    homepageUrl: "https://mistral.ai",
    entryUrl: "https://mistral.ai/news"
  },
  {
    key: "github-blog-ai",
    name: "GitHub Blog",
    type: SourceType.OFFICIAL,
    credibilityLevel: CredibilityLevel.PRIMARY,
    homepageUrl: "https://github.blog",
    entryUrl: "https://github.blog/changelog/"
  }
];

export const searchSource: SourceConfig = {
  key: "web-search",
  name: "Google/Bing Search",
  type: SourceType.SEARCH,
  credibilityLevel: CredibilityLevel.SEARCH_SNIPPET,
  homepageUrl: "https://www.bing.com",
  entryUrl: "https://www.bing.com/search"
};

export const twitterSource: SourceConfig = {
  key: "twitterapi-io",
  name: "X via twitterapi.io",
  type: SourceType.TWITTER,
  credibilityLevel: CredibilityLevel.SOCIAL,
  homepageUrl: "https://twitterapi.io",
  entryUrl: "https://api.twitterapi.io/twitter/tweet/advanced_search"
};

export const allDefaultSources = [...officialSources, searchSource, twitterSource];

export const aiSearchQueries = [
  "AI model release official",
  "OpenAI new model product update",
  "Claude Anthropic update official",
  "Google DeepMind AI announcement",
  "AI agent framework release",
  "LLM benchmark new model",
  "AI open source release",
  "site:openai.com/news AI",
  "site:anthropic.com/news Claude",
  "site:deepmind.google/discover/blog AI"
];

export const twitterQueries = [
  "(AI OR LLM OR OpenAI OR Claude OR DeepSeek OR Gemini OR xAI) min_faves:50",
  "(agent OR agents OR \"AI coding\" OR \"model release\") min_faves:30",
  "(from:OpenAI OR from:AnthropicAI OR from:GoogleDeepMind OR from:xai OR from:deepseek_ai)"
];
