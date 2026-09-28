import { describe, expect, it } from "vitest";
import {
  buildLocalReview,
  createTrainingPlan,
  dateKey,
  markMissionComplete,
  rateReviewPhrase,
} from "./training";
import type { LearnerProfile, PracticeSession, ReviewPhrase } from "./types";

const profile: LearnerProfile = {
  name: "Jeffrey",
  level: "heritage",
  goals: ["family", "confidence"],
  dailyMinutes: 10,
  createdAt: "2026-09-28T08:00:00.000Z",
};

describe("createTrainingPlan", () => {
  it("creates two missions per day for seven days", () => {
    const now = new Date(2026, 8, 28, 10);
    const plan = createTrainingPlan(profile, now);

    expect(plan.startsOn).toBe("2026-09-28");
    expect(plan.missions).toHaveLength(14);
    expect(new Set(plan.missions.map((mission) => mission.date))).toHaveLength(
      7,
    );
    expect(plan.missions.every((mission) => mission.completedAt === null)).toBe(
      true,
    );
  });

  it("keeps the configured daily duration across both missions", () => {
    const plan = createTrainingPlan(profile, new Date(2026, 8, 28, 10));
    const durationByDate = plan.missions.reduce<Record<string, number>>(
      (totals, mission) => {
        totals[mission.date] =
          (totals[mission.date] ?? 0) + mission.durationMinutes;
        return totals;
      },
      {},
    );

    expect(Object.values(durationByDate)).toEqual([10, 10, 10, 10, 10, 10, 10]);
  });
});

describe("markMissionComplete", () => {
  it("completes the matching mission for today without changing the others", () => {
    const now = new Date(2026, 8, 28, 10);
    const plan = createTrainingPlan(profile, now);
    const scenarioId = plan.missions[0].scenarioId;
    const updated = markMissionComplete(plan, scenarioId, now);

    expect(
      updated?.missions.filter((mission) => mission.completedAt),
    ).toHaveLength(1);
    expect(updated?.missions[0].completedAt).toBe(now.toISOString());
  });
});

describe("rateReviewPhrase", () => {
  const phrase: ReviewPhrase = {
    id: "phrase-1",
    sourceReviewId: "review-1",
    scenarioId: "family",
    original: "old",
    improved: "natural",
    englishHint: "A more natural answer",
    focusArea: "wording",
    repetitions: 0,
    intervalDays: 1,
    ease: 2.5,
    nextReviewDate: "2026-09-28",
    lastPracticedAt: null,
  };

  it("schedules an easy phrase further out", () => {
    const updated = rateReviewPhrase(phrase, "easy", new Date(2026, 8, 28, 10));
    expect(updated.repetitions).toBe(1);
    expect(updated.intervalDays).toBe(4);
    expect(updated.nextReviewDate).toBe("2026-10-02");
  });

  it("resets a missed phrase for tomorrow", () => {
    const updated = rateReviewPhrase(
      { ...phrase, repetitions: 3, intervalDays: 12 },
      "again",
      new Date(2026, 8, 28, 10),
    );
    expect(updated.repetitions).toBe(0);
    expect(updated.intervalDays).toBe(1);
    expect(updated.nextReviewDate).toBe("2026-09-29");
  });
});

describe("buildLocalReview", () => {
  it("creates a safe fallback when a remote review is unavailable", () => {
    const session: PracticeSession = {
      id: "session-1",
      scenarioId: "daily",
      startedAt: "2026-09-28T08:00:00.000Z",
      endedAt: "2026-09-28T08:05:00.000Z",
      transcript: [
        {
          speaker: "coach",
          text: "How was your day?",
          createdAt: "2026-09-28T08:00:01.000Z",
        },
        {
          speaker: "learner",
          text: "It was busy.",
          createdAt: "2026-09-28T08:00:05.000Z",
        },
      ],
      turns: [
        {
          id: "feedback-1",
          scenarioId: "daily",
          createdAt: "2026-09-28T08:00:06.000Z",
          summary: "Good answer.",
          naturalRewrite: "Try the natural version.",
          focusArea: "flow",
          confidenceDelta: 1,
        },
      ],
    };
    const review = buildLocalReview(
      session,
      {
        id: "daily",
        title: "Daily catch-up",
        situation: "Talk about the day.",
        coachGoal: "Keep talking.",
        learnerGoal: "Answer naturally.",
        level: "Warm-up",
        accentFocus: ["flow"],
        samplePrompts: [],
      },
      new Date("2026-09-28T08:05:00.000Z"),
    );

    expect(review.source).toBe("local");
    expect(review.phrases).toHaveLength(1);
    expect(dateKey(new Date(review.completedAt))).toBe("2026-09-28");
  });
});
