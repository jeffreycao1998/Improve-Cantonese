import type {
  LearnerProfile,
  LocalProgress,
  PracticeScenario,
  PracticeTurnFeedback,
  SessionReview,
} from "@/lib/types";
import { z } from "zod";
import {
  createTrainingPlan,
  dateKey,
  markMissionComplete,
  mergeSkillScores,
  phrasesFromReview,
  rateReviewPhrase,
} from "@/lib/training";

export const progressStorageKey = "cantonese-speaking-coach-progress-v2";
export const legacyProgressStorageKey = "cantonese-speaking-coach-progress-v1";

const scenarioIdSchema = z
  .string()
  .min(1)
  .max(160)
  .transform((value) => value as PracticeScenario["id"]);
const skillAreaSchema = z.enum([
  "tone",
  "wording",
  "flow",
  "confidence",
  "listening",
]);
const profileSchema = z.object({
  name: z.string().max(60),
  level: z.enum(["beginner", "heritage", "intermediate"]),
  goals: z
    .array(
      z.enum(["family", "travel", "daily-life", "confidence", "listening"]),
    )
    .min(1)
    .max(5),
  dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  createdAt: z.string().min(1).max(80),
});
const feedbackSchema = z.object({
  id: z.string().min(1).max(180),
  scenarioId: scenarioIdSchema,
  createdAt: z.string().min(1).max(80),
  summary: z.string().min(1).max(500),
  naturalRewrite: z.string().max(500).optional(),
  focusArea: skillAreaSchema,
  confidenceDelta: z.number().min(-10).max(10),
});
const scenarioSchema = z.object({
  id: scenarioIdSchema,
  title: z.string().min(1).max(100),
  situation: z.string().min(1).max(600),
  coachGoal: z.string().min(1).max(400),
  learnerGoal: z.string().min(1).max(400),
  level: z.enum(["Warm-up", "Everyday", "Stretch"]),
  accentFocus: z.array(z.string().min(1).max(100)).max(8),
  samplePrompts: z.array(z.string().min(1).max(200)).max(6),
  isCustom: z.boolean().optional(),
  createdAt: z.string().max(80).optional(),
});
const missionSchema = z.object({
  id: z.string().min(1).max(220),
  date: z.string().min(1).max(20),
  scenarioId: scenarioIdSchema,
  title: z.string().min(1).max(100),
  focusArea: skillAreaSchema,
  durationMinutes: z.number().int().min(1).max(60),
  completedAt: z.string().max(80).nullable(),
});
const trainingPlanSchema = z.object({
  id: z.string().min(1).max(220),
  generatedAt: z.string().min(1).max(80),
  startsOn: z.string().min(1).max(20),
  missions: z.array(missionSchema).max(50),
});
const reviewPhraseCoreSchema = z.object({
  original: z.string().min(1).max(500),
  improved: z.string().min(1).max(500),
  englishHint: z.string().min(1).max(500),
  focusArea: skillAreaSchema,
});
const reviewPhraseSchema = reviewPhraseCoreSchema.extend({
  id: z.string().min(1).max(220),
  sourceReviewId: z.string().min(1).max(220),
  scenarioId: scenarioIdSchema,
  repetitions: z.number().int().min(0).max(1000),
  intervalDays: z.number().int().min(1).max(3650),
  ease: z.number().min(1.3).max(3),
  nextReviewDate: z.string().min(1).max(20),
  lastPracticedAt: z.string().max(80).nullable(),
});
const skillScoresSchema = z.object({
  tone: z.number().min(0).max(100),
  wording: z.number().min(0).max(100),
  flow: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  listening: z.number().min(0).max(100),
});
const sessionReviewSchema = z.object({
  id: z.string().min(1).max(220),
  sessionId: z.string().min(1).max(220),
  scenarioId: scenarioIdSchema,
  completedAt: z.string().min(1).max(80),
  durationSeconds: z.number().int().min(0).max(86_400),
  overallScore: z.number().min(0).max(100),
  skillScores: skillScoresSchema,
  summary: z.string().min(1).max(1000),
  wins: z.array(z.string().min(1).max(500)).max(8),
  nextSteps: z.array(z.string().min(1).max(500)).max(8),
  phrases: z.array(reviewPhraseCoreSchema).max(10),
  source: z.enum(["ai", "local"]),
});

