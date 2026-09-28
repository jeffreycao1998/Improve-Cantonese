"use client";

import {
  CalendarDays,
  Check,
  Download,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { SessionReviewCard } from "@/components/SessionReviewCard";
import { dateKey, skillAreas } from "@/lib/training";
import type { LocalProgress, PracticeScenario, SkillArea } from "@/lib/types";

type JourneyDashboardProps = {
  progress: LocalProgress;
  scenarios: PracticeScenario[];
  onStartScenario: (
    scenarioId: PracticeScenario["id"],
    instruction?: string,
  ) => void;
  onAddCustomScenario: (scenario: PracticeScenario) => void;
  onRemoveCustomScenario: (scenarioId: PracticeScenario["id"]) => void;
  onImport: (serialized: string) => void;
  onEditProfile: () => void;
};

const skillLabels: Record<SkillArea, string> = {
  tone: "Tone",
  wording: "Natural wording",
  flow: "Flow",
  confidence: "Confidence",
  listening: "Listening",
};

function formatPlanDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function downloadProgress(progress: LocalProgress) {
  const blob = new Blob([JSON.stringify(progress, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cantonese-training-${dateKey()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function JourneyDashboard({
  progress,
  scenarios,
  onStartScenario,
  onAddCustomScenario,
  onRemoveCustomScenario,
  onImport,
  onEditProfile,
}: JourneyDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customSituation, setCustomSituation] = useState("");
  const [customGoal, setCustomGoal] = useState("");
  const [customPrompts, setCustomPrompts] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const plan = progress.trainingPlan;
  const today = dateKey();
  const todaysMissions =
    plan?.missions.filter((mission) => mission.date === today) ?? [];
  const completed =
    plan?.missions.filter((mission) => mission.completedAt).length ?? 0;
  const groupedMissions =
    plan?.missions.reduce<Record<string, typeof plan.missions>>(
      (groups, mission) => {
        groups[mission.date] = [...(groups[mission.date] ?? []), mission];
        return groups;
      },
      {},
    ) ?? {};

  function scenarioTitle(id: PracticeScenario["id"]) {
    return (
      scenarios.find((scenario) => scenario.id === id)?.title ??
      "Conversation practice"
    );
  }

  return (
    <section className="journey-page" aria-labelledby="journey-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your training journey</p>
          <h2 id="journey-title">
            {progress.profile?.name
              ? `${progress.profile.name}'s plan`
              : "Your seven-day plan"}
          </h2>
          <p>
            {completed} of {plan?.missions.length ?? 0} missions complete. Each
            finished conversation updates the next review queue.
          </p>
        </div>
        <div className="journey-actions">
          <button
            className="secondary-button"
            onClick={onEditProfile}
            type="button"
          >
            Edit goals
          </button>
          <button
            className="secondary-button"
            onClick={() => downloadProgress(progress)}
            type="button"
          >
            <Download size={16} aria-hidden="true" /> Export
          </button>
          <button
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Upload size={16} aria-hidden="true" /> Import
          </button>
          <input
            accept="application/json"
            className="visually-hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                onImport(await file.text());
                setImportError(null);
              } catch (error) {
                setImportError(
                  error instanceof Error
                    ? error.message
                    : "Could not import progress.",
                );
              } finally {
                event.target.value = "";
              }
            }}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </div>
      {importError ? (
        <p className="form-error" role="alert">
          {importError}
        </p>
      ) : null}

      <div className="dashboard-grid">
        <section
          className="dashboard-card today-card"
          aria-labelledby="today-title"
        >
          <div className="card-heading">
            <Target size={19} aria-hidden="true" />
            <h3 id="today-title">Today&apos;s missions</h3>
          </div>
          <div className="mission-list">
            {todaysMissions.map((mission) => (
              <article
                className={
                  mission.completedAt ? "mission completed" : "mission"
                }
                key={mission.id}
              >
                <div className="mission-state">
                  {mission.completedAt ? (
                    <Check size={18} aria-hidden="true" />
                  ) : (
                    <span />
                  )}
                </div>
                <div>
                  <strong>{scenarioTitle(mission.scenarioId)}</strong>
                  <p>
                    {mission.focusArea} · {mission.durationMinutes} min
                  </p>
                </div>
                {!mission.completedAt ? (
                  <button
                    onClick={() => onStartScenario(mission.scenarioId)}
                    type="button"
                  >
                    Start
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section
          className="dashboard-card skills-card"
          aria-labelledby="skills-title"
        >
          <div className="card-heading">
            <TrendingUp size={19} aria-hidden="true" />
            <h3 id="skills-title">Skill profile</h3>
          </div>
          <div className="skill-bars">
            {skillAreas.map((skill) => (
              <div key={skill}>
                <span>
                  <strong>{skillLabels[skill]}</strong>
                  <small>{progress.skillScores[skill]}</small>
                </span>
                <div
                  className="skill-track"
                  role="progressbar"
                  aria-label={skillLabels[skill]}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress.skillScores[skill]}
                >
                  <i style={{ width: `${progress.skillScores[skill]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="week-section" aria-labelledby="week-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">The week ahead</p>
            <h3 id="week-title">Training calendar</h3>
          </div>
          <CalendarDays size={22} aria-hidden="true" />
        </div>
        <div className="week-grid">
          {Object.entries(groupedMissions).map(([date, missions]) => (
            <article
              className={date === today ? "day-card current" : "day-card"}
              key={date}
            >
              <time dateTime={date}>{formatPlanDate(date)}</time>
              {missions.map((mission) => (
                <div
                  className={
                    mission.completedAt ? "day-mission done" : "day-mission"
                  }
                  key={mission.id}
                >
                  <span>
                    {mission.completedAt ? (
                      <Check size={13} aria-hidden="true" />
                    ) : null}
                  </span>
                  <div>
                    <strong>{scenarioTitle(mission.scenarioId)}</strong>
                    <small>{mission.focusArea}</small>
                  </div>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      {progress.sessionReviews[0] ? (
        <section
          className="latest-review"
          aria-labelledby="latest-review-title"
        >
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Most recent session</p>
              <h3 id="latest-review-title">Coach report</h3>
            </div>
          </div>
          <SessionReviewCard review={progress.sessionReviews[0]} />
        </section>
      ) : null}

      <section className="custom-section" aria-labelledby="custom-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Make it personal</p>
            <h3 id="custom-title">Custom scenarios</h3>
          </div>
          <button
            className="secondary-button"
            onClick={() => setShowCustomForm((value) => !value)}
            type="button"
          >
            <Plus size={16} aria-hidden="true" /> New scenario
          </button>
        </div>

        {showCustomForm ? (
          <form
            className="custom-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !customTitle.trim() ||
                !customSituation.trim() ||
                !customGoal.trim()
              )
                return;
              const id =
                `custom-${crypto.randomUUID()}` as PracticeScenario["id"];
              onAddCustomScenario({
                id,
                title: customTitle.trim(),
                situation: customSituation.trim(),
                coachGoal: `Roleplay this situation and keep the learner speaking: ${customSituation.trim()}`,
                learnerGoal: customGoal.trim(),
                level: "Everyday",
                accentFocus: ["natural wording", "confidence", "flow"],
                samplePrompts: customPrompts
                  .split("\n")
                  .map((prompt) => prompt.trim())
                  .filter(Boolean)
                  .slice(0, 5),
                isCustom: true,
                createdAt: new Date().toISOString(),
              });
              setCustomTitle("");
              setCustomSituation("");
              setCustomGoal("");
              setCustomPrompts("");
              setShowCustomForm(false);
            }}
          >
            <label>
              Scenario name
              <input
                maxLength={100}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder="Talk with my grandmother"
                required
                value={customTitle}
              />
            </label>
            <label>
              Situation
              <textarea
                maxLength={600}
                onChange={(event) => setCustomSituation(event.target.value)}
                placeholder="We are catching up on a Sunday call..."
                required
                value={customSituation}
              />
            </label>
            <label>
              Your goal
              <input
                maxLength={300}
                onChange={(event) => setCustomGoal(event.target.value)}
                placeholder="Explain my week without switching to English"
                required
                value={customGoal}
              />
            </label>
            <label>
              Sample prompts <span>One per line</span>
              <textarea
                maxLength={800}
                onChange={(event) => setCustomPrompts(event.target.value)}
                placeholder={"Ask what I ate today\nAsk about my weekend"}
                value={customPrompts}
              />
            </label>
            <button className="primary-button" type="submit">
              Save scenario
            </button>
          </form>
        ) : null}

        <div className="custom-scenario-list">
          {progress.customScenarios.map((scenario) => (
            <article key={scenario.id}>
              <div>
                <strong>{scenario.title}</strong>
                <p>{scenario.situation}</p>
              </div>
              <div>
                <button
                  className="secondary-button"
                  onClick={() => onStartScenario(scenario.id)}
                  type="button"
                >
                  Practice
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => onRemoveCustomScenario(scenario.id)}
                  title={`Delete ${scenario.title}`}
                  type="button"
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
          {!progress.customScenarios.length ? (
            <p className="empty-copy">
              Create a scenario for a real conversation coming up in your life.
            </p>
          ) : null}
        </div>
      </section>
    </section>
  );
}
