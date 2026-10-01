"use client";

import { memo, useEffect, useState } from "react";
import { formatSessionDuration, getSessionMetrics, LIVE_USD_PER_MINUTE, type SessionUsage } from "@/lib/liveUsage";

export const SessionMeter = memo(function SessionMeter({ sessionUsage, previousMetrics, segmentCounted, paused }: {
  sessionUsage: SessionUsage;
  previousMetrics: { elapsedSeconds: number; costUsd: number };
  segmentCounted: boolean;
  paused: boolean;
}) {
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (sessionUsage.status !== "live" && sessionUsage.status !== "closing") return;
    setClock(performance.now());
    const timer = setInterval(() => setClock(performance.now()), 100);
    return () => clearInterval(timer);
  }, [sessionUsage.status]);
  const sessionMetrics = getSessionMetrics(sessionUsage, Math.max(clock, sessionUsage.startedAt ?? 0, sessionUsage.reportedAt ?? 0));
  const totalElapsed = previousMetrics.elapsedSeconds + (segmentCounted ? 0 : sessionMetrics.elapsedSeconds);
  const totalCost = previousMetrics.costUsd + (segmentCounted ? 0 : sessionMetrics.costUsd);
  return (
          <div className="session-meter" aria-label="Session duration and cost">
            <div>
              <span>Elapsed time</span>
              <strong>{formatSessionDuration(totalElapsed, true)}</strong>
            </div>
            <div>
              <span title="Total across resumed connections. Uses final API usage when available, otherwise estimates. Each new connection has a credited 15-second startup minimum.">Total cost (API / estimate)</span>
              <strong>${totalCost.toFixed(6)} <small>USD</small></strong>
            </div>
            <div>
              <span>Latest connection API duration</span>
              <strong>{sessionUsage.reportedSeconds === null ? "Awaiting usage" : `${sessionUsage.reportedSeconds.toFixed(3)} s`}</strong>
            </div>
            <div>
              <span>Latest connection API cost</span>
              <strong>{sessionMetrics.reportedCostUsd === null ? "—" : `$${sessionMetrics.reportedCostUsd.toFixed(6)}`} <small>USD</small></strong>
            </div>
            <p>
              <a href="https://developers.openai.com/api/docs/models/gpt-live-1" target="_blank" rel="noreferrer">
                GPT-Live 1 · ${LIVE_USD_PER_MINUTE.toFixed(2)}/min
              </a>
              {paused ? " · Session closed; paused time is excluded"
                : sessionUsage.status === "confirmed" ? " · Final voice usage received"
                : sessionUsage.status === "closing" ? " · Waiting for final usage…"
                : sessionUsage.status === "unconfirmed" ? " · Final usage unavailable; estimate only"
                : " · Running cost is estimated; API usage can arrive later"}
            </p>
          </div>
  );
});
