export type ScenarioId =
  | "daily"
  | "food"
  | "directions"
  | "family"
  | "small-talk"
  | "repair";

export type PracticeScenario = {
  id: ScenarioId;
  title: string;
  situation: string;
  coachGoal: string;
  learnerGoal: string;
  level: "Warm-up" | "Everyday" | "Stretch";
  accentFocus: string[];
  samplePrompts: string[];
};

export type PracticeTurnFeedback = {
  id: string;
  scenarioId: ScenarioId;
  createdAt: string;
  summary: string;
  naturalRewrite?: string;
  focusArea: "tone" | "wording" | "flow" | "confidence" | "listening";
  confidenceDelta: number;
};

export type PracticeSession = {
  id: string;
  scenarioId: ScenarioId;
  startedAt: string;
  endedAt?: string;
  turns: PracticeTurnFeedback[];
};

export type LocalProgress = {
  sessionsCompleted: number;
  streak: number;
  lastPracticeDate: string | null;
  confidenceScore: number;
  recentFeedback: PracticeTurnFeedback[];
  weakAreas: string[];
};

export type RealtimeSessionResponse = {
  client_secret: string;
  expires_at: number | null;
  model: string;
};
