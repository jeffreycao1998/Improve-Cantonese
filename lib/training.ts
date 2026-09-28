import type {
  LearnerProfile,
  PracticeScenario,
  PracticeSession,
  ReviewPhrase,
  SessionReview,
  SkillArea,
  SkillScores,
  TrainingPlan,
} from "@/lib/types";

export const skillAreas: SkillArea[] = [
  "tone",
  "wording",
  "flow",
  "confidence",
  "listening",
];

const goalScenarios: Record<
  LearnerProfile["goals"][number],
  PracticeScenario["id"][]
> = {
  family: ["family", "daily", "food"],
  travel: ["directions", "food", "repair"],
  "daily-life": ["daily", "small-talk", "food"],
  confidence: ["small-talk", "repair", "daily"],
  listening: ["repair", "directions", "family"],
};

const goalFocus: Record<LearnerProfile["goals"][number], SkillArea[]> = {
  family: ["wording", "flow"],
  travel: ["listening", "confidence"],
  "daily-life": ["flow", "wording"],
  confidence: ["confidence", "flow"],
  listening: ["listening", "tone"],
};

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function createTrainingPlan(
  profile: LearnerProfile,
  now = new Date(),
): TrainingPlan {
  const scenarioSequence = Array.from(
    new Set(profile.goals.flatMap((goal) => goalScenarios[goal])),
  );
  const focusSequence = Array.from(
    new Set(profile.goals.flatMap((goal) => goalFocus[goal])),
  );
  const scenarios = scenarioSequence.length
    ? scenarioSequence
    : goalScenarios["daily-life"];
  const focuses = focusSequence.length ? focusSequence : skillAreas;
  const firstDuration = Math.floor(profile.dailyMinutes / 2);
  const secondDuration = profile.dailyMinutes - firstDuration;
  const startsOn = dateKey(now);

  return {
    id: `plan-${startsOn}-${profile.goals.join("-")}`,
    generatedAt: now.toISOString(),
    startsOn,
    missions: Array.from({ length: 7 }).flatMap((_, dayIndex) => {
      const date = dateKey(addDays(now, dayIndex));
      return [0, 1].map((missionIndex) => {
        const sequenceIndex = dayIndex * 2 + missionIndex;
        const scenarioId = scenarios[sequenceIndex % scenarios.length];
        const focusArea = focuses[sequenceIndex % focuses.length];
        return {
          id: `${date}-${missionIndex}-${scenarioId}`,
          date,
          scenarioId,
          title: missionIndex === 0 ? "Core conversation" : "Focused follow-up",
          focusArea,
          durationMinutes: missionIndex === 0 ? firstDuration : secondDuration,
          completedAt: null,
        };
      });
    }),
  };
}

export function markMissionComplete(
  plan: TrainingPlan | null,
  scenarioId: PracticeScenario["id"],
  completedAt = new Date(),
) {
  if (!plan) {
    return null;
  }

  const today = dateKey(completedAt);
  const candidate =
    plan.missions.find(
      (mission) =>
        !mission.completedAt &&
        mission.scenarioId === scenarioId &&
        mission.date === today,
    ) ??
    plan.missions.find(
      (mission) =>
        !mission.completedAt &&
        mission.scenarioId === scenarioId &&
        mission.date <= today,
    );

  if (!candidate) {
    return plan;
  }

  return {
    ...plan,
    missions: plan.missions.map((mission) =>
      mission.id === candidate.id
        ? { ...mission, completedAt: completedAt.toISOString() }
        : mission,
    ),
  };
}

function feedbackScores(session: PracticeSession): SkillScores {
  const counts = Object.fromEntries(
    skillAreas.map((area) => [area, 0]),
  ) as Record<SkillArea, number>;
  session.turns.forEach((turn) => {
    counts[turn.focusArea] += 1;
  });

  const turnBonus = Math.min(18, session.turns.length * 3);
  return Object.fromEntries(
    skillAreas.map((area) => [
      area,
      clampScore(72 + turnBonus - counts[area] * 6),
    ]),
  ) as SkillScores;
}

