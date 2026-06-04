import { z } from "zod";

export const rawItemAnalysisSchema = z.object({
  is_ai_related: z.boolean(),
  topic: z.string().min(1),
  category: z.enum([
    "model_release",
    "product_update",
    "research",
    "open_source",
    "business",
    "policy",
    "security",
    "social_signal",
    "verification",
    "other"
  ]),
  summary: z.string().min(1),
  why_it_matters: z.string().min(1),
  hot_score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  source_ids: z.array(z.string()).min(1),
  needs_verification: z.boolean()
});

export const rawItemAnalysisListSchema = z.object({
  analyses: z.array(rawItemAnalysisSchema)
});

export type RawItemAnalysis = z.infer<typeof rawItemAnalysisSchema>;
export type RawItemAnalysisList = z.infer<typeof rawItemAnalysisListSchema>;

export const openRouterAnalysisJsonSchema = {
  name: "ai_hot_monitor_raw_item_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["analyses"],
    properties: {
      analyses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "is_ai_related",
            "topic",
            "category",
            "summary",
            "why_it_matters",
            "hot_score",
            "confidence",
            "source_ids",
            "needs_verification"
          ],
          properties: {
            is_ai_related: { type: "boolean" },
            topic: { type: "string" },
            category: {
              type: "string",
              enum: [
                "model_release",
                "product_update",
                "research",
                "open_source",
                "business",
                "policy",
                "security",
                "social_signal",
                "verification",
                "other"
              ]
            },
            summary: { type: "string" },
            why_it_matters: { type: "string" },
            hot_score: { type: "integer", minimum: 0, maximum: 100 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            source_ids: {
              type: "array",
              minItems: 1,
              items: { type: "string" }
            },
            needs_verification: { type: "boolean" }
          }
        }
      }
    }
  }
} as const;
