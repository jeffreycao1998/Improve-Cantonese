import { CheckCircle2, Lightbulb, Sparkles } from "lucide-react";
import type { SessionReview } from "@/lib/types";

type SessionReviewCardProps = {
  review: SessionReview;
  compact?: boolean;
};

export function SessionReviewCard({
  review,
  compact = false,
}: SessionReviewCardProps) {
  return (
    <article className={`session-review-card ${compact ? "compact" : ""}`}>
      <div className="review-score">
        <span>{review.overallScore}</span>
        <small>session score</small>
      </div>
      <div className="review-copy">
        <div className="review-heading">
          <Sparkles size={18} aria-hidden="true" />
          <strong>
            {review.source === "ai" ? "Coach review" : "Quick local review"}
          </strong>
        </div>
        <p>{review.summary}</p>
        {!compact ? (
          <div className="review-columns">
            <div>
              <h3>
                <CheckCircle2 size={16} aria-hidden="true" /> Wins
              </h3>
              <ul>
                {review.wins.length ? (
                  review.wins.map((win) => <li key={win}>{win}</li>)
                ) : (
                  <li>Session completed.</li>
                )}
              </ul>
            </div>
            <div>
              <h3>
                <Lightbulb size={16} aria-hidden="true" /> Next steps
              </h3>
              <ul>
                {review.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
