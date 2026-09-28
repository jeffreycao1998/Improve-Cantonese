"use client";

import { ArrowRight, Check, Target } from "lucide-react";
import { useState } from "react";
import type { LearnerLevel, LearnerProfile, LearningGoal } from "@/lib/types";

const goalOptions: Array<{ id: LearningGoal; label: string; detail: string }> =
  [
    {
      id: "family",
      label: "Talk with family",
      detail: "Warm, casual conversations",
    },
    {
      id: "travel",
      label: "Travel confidently",
      detail: "Food, directions, and quick decisions",
    },
    {
      id: "daily-life",
      label: "Handle daily life",
      detail: "Useful everyday exchanges",
    },
    {
      id: "confidence",
      label: "Speak without freezing",
      detail: "Faster, more comfortable answers",
    },
    {
      id: "listening",
      label: "Understand more",
      detail: "Repair strategies and listening practice",
    },
  ];

const levelOptions: Array<{ id: LearnerLevel; label: string; detail: string }> =
  [
    {
      id: "beginner",
      label: "Beginner",
      detail: "I know a few words or phrases",
    },
    {
      id: "heritage",
      label: "Heritage speaker",
      detail: "I understand more than I can say",
    },
    {
      id: "intermediate",
      label: "Intermediate",
      detail: "I can talk, but want to sound natural",
    },
  ];

type OnboardingProps = {
  onComplete: (profile: LearnerProfile) => void;
};

export function Onboarding({ onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LearnerLevel>("heritage");
  const [goals, setGoals] = useState<LearningGoal[]>(["confidence", "family"]);
  const [dailyMinutes, setDailyMinutes] = useState<5 | 10 | 15>(10);

  function toggleGoal(goal: LearningGoal) {
    setGoals((current) =>
      current.includes(goal)
        ? current.filter((item) => item !== goal)
        : [...current, goal],
    );
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-intro">
          <div className="brand-mark">
            <Target size={26} aria-hidden="true" />
          </div>
          <p className="eyebrow">Cantonese Training Journey</p>
          <h1 id="onboarding-title">
            Build a plan around the conversations you want.
          </h1>
          <p>
            Tell the coach where you are starting. You will get a seven-day
            speaking plan, focused feedback, and phrases that return when they
            are worth practicing again.
          </p>
        </div>

        <form
          className="onboarding-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!goals.length) {
              return;
            }
            onComplete({
              name: name.trim(),
              level,
              goals,
              dailyMinutes,
              createdAt: new Date().toISOString(),
            });
          }}
        >
          <label className="field-label" htmlFor="learner-name">
            What should the coach call you? <span>Optional</span>
          </label>
          <input
            className="text-input"
            id="learner-name"
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            value={name}
          />

          <fieldset>
            <legend>Which description fits best?</legend>
            <div className="choice-grid three-up">
              {levelOptions.map((option) => (
                <button
                  aria-pressed={level === option.id}
                  className={`choice-card ${level === option.id ? "selected" : ""}`}
                  key={option.id}
                  onClick={() => setLevel(option.id)}
                  type="button"
                >
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                  {level === option.id ? (
                    <Check size={17} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>What do you want to improve?</legend>
            <div className="choice-grid goals-grid">
              {goalOptions.map((option) => {
                const selected = goals.includes(option.id);
                return (
                  <button
                    aria-pressed={selected}
                    className={`choice-card ${selected ? "selected" : ""}`}
                    key={option.id}
                    onClick={() => toggleGoal(option.id)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.detail}</span>
                    {selected ? <Check size={17} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend>Daily practice target</legend>
            <div className="duration-picker">
              {([5, 10, 15] as const).map((minutes) => (
                <button
                  aria-pressed={dailyMinutes === minutes}
                  className={dailyMinutes === minutes ? "selected" : ""}
                  key={minutes}
                  onClick={() => setDailyMinutes(minutes)}
                  type="button"
                >
                  <strong>{minutes}</strong>
                  <span>minutes</span>
                </button>
              ))}
            </div>
          </fieldset>

          {!goals.length ? (
            <p className="form-error">Choose at least one goal.</p>
          ) : null}
          <button
            className="primary-button onboarding-submit"
            disabled={!goals.length}
            type="submit"
          >
            Build my plan
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  );
}
