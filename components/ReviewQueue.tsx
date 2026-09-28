"use client";

import { CalendarClock, MessageCircle, RotateCcw } from "lucide-react";
import { dateKey } from "@/lib/training";
import type { ReviewPhrase } from "@/lib/types";

type ReviewQueueProps = {
  phrases: ReviewPhrase[];
  onGrade: (phraseId: string, rating: "again" | "good" | "easy") => void;
  onPractice: (phrase: ReviewPhrase) => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export function ReviewQueue({
  phrases,
  onGrade,
  onPractice,
}: ReviewQueueProps) {
  const today = dateKey();
  const due = phrases.filter((phrase) => phrase.nextReviewDate <= today);
  const upcoming = phrases
    .filter((phrase) => phrase.nextReviewDate > today)
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));

  return (
    <section className="journey-page" aria-labelledby="review-queue-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Spaced repetition</p>
          <h2 id="review-queue-title">Phrase review</h2>
          <p>Bring useful corrections back before they fade.</p>
        </div>
        <div className="due-count">
          <strong>{due.length}</strong>
          <span>due today</span>
        </div>
      </div>

      {due.length ? (
        <div className="review-phrase-list">
          {due.map((phrase) => (
            <article className="review-phrase-card" key={phrase.id}>
              <div className="phrase-meta">
                <span>{phrase.focusArea}</span>
                <small>Seen {phrase.repetitions} times</small>
              </div>
              <p className="phrase-original">You said or heard</p>
              <blockquote>{phrase.original}</blockquote>
              <p className="phrase-original">Try this</p>
              <strong className="phrase-improved">{phrase.improved}</strong>
              <p className="phrase-hint">{phrase.englishHint}</p>
              <div className="phrase-actions">
                <button
                  className="secondary-button"
                  onClick={() => onPractice(phrase)}
                  type="button"
                >
                  <MessageCircle size={16} aria-hidden="true" /> Practice with
                  coach
                </button>
                <div className="grade-buttons" aria-label="Rate this phrase">
                  <button
                    onClick={() => onGrade(phrase.id, "again")}
                    type="button"
                  >
                    Again
                  </button>
                  <button
                    onClick={() => onGrade(phrase.id, "good")}
                    type="button"
                  >
                    Good
                  </button>
                  <button
                    onClick={() => onGrade(phrase.id, "easy")}
                    type="button"
                  >
                    Easy
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state large">
          <RotateCcw size={28} aria-hidden="true" />
          <h3>You are caught up</h3>
          <p>
            Complete a speaking session to collect phrases, or come back when
            the next review is due.
          </p>
        </div>
      )}

      {upcoming.length ? (
        <section className="upcoming-reviews" aria-labelledby="upcoming-title">
          <h3 id="upcoming-title">
            <CalendarClock size={18} aria-hidden="true" /> Coming up
          </h3>
          <div>
            {upcoming.slice(0, 8).map((phrase) => (
              <article key={phrase.id}>
                <span>{phrase.improved}</span>
                <time dateTime={phrase.nextReviewDate}>
                  {formatDate(phrase.nextReviewDate)}
                </time>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
