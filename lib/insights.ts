import { skillAreas } from "@/lib/training";
import type { PracticeScenario, SessionReview, SkillArea } from "@/lib/types";

export type SessionInsights = {
  averageScore: number;
  totalMinutes: number;
  bestSkill: SkillArea | null;
  scoreChange: number | null;
};

export function summarizeSessions(reviews: SessionReview[]): SessionInsights {
  if (!reviews.length) {
    return {
      averageScore: 0,
      totalMinutes: 0,
      bestSkill: null,
      scoreChange: null,
    };
  }

  const averageScore = Math.round(
    reviews.reduce((sum, review) => sum + review.overallScore, 0) /
      reviews.length,
  );
  const totalMinutes = Math.round(
    reviews.reduce((sum, review) => sum + review.durationSeconds, 0) / 60,
  );
  const skillAverages = skillAreas.map((skill) => ({
    skill,
    score:
      reviews.reduce((sum, review) => sum + review.skillScores[skill], 0) /
      reviews.length,
  }));
  const bestSkill = skillAverages.reduce((best, current) =>
    current.score > best.score ? current : best,
  ).skill;
  const chronological = [...reviews].sort(
    (left, right) =>
      new Date(right.completedAt).getTime() -
      new Date(left.completedAt).getTime(),
  );
  const scoreChange =
    reviews.length > 1
      ? chronological[0].overallScore -
        chronological[chronological.length - 1].overallScore
      : null;

  return {
    averageScore,
    totalMinutes,
    bestSkill,
    scoreChange,
  };
}

function csvCell(value: string | number) {
  const text = String(value);
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function buildSessionHistoryCsv(
  reviews: SessionReview[],
  scenarioTitles: Partial<Record<PracticeScenario["id"], string>>,
) {
  const headers = [
    "completed_at",
    "scenario",
    "duration_minutes",
    "overall_score",
    "tone",
    "wording",
    "flow",
    "confidence",
    "listening",
    "review_source",
    "summary",
  ];
  const rows = reviews.map((review) => [
    review.completedAt,
    scenarioTitles[review.scenarioId] ?? "Archived scenario",
    (review.durationSeconds / 60).toFixed(1),
    review.overallScore,
    review.skillScores.tone,
    review.skillScores.wording,
    review.skillScores.flow,
    review.skillScores.confidence,
    review.skillScores.listening,
    review.source,
    review.summary,
  ]);

  return [headers, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\n");
}