export const defaultProgress: LocalProgress = {
  schemaVersion: 2,
  sessionsCompleted: 0,
  streak: 0,
  lastPracticeDate: null,
  confidenceScore: 54,
  recentFeedback: [],
  weakAreas: ["sentence rhythm", "repair phrases", "natural wording"],
  profile: null,
  trainingPlan: null,
  skillScores: {
    tone: 50,
    wording: 50,
    flow: 50,
    confidence: 54,
    listening: 50,
  },
  sessionReviews: [],
  reviewQueue: [],
  customScenarios: [],
};

function freshDefaultProgress(): LocalProgress {
  return {
    ...defaultProgress,
    recentFeedback: [],
    weakAreas: [...defaultProgress.weakAreas],
    skillScores: { ...defaultProgress.skillScores },
    sessionReviews: [],
    reviewQueue: [],
    customScenarios: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function countOr(value: unknown, fallback: number) {
  return Math.max(0, Math.round(numberOr(value, fallback)));
}

function scoreOr(value: unknown, fallback: number) {
  return Math.max(0, Math.min(100, numberOr(value, fallback)));
}

export function migrateProgress(value: unknown): LocalProgress {
  const defaults = freshDefaultProgress();
  if (!isRecord(value)) {
    return defaults;
  }

  const skillScores = isRecord(value.skillScores)
    ? {
        tone: scoreOr(value.skillScores.tone, defaults.skillScores.tone),
        wording: scoreOr(
          value.skillScores.wording,
          defaults.skillScores.wording,
        ),
        flow: scoreOr(value.skillScores.flow, defaults.skillScores.flow),
        confidence: scoreOr(
          value.skillScores.confidence,
          defaults.skillScores.confidence,
        ),
        listening: scoreOr(
          value.skillScores.listening,
          defaults.skillScores.listening,
        ),
      }
    : defaults.skillScores;
  const parsedProfile = profileSchema.safeParse(value.profile);
  const parsedPlan = trainingPlanSchema.safeParse(value.trainingPlan);
  const parsedFeedback = z
    .array(feedbackSchema)
    .safeParse(value.recentFeedback);
  const parsedReviews = z
    .array(sessionReviewSchema)
    .safeParse(value.sessionReviews);
  const parsedQueue = z.array(reviewPhraseSchema).safeParse(value.reviewQueue);
  const parsedScenarios = z
    .array(scenarioSchema)
    .safeParse(value.customScenarios);

  return {
    schemaVersion: 2,
    sessionsCompleted: countOr(value.sessionsCompleted, 0),
    streak: countOr(value.streak, 0),
    lastPracticeDate:
      typeof value.lastPracticeDate === "string"
        ? value.lastPracticeDate
        : null,
    confidenceScore: scoreOr(value.confidenceScore, defaults.confidenceScore),
    recentFeedback: parsedFeedback.success
      ? (parsedFeedback.data as PracticeTurnFeedback[]).slice(0, 8)
      : [],
    weakAreas: Array.isArray(value.weakAreas)
      ? value.weakAreas
          .filter((area): area is string => typeof area === "string")
          .slice(0, 5)
      : defaults.weakAreas,
    profile: parsedProfile.success ? parsedProfile.data : null,
    trainingPlan: parsedPlan.success
      ? parsedPlan.data
      : parsedProfile.success
        ? createTrainingPlan(parsedProfile.data)
        : null,
    skillScores,
    sessionReviews: parsedReviews.success
      ? (parsedReviews.data as SessionReview[]).slice(0, 30)
      : [],
    reviewQueue: parsedQueue.success ? parsedQueue.data : [],
    customScenarios: parsedScenarios.success
      ? parsedScenarios.data.filter(
          (scenario) => scenario.isCustom && scenario.id.startsWith("custom-"),
        )
      : [],
  };
}

export function loadProgress(): LocalProgress {
  if (typeof window === "undefined") {
    return freshDefaultProgress();
  }

  const stored =
    window.localStorage.getItem(progressStorageKey) ??
    window.localStorage.getItem(legacyProgressStorageKey);
  if (!stored) {
    return freshDefaultProgress();
  }

  try {
    return migrateProgress(JSON.parse(stored));
  } catch {
    return freshDefaultProgress();
  }
}

export function saveProgress(progress: LocalProgress) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(progressStorageKey, JSON.stringify(progress));
}

export function exportProgress(progress: LocalProgress) {
  return JSON.stringify(progress, null, 2);
}

export function importProgress(serialized: string) {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("This file does not contain Cantonese Coach progress.");
  }
  return migrateProgress(parsed);
}

