import type { LocalProgress, PracticeTurnFeedback } from "@/lib/types";
import type { PracticeLanguage } from "@/lib/languages";

export const progressStorageKey = "cantonese-speaking-coach-progress-v1";

export const defaultProgress: LocalProgress = {
  sessionsCompleted: 0,
  streak: 0,
  lastPracticeDate: null,
  confidenceScore: 54,
  recentFeedback: [],
  weakAreas: ["sentence rhythm", "repair phrases", "natural wording"]
};

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function yesterdayKey(date = new Date()) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - 1);
  return todayKey(copy);
}

export function loadProgress(language: PracticeLanguage = "cantonese"): LocalProgress {
  if (typeof window === "undefined") {
    return defaultProgress;
  }

  const stored = window.localStorage.getItem(language === "mandarin" ? "mandarin-speaking-coach-progress-v1" : progressStorageKey);
  if (!stored) {
    return defaultProgress;
  }

  try {
    return {
      ...defaultProgress,
      ...(JSON.parse(stored) as Partial<LocalProgress>)
    };
  } catch {
    return defaultProgress;
  }
}

export function saveProgress(progress: LocalProgress, language: PracticeLanguage = "cantonese") {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(language === "mandarin" ? "mandarin-speaking-coach-progress-v1" : progressStorageKey, JSON.stringify(progress));
}

export function recordFeedback(progress: LocalProgress, feedback: PracticeTurnFeedback) {
  const recentFeedback = [feedback, ...progress.recentFeedback].slice(0, 8);
  const weakAreas = Array.from(new Set([feedback.focusArea, ...progress.weakAreas])).slice(0, 5);

  return {
    ...progress,
    confidenceScore: Math.max(0, Math.min(100, progress.confidenceScore + feedback.confidenceDelta)),
    recentFeedback,
    weakAreas
  };
}

export function completeSession(progress: LocalProgress) {
  const today = todayKey();
  const lastPracticeDate = progress.lastPracticeDate;
  const practicedToday = lastPracticeDate === today;
  const streak = practicedToday
    ? progress.streak
    : lastPracticeDate === yesterdayKey()
      ? progress.streak + 1
      : 1;

  return {
    ...progress,
    sessionsCompleted: progress.sessionsCompleted + 1,
    streak,
    lastPracticeDate: today,
    confidenceScore: Math.min(100, progress.confidenceScore + 2)
  };
}
