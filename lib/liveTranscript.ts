import type { LiveEvent } from "@/lib/liveSession";

export type TranscriptFragment = {
  id?: string;
  speaker: "coach" | "learner";
  text: string;
  startMs: number;
  endMs: number;
};

export function addTranscriptFragment(fragments: TranscriptFragment[], event: LiveEvent): TranscriptFragment[] {
  const speaker = event.type === "session.input_transcript.delta" ? "learner"
    : event.type === "session.output_transcript.delta" ? "coach" : null;
  if (!speaker || typeof event.delta !== "string") return fragments;
  if (event.event_id && fragments.some((fragment) => fragment.id === event.event_id)) return fragments;
  const previousEnd = fragments.filter((fragment) => fragment.speaker === speaker).at(-1)?.endMs ?? 0;
  const startMs = event.start_ms ?? previousEnd;
  return [...fragments, {
    id: event.event_id,
    speaker,
    text: event.delta,
    startMs,
    endMs: event.end_ms ?? startMs
  }];
}

export function getSpeakerText(fragments: TranscriptFragment[], speaker: TranscriptFragment["speaker"]) {
  return fragments.filter((fragment) => fragment.speaker === speaker)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((fragment) => fragment.text).join("");
}

export function getLatestCaption(fragments: TranscriptFragment[], speaker: TranscriptFragment["speaker"], maxCharacters = 600) {
  const ordered = fragments.filter((fragment) => fragment.speaker === speaker)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let text = "";
  let lastEnd = 0;
  for (const fragment of ordered) {
    // This gap groups captions for display; it does not mark a completed turn.
    if (fragment.startMs - lastEnd > 2_000) text = "";
    text += fragment.text;
    lastEnd = Math.max(lastEnd, fragment.endMs);
  }
  // Bound the visible text and pronunciation DOM; full history stays in fragments.
  return text.length > maxCharacters ? "…" + text.slice(-maxCharacters) : text;
}