export function beginJourney(
  progress: LocalProgress,
  profile: LearnerProfile,
  now = new Date(),
): LocalProgress {
  return {
    ...progress,
    profile,
    trainingPlan: createTrainingPlan(profile, now),
  };
}

export function recordFeedback(
  progress: LocalProgress,
  feedback: PracticeTurnFeedback,
) {
  const recentFeedback = [feedback, ...progress.recentFeedback].slice(0, 8);
  const weakAreas = Array.from(
    new Set([feedback.focusArea, ...progress.weakAreas]),
  ).slice(0, 5);

  return {
    ...progress,
    confidenceScore: Math.max(
      0,
      Math.min(100, progress.confidenceScore + feedback.confidenceDelta),
    ),
    recentFeedback,
    weakAreas,
  };
}

export function completeSession(
  progress: LocalProgress,
  scenarioId?: PracticeScenario["id"],
  now = new Date(),
) {
  const today = dateKey(now);
  const lastPracticeDate = progress.lastPracticeDate;
  const practicedToday = lastPracticeDate === today;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const streak = practicedToday
    ? progress.streak
    : lastPracticeDate === dateKey(yesterday)
      ? progress.streak + 1
      : 1;

  return {
    ...progress,
    sessionsCompleted: progress.sessionsCompleted + 1,
    streak,
    lastPracticeDate: today,
    confidenceScore: Math.min(100, progress.confidenceScore + 2),
    trainingPlan: scenarioId
      ? markMissionComplete(progress.trainingPlan, scenarioId, now)
      : progress.trainingPlan,
  };
}

export function addSessionReview(
  progress: LocalProgress,
  review: SessionReview,
): LocalProgress {
  const incomingPhrases = phrasesFromReview(review);
  const existingImproved = new Set(
    progress.reviewQueue.map((phrase) => phrase.improved),
  );
  return {
    ...progress,
    confidenceScore: Math.round(
      Math.max(
        0,
        Math.min(
          100,
          progress.confidenceScore * 0.7 + review.overallScore * 0.3,
        ),
      ),
    ),
    skillScores: mergeSkillScores(progress.skillScores, review.skillScores),
    sessionReviews: [review, ...progress.sessionReviews].slice(0, 30),
    reviewQueue: [
      ...incomingPhrases.filter(
        (phrase) => !existingImproved.has(phrase.improved),
      ),
      ...progress.reviewQueue,
    ].slice(0, 80),
  };
}

export function gradeReviewPhrase(
  progress: LocalProgress,
  phraseId: string,
  rating: "again" | "good" | "easy",
  now = new Date(),
): LocalProgress {
  return {
    ...progress,
    reviewQueue: progress.reviewQueue.map((phrase) =>
      phrase.id === phraseId ? rateReviewPhrase(phrase, rating, now) : phrase,
    ),
  };
}

export function addCustomScenario(
  progress: LocalProgress,
  scenario: PracticeScenario,
): LocalProgress {
  return {
    ...progress,
    customScenarios: [scenario, ...progress.customScenarios].slice(0, 20),
  };
}

export function removeCustomScenario(
  progress: LocalProgress,
  scenarioId: PracticeScenario["id"],
) {
  return {
    ...progress,
    customScenarios: progress.customScenarios.filter(
      (scenario) => scenario.id !== scenarioId,
    ),
  };
}
