export type BuiltInScenarioId =
  "daily" | "food" | "directions" | "family" | "small-talk" | "repair";

export type ScenarioId = BuiltInScenarioId | `custom-${string}`;

export type SkillArea =
  "tone" | "wording" | "flow" | "confidence" | "listening";

export type LearnerLevel = "beginner" | "heritage" | "intermediate";

export type LearningGoal =
  "family" | "travel" | "daily-life" | "confidence" | "listening";

export type PracticeScenario = {
  id: ScenarioId;
  title: string;
  situation: string;
  coachGoal: string;
  learnerGoal: string;
  level: "Warm-up" | "Everyday" | "Stretch";
  accentFocus: string[];
  samplePrompts: string[];
  isCustom?: boolean;
  createdAt?: string;
};

export type PracticeTurnFeedback = {
  id: string;
  scenarioId: ScenarioId;
  createdAt: string;
  summary: string;
  naturalRewrite?: string;
  focusArea: SkillArea;
  confidenceDelta: number;
};

export type SessionTranscriptLine = {
  speaker: "coach" | "learner";
  text: string;
  createdAt: string;
};

export type PracticeSession = {
  id: string;
  scenarioId: ScenarioId;
  startedAt: string;
  endedAt?: string;
  turns: PracticeTurnFeedback[];
  transcript: SessionTranscriptLine[];
};

export type LearnerProfile = {
  name: string;
  level: LearnerLevel;
  goals: LearningGoal[];
  dailyMinutes: 5 | 10 | 15;
  createdAt: string;
};

export type SkillScores = Record<SkillArea, number>;

export type PracticeMission = {
  id: string;
  date: string;
  scenarioId: ScenarioId;
  title: string;
  focusArea: SkillArea;
  durationMinutes: number;
  completedAt: string | null;
};

export type TrainingPlan = {
  id: string;
  generatedAt: string;
  startsOn: string;
  missions: PracticeMission[];
};

export type ReviewPhrase = {
  id: string;
  sourceReviewId: string;
  scenarioId: ScenarioId;
  original: string;
  improved: string;
  englishHint: string;
  focusArea: SkillArea;
  repetitions: number;
  intervalDays: number;
  ease: number;
  nextReviewDate: string;
  lastPracticedAt: string | null;
};

export type SessionReview = {
  id: string;
  sessionId: string;
  scenarioId: ScenarioId;
  completedAt: string;
  durationSeconds: number;
  overallScore: number;
  skillScores: SkillScores;
  summary: string;
  wins: string[];
  nextSteps: string[];
  phrases: Array<
    Pick<ReviewPhrase, "original" | "improved" | "englishHint" | "focusArea">
  >;
  source: "ai" | "local";
};

export type LocalProgress = {
  schemaVersion: 2;
  sessionsCompleted: number;
  streak: number;
  lastPracticeDate: string | null;
  confidenceScore: number;
  recentFeedback: PracticeTurnFeedback[];
  weakAreas: string[];
  profile: LearnerProfile | null;
  trainingPlan: TrainingPlan | null;
  skillScores: SkillScores;
  sessionReviews: SessionReview[];
  reviewQueue: ReviewPhrase[];
  customScenarios: PracticeScenario[];
};

export type RealtimeSessionResponse = {
  client_secret: string;
  expires_at: number | null;
  model: string;
};

export type SessionReviewRequest = {
  session: PracticeSession;
  scenario: PracticeScenario;
  profile: LearnerProfile | null;
};