export function buildLocalReview(
  session: PracticeSession,
  scenario: PracticeScenario,
  now = new Date(),
): SessionReview {
  const skillScores = feedbackScores(session);
  const learnerTurns = session.transcript.filter(
    (line) => line.speaker === "learner",
  ).length;
  const phrases = session.turns
    .filter((turn) => turn.naturalRewrite)
    .slice(0, 5)
    .map((turn) => ({
      original: turn.summary,
      improved: turn.naturalRewrite ?? turn.summary,
      englishHint: `Practice a more natural response for ${scenario.title.toLowerCase()}.`,
      focusArea: turn.focusArea,
    }));
  const overallScore = clampScore(
    skillAreas.reduce((sum, area) => sum + skillScores[area], 0) /
      skillAreas.length,
  );

  return {
    id: `review-${session.id}`,
    sessionId: session.id,
    scenarioId: session.scenarioId,
    completedAt: now.toISOString(),
    durationSeconds: Math.max(
      1,
      Math.round(
        (now.getTime() - new Date(session.startedAt).getTime()) / 1000,
      ),
    ),
    overallScore,
    skillScores,
    summary:
      learnerTurns > 0
        ? `You completed ${learnerTurns} spoken turn${learnerTurns === 1 ? "" : "s"} in ${scenario.title}. Keep the next session focused and conversational.`
        : `This ${scenario.title} session ended before a spoken turn was captured. Try it again for a more useful review.`,
    wins:
      learnerTurns > 0
        ? [
            "You stayed in the conversation and completed a live speaking session.",
          ]
        : [],
    nextSteps: [
      `Repeat ${scenario.accentFocus[0] ?? "one short answer"} in the next session.`,
      "Aim for one more complete spoken turn next time.",
    ],
    phrases,
    source: "local",
  };
}

export function mergeSkillScores(
  current: SkillScores,
  incoming: SkillScores,
): SkillScores {
  return Object.fromEntries(
    skillAreas.map((area) => [
      area,
      clampScore(current[area] * 0.65 + incoming[area] * 0.35),
    ]),
  ) as SkillScores;
}

export function phrasesFromReview(review: SessionReview): ReviewPhrase[] {
  return review.phrases.map((phrase, index) => ({
    ...phrase,
    id: `${review.id}-phrase-${index}`,
    sourceReviewId: review.id,
    scenarioId: review.scenarioId,
    repetitions: 0,
    intervalDays: 1,
    ease: 2.5,
    nextReviewDate: dateKey(addDays(new Date(review.completedAt), 1)),
    lastPracticedAt: null,
  }));
}

export function rateReviewPhrase(
  phrase: ReviewPhrase,
  rating: "again" | "good" | "easy",
  now = new Date(),
): ReviewPhrase {
  if (rating === "again") {
    return {
      ...phrase,
      repetitions: 0,
      intervalDays: 1,
      ease: Math.max(1.3, phrase.ease - 0.2),
      nextReviewDate: dateKey(addDays(now, 1)),
      lastPracticedAt: now.toISOString(),
    };
  }

  const repetitions = phrase.repetitions + 1;
  const ease =
    rating === "easy" ? Math.min(3, phrase.ease + 0.15) : phrase.ease;
  const intervalDays =
    repetitions === 1
      ? rating === "easy"
        ? 4
        : 2
      : Math.max(
          2,
          Math.round(
            phrase.intervalDays * (rating === "easy" ? ease + 0.35 : ease),
          ),
        );

  return {
    ...phrase,
    repetitions,
    intervalDays,
    ease,
    nextReviewDate: dateKey(addDays(now, intervalDays)),
    lastPracticedAt: now.toISOString(),
  };
}
