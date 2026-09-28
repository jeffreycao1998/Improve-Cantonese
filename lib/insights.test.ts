import { describe, expect, it } from "vitest";
import { buildSessionHistoryCsv, summarizeSessions } from "./insights";
import type { SessionReview } from "./types";

function makeReview(
  id: string,
  overallScore: number,
  durationSeconds: number,
  toneScore: number,
): SessionReview {
  return {
    id,
    sessionId: `session-${id}`,
    scenarioId: "daily",
    completedAt: `2026-09-${id === "new" ? "28" : "21"}T10:00:00.000Z`,
    durationSeconds,
    overallScore,
    skillScores: {
      tone: toneScore,
      wording: 60,
      flow: 70,
      confidence: 65,
      listening: 55,
    },
    summary: "Session summary",
    wins: [],
    nextSteps: [],
    phrases: [],
    source: "ai",
  };
}

describe("summarizeSessions", () => {
  it("returns an empty summary when no sessions have been reviewed", () => {
    expect(summarizeSessions([])).toEqual({
      averageScore: 0,
      totalMinutes: 0,
      bestSkill: null,
      scoreChange: null,
    });
  });

  it("summarizes scores, duration, strongest skill, and progress", () => {
    const insights = summarizeSessions([
      makeReview("new", 82, 360, 90),
      makeReview("old", 68, 240, 80),
    ]);

    expect(insights.averageScore).toBe(75);
    expect(insights.totalMinutes).toBe(10);
    expect(insights.bestSkill).toBe("tone");
    expect(insights.scoreChange).toBe(14);
  });

  it("calculates score progress by date instead of array position", () => {
    const insights = summarizeSessions([
      makeReview("old", 68, 240, 80),
      makeReview("new", 82, 360, 90),
    ]);

    expect(insights.scoreChange).toBe(14);
  });
});

describe("buildSessionHistoryCsv", () => {
  it("escapes punctuation and neutralizes spreadsheet formulas", () => {
    const review = {
      ...makeReview("new", 82, 360, 90),
      summary: '  =HYPERLINK("https://example.com")',
    };
    const csv = buildSessionHistoryCsv([review], {
      daily: 'Family, "weekly"',
    });

    expect(csv).toContain('"Family, ""weekly"""');
    expect(csv).toContain('"\'  =HYPERLINK(""https://example.com"")"');
    expect(csv.split("\n")).toHaveLength(2);
  });
});
