import type { LiveEvent } from "@/lib/liveSession";

// Verified against https://developers.openai.com/api/docs/models/gpt-live-1.
export const LIVE_USD_PER_MINUTE = 0.05;
export const WEBRTC_INITIAL_SECONDS = 15;

export type SessionUsage = {
  status: "idle" | "starting" | "live" | "closing" | "confirmed" | "unconfirmed";
  startedAt: number | null;
  endedAt: number | null;
  reportedSeconds: number | null;
  reportedAt: number | null;
  created: boolean;
};

export function emptySessionUsage(): SessionUsage {
  return { status: "idle", startedAt: null, endedAt: null, reportedSeconds: null, reportedAt: null, created: false };
}

export function updateSessionUsage(usage: SessionUsage, event: LiveEvent, now: number): SessionUsage {
  if (event.type === "session.created") return { ...usage, status: "starting", created: true };
  if (event.type === "session.started") return { ...usage, status: "live", startedAt: now, created: true };
  if (event.type === "session.close.requested") return { ...usage, status: "closing" };
  if (event.type === "connection.closed") {
    return usage.status === "confirmed" ? usage : { ...usage, status: "unconfirmed", endedAt: now };
  }
  const seconds = event.usage?.seconds;
  const valid = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0;
  if (event.type === "session.closed") {
    return {
      ...usage,
      status: valid ? "confirmed" : "unconfirmed",
      endedAt: now,
      reportedSeconds: valid ? seconds : usage.reportedSeconds,
      reportedAt: valid ? now : usage.reportedAt
    };
  }
  if (event.type === "session.usage.updated" && valid && usage.status !== "confirmed" && usage.status !== "unconfirmed") {
    // These are cumulative seconds, not increments. Ignore older snapshots.
    if (usage.reportedSeconds !== null && seconds < usage.reportedSeconds) return usage;
    return { ...usage, reportedSeconds: seconds, reportedAt: now };
  }
  return usage;
}

export function getSessionMetrics(usage: SessionUsage, now: number) {
  const end = usage.endedAt ?? now;
  const elapsedSeconds = usage.startedAt === null ? 0 : Math.max(0, (end - usage.startedAt) / 1000);
  const running = usage.status === "live" || usage.status === "closing";
  const reportedEstimate = usage.reportedSeconds === null ? elapsedSeconds
    : usage.reportedSeconds + (running && usage.reportedAt !== null ? Math.max(0, (end - usage.reportedAt) / 1000) : 0);
  // Initialization is credited against duration; never add 15 seconds to it.
  const billableSeconds = usage.status === "confirmed" ? usage.reportedSeconds ?? 0
    : Math.max(usage.created ? WEBRTC_INITIAL_SECONDS : 0, elapsedSeconds, reportedEstimate);
  return {
    elapsedSeconds,
    billableSeconds,
    costUsd: billableSeconds / 60 * LIVE_USD_PER_MINUTE,
    reportedCostUsd: usage.reportedSeconds === null ? null : usage.reportedSeconds / 60 * LIVE_USD_PER_MINUTE
  };
}

export function formatSessionDuration(seconds: number, precise = false) {
  const milliseconds = Math.floor(Math.max(0, seconds) * 1000);
  const total = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(total / 60);
  const duration = `${minutes.toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
  return precise ? `${duration}.${(milliseconds % 1000).toString().padStart(3, "0")}` : duration;
}
