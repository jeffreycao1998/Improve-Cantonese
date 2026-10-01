import type { TranscriptFragment } from "@/lib/liveTranscript";

export const CONVERSATION_SUMMARY_LIMIT = 12_000;

// Extractive memory avoids starting another paid model request to summarize.
// Keep the initial context and the latest discussion across repeated resumes.
export function summarizeConversation(previous: string, fragments: TranscriptFragment[]) {
  const lines: { speaker: string; text: string }[] = [];
  for (const fragment of [...fragments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const speaker = fragment.speaker === "coach" ? "Coach" : "Learner";
    const last = lines.at(-1);
    if (last?.speaker === speaker) last.text += fragment.text;
    else lines.push({ speaker, text: fragment.text });
  }
  const context = [previous, ...lines.map(line => `${line.speaker}: ${line.text.trim()}`)].filter(Boolean).join("\n");
  if (context.length <= CONVERSATION_SUMMARY_LIMIT) return context;
  const separator = "\n[Earlier discussion shortened]\n";
  return context.slice(0, 2000) + separator + context.slice(-(CONVERSATION_SUMMARY_LIMIT - 2000 - separator.length));
}
