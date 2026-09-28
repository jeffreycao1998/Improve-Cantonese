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

export function createGeneratedReviewJsonSchema(isFineTuned = false) {
  const text = (maxLength: number) =>
    isFineTuned
      ? { type: "string" as const }
      : { type: "string" as const, minLength: 1, maxLength };
  const score = isFineTuned
    ? { type: "integer" as const }
    : { type: "integer" as const, minimum: 0, maximum: 100 };

  return {
    type: "object",
    properties: {
      overallScore: score,
      skillScores: {
        type: "object",
        properties: {
          tone: score,
          wording: score,
          flow: score,
          confidence: score,
          listening: score,
        },
        required: ["tone", "wording", "flow", "confidence", "listening"],
        additionalProperties: false,
      },
      summary: text(500),
      wins: { type: "array", items: text(180) },
      nextSteps: { type: "array", items: text(180) },
      phrases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            original: text(240),
            improved: text(240),
            englishHint: text(240),
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
}

export const generatedReviewJsonSchema = createGeneratedReviewJsonSchema();

// Array caps are local for every model. Fine-tuned models also need local text caps.
export function normalizeGeneratedReview(value: unknown, isFineTuned = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const review = value as Record<string, unknown>;
  const text = (value: unknown, maxLength: number) =>
    isFineTuned && typeof value === "string" ? value.slice(0, maxLength) : value;
  const notes = (value: unknown) =>
    Array.isArray(value) ? value.slice(0, 4).map((item) => text(item, 180)) : value;

  return {
    ...review,
    summary: text(review.summary, 500),
    wins: notes(review.wins),
    nextSteps: notes(review.nextSteps),
    phrases: Array.isArray(review.phrases)
      ? review.phrases.slice(0, 5).map((phrase: unknown) => {
          if (!phrase || typeof phrase !== "object" || Array.isArray(phrase)) {
            return phrase;
          }
          const fields = phrase as Record<string, unknown>;
          return {
            ...fields,
            original: text(fields.original, 240),
            improved: text(fields.improved, 240),
            englishHint: text(fields.englishHint, 240),
          };
        })
      : review.phrases,
  };
}
