import { describe, expect, it } from "vitest";
import {
  addSessionReview,
  beginJourney,
  completeSession,
  defaultProgress,
  importProgress,
  migrateProgress,
} from "./progress";
import type { LearnerProfile, SessionReview } from "./types";

const profile: LearnerProfile = {
  name: "",
  level: "beginner",
  goals: ["daily-life"],
  dailyMinutes: 5,
  createdAt: "2026-09-28T08:00:00.000Z",
};

describe("progress migrations", () => {
  it("upgrades legacy progress without losing core metrics", () => {
    const migrated = migrateProgress({
      sessionsCompleted: 12,
      streak: 4,
      lastPracticeDate: "2026-09-27",
      confidenceScore: 68,
      recentFeedback: [],
      weakAreas: ["tone"],
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.sessionsCompleted).toBe(12);
    expect(migrated.skillScores.confidence).toBe(54);
    expect(migrated.reviewQueue).toEqual([]);
  });

  it("rejects a JSON export that is not an object", () => {
    expect(() => importProgress("[]")).toThrow(/does not contain/);
  });

  it("drops corrupted nested data and clamps unsafe scores", () => {
    const migrated = migrateProgress({
      sessionsCompleted: -9,
      confidenceScore: 500,
      profile: { level: "expert" },
      customScenarios: [{ isCustom: true }],
      reviewQueue: [{ nextReviewDate: null }],
    });

    expect(migrated.sessionsCompleted).toBe(0);
    expect(migrated.confidenceScore).toBe(100);
    expect(migrated.profile).toBeNull();
    expect(migrated.customScenarios).toEqual([]);
    expect(migrated.reviewQueue).toEqual([]);
  });
});

describe("journey progress", () => {
  it("builds a plan during onboarding and completes a matching mission", () => {
    const now = new Date(2026, 8, 28, 10);
    const started = beginJourney(defaultProgress, profile, now);
    const scenarioId = started.trainingPlan?.missions[0].scenarioId;
    const completed = completeSession(started, scenarioId, now);

    expect(
      completed.trainingPlan?.missions.filter((mission) => mission.completedAt),
    ).toHaveLength(1);
    expect(completed.sessionsCompleted).toBe(1);
  });

  it("adds review phrases once and updates skill scores", () => {
    const review: SessionReview = {
      id: "review-1",
      sessionId: "session-1",
      scenarioId: "daily",
      completedAt: "2026-09-28T10:00:00.000Z",
      durationSeconds: 240,
      overallScore: 80,
      skillScores: {
        tone: 70,
        wording: 80,
        flow: 75,
        confidence: 85,
        listening: 72,
      },
      summary: "Good work.",
      wins: ["Kept speaking."],
      nextSteps: ["Slow down."],
      phrases: [
        {
          original: "Original",
          improved: "Improved",
          englishHint: "Hint",
          focusArea: "wording",
        },
      ],
      source: "ai",
    };
    const once = addSessionReview(migrateProgress(defaultProgress), review);
    const twice = addSessionReview(once, { ...review, id: "review-2" });

    expect(once.reviewQueue).toHaveLength(1);
    expect(twice.reviewQueue).toHaveLength(1);
    expect(once.skillScores.wording).toBeGreaterThan(
      defaultProgress.skillScores.wording,
    );
  });
});
