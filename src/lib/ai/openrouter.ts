import { rawItemAnalysisListSchema, openRouterAnalysisJsonSchema } from "./schemas";
import type { RawItemAnalysisList } from "./schemas";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export async function analyzeWithOpenRouter(messages: ChatMessage[]): Promise<{
  model: string;
  result: RawItemAnalysisList;
  rawOutput: string;
  promptTokens?: number;
  completionTokens?: number;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": "http://127.0.0.1:3000",
      "x-title": "Suiyunzou AI Hot Monitor"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: openRouterAnalysisJsonSchema
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter returned ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as OpenRouterResponse;
  const rawOutput = json.choices?.[0]?.message?.content;

  if (!rawOutput) {
    throw new Error("OpenRouter response did not include message content");
  }

  const parsed = parseJsonOutput(rawOutput);
  const result = rawItemAnalysisListSchema.parse(parsed);

  return {
    model,
    result,
    rawOutput,
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens
  };
}

function parseJsonOutput(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("OpenRouter output was not valid JSON");
    }

    return JSON.parse(match[0]);
  }
}
