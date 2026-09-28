"use client";

import {
  BarChart3,
  CalendarDays,
  Clock3,
  Download,
  History,
  Play,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SessionReviewCard } from "@/components/SessionReviewCard";
import { buildSessionHistoryCsv, summarizeSessions } from "@/lib/insights";
import type { PracticeScenario, SessionReview, SkillArea } from "@/lib/types";

type SessionHistoryProps = {
  reviews: SessionReview[];
  scenarios: PracticeScenario[];
  onPracticeAgain: (scenarioId: PracticeScenario["id"]) => void;
};

const skillLabels: Record<SkillArea, string> = {
  tone: "Tone",
  wording: "Natural wording",
  flow: "Flow",
  confidence: "Confidence",
  listening: "Listening",
};

function formatDate(value: string, includeYear = false) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

export function SessionHistory({
  reviews,
  scenarios,
  onPracticeAgain,
}: SessionHistoryProps) {
  const [scenarioFilter, setScenarioFilter] = useState("all");
  const filteredReviews = useMemo(
    () =>
      scenarioFilter === "all"
        ? reviews
        : reviews.filter((review) => review.scenarioId === scenarioFilter),
    [reviews, scenarioFilter],
  );
  const insights = useMemo(
    () => summarizeSessions(filteredReviews),
    [filteredReviews],
  );
  const chartReviews = filteredReviews.slice(0, 10).reverse();
  const reviewedScenarioIds = new Set(
    reviews.map((review) => review.scenarioId),
  );
  const filterScenarios = scenarios.filter((scenario) =>
    reviewedScenarioIds.has(scenario.id),
  );

  function scenarioTitle(id: PracticeScenario["id"]) {
    return (
      scenarios.find((scenario) => scenario.id === id)?.title ??
      "Archived scenario"
    );
  }

  function downloadHistory() {
    const scenarioTitles = Object.fromEntries(
      scenarios.map((scenario) => [scenario.id, scenario.title]),
    );
    const csv = buildSessionHistoryCsv(filteredReviews, scenarioTitles);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cantonese-session-history-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section
      className="journey-page history-page"
      aria-labelledby="history-title"
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">Practice history</p>
          <h2 id="history-title">See how your speaking is changing.</h2>
          <p>
            Compare coach reports, spot trends, and jump back into a scenario
            that needs another turn.
          </p>
        </div>
        <div className="history-heading-actions">
          <label className="history-filter">
            <span>Scenario</span>
            <select
              onChange={(event) => setScenarioFilter(event.target.value)}
              value={scenarioFilter}
            >
              <option value="all">All scenarios</option>
              {filterScenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={!filteredReviews.length}
            onClick={downloadHistory}
            type="button"
          >
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      {filteredReviews.length ? (
        <>
          <div className="history-metrics">
            <article>
              <BarChart3 size={19} aria-hidden="true" />
              <div>
                <strong>{insights.averageScore}</strong>
                <span>average score</span>
              </div>
            </article>
            <article>
              <Clock3 size={19} aria-hidden="true" />
              <div>
                <strong>{insights.totalMinutes}</strong>
                <span>minutes practiced</span>
              </div>
            </article>
            <article>
              <TrendingUp size={19} aria-hidden="true" />
              <div>
                <strong>
                  {insights.bestSkill ? skillLabels[insights.bestSkill] : "—"}
                </strong>
                <span>strongest skill</span>
              </div>
            </article>
            <article>
              <CalendarDays size={19} aria-hidden="true" />
              <div>
                <strong>
                  {insights.scoreChange === null
                    ? "—"
                    : `${insights.scoreChange >= 0 ? "+" : ""}${insights.scoreChange}`}
                </strong>
                <span>score change</span>
              </div>
            </article>
          </div>

          <section
            className="history-chart-card"
            aria-labelledby="score-trend-title"
          >
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Last {chartReviews.length} sessions</p>
                <h3 id="score-trend-title">Score trend</h3>
              </div>
            </div>
            <div
              className="score-chart"
              role="img"
              aria-label={`Session scores from ${chartReviews[0]?.overallScore} to ${chartReviews.at(-1)?.overallScore}`}
            >
              <div className="chart-guide guide-high">
                <span>100</span>
              </div>
              <div className="chart-guide guide-mid">
                <span>50</span>
              </div>
              {chartReviews.map((review) => (
                <div
                  className="score-column"
                  key={review.id}
                  title={`${scenarioTitle(review.scenarioId)}: ${review.overallScore}`}
                >
                  <div>
                    <i style={{ height: `${review.overallScore}%` }}>
                      <span>{review.overallScore}</span>
                    </i>
                  </div>
                  <time dateTime={review.completedAt}>
                    {formatDate(review.completedAt)}
                  </time>
                </div>
              ))}
            </div>
          </section>

          <section className="history-list" aria-labelledby="reports-title">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Coach reports</p>
                <h3 id="reports-title">Every reviewed session</h3>
              </div>
              <span>{filteredReviews.length} reports</span>
            </div>
            {filteredReviews.map((review, index) => (
              <details key={review.id} open={index === 0}>
                <summary>
                  <div className="history-score">{review.overallScore}</div>
                  <div>
                    <strong>{scenarioTitle(review.scenarioId)}</strong>
                    <span>
                      {formatDate(review.completedAt, true)} ·{" "}
                      {formatDuration(review.durationSeconds)}
                    </span>
                  </div>
                  <span className="history-source">
                    {review.source === "ai" ? "AI review" : "Local review"}
                  </span>
                </summary>
                <div className="history-detail">
                  <SessionReviewCard review={review} />
                  {review.phrases.length ? (
                    <div className="history-phrases">
                      <h4>Corrections saved from this session</h4>
                      {review.phrases.map((phrase) => (
                        <div key={`${phrase.improved}-${phrase.focusArea}`}>
                          <span>{phrase.focusArea}</span>
                          <p>{phrase.improved}</p>
                          <small>{phrase.englishHint}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <button
                    className="primary-button"
                    disabled={
                      !scenarios.some(
                        (scenario) => scenario.id === review.scenarioId,
                      )
                    }
                    onClick={() => onPracticeAgain(review.scenarioId)}
                    type="button"
                  >
                    <Play size={16} aria-hidden="true" /> Practice this scenario
                    again
                  </button>
                </div>
              </details>
            ))}
          </section>
        </>
      ) : (
        <div className="empty-state large history-empty">
          <History size={30} aria-hidden="true" />
          <h3>
            {reviews.length
              ? "No sessions match this filter"
              : "Your history starts with one conversation"}
          </h3>
          <p>
            {reviews.length
              ? "Choose another scenario to see its coach reports."
              : "Complete a speaking session and its score, feedback, and saved corrections will appear here."}
          </p>
        </div>
      )}
    </section>
  );
}
