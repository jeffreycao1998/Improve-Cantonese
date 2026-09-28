import { z } from "zod";

export const skillAreaSchema = z.enum([
  "tone",
  "wording",
  "flow",
  "confidence",
  "listening",
]);

export const generatedReviewSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  skillScores: z.object({
    tone: z.number().int().min(0).max(100),
    wording: z.number().int().min(0).max(100),
    flow: z.number().int().min(0).max(100),
    confidence: z.number().int().min(0).max(100),
    listening: z.number().int().min(0).max(100),
  }),
  summary: z.string().min(1).max(500),
  wins: z.array(z.string().min(1).max(180)).max(4),
  nextSteps: z.array(z.string().min(1).max(180)).max(4),
  phrases: z
    .array(
      z.object({
        original: z.string().min(1).max(240),
        improved: z.string().min(1).max(240),
        englishHint: z.string().min(1).max(240),
        focusArea: skillAreaSchema,
      }),
    )
    .max(5),
});

export type GeneratedReview = z.infer<typeof generatedReviewSchema>;

export const generatedReviewJsonSchema = {
  type: "object",
  properties: {
    overallScore: { type: "integer", minimum: 0, maximum: 100 },
    skillScores: {
      type: "object",
      properties: {
        tone: { type: "integer", minimum: 0, maximum: 100 },
        wording: { type: "integer", minimum: 0, maximum: 100 },
        flow: { type: "integer", minimum: 0, maximum: 100 },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        listening: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["tone", "wording", "flow", "confidence", "listening"],
      additionalProperties: false,
    },
    summary: { type: "string" },
    wins: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    phrases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          improved: { type: "string" },
          englishHint: { type: "string" },
          focusArea: {
            type: "string",
            enum: ["tone", "wording", "flow", "confidence", "listening"],
          },
        },
        required: ["original", "improved", "englishHint", "focusArea"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "overallScore",
    "skillScores",
    "summary",
    "wins",
    "nextSteps",
    "phrases",
  ],
  additionalProperties: false,
} as const;
