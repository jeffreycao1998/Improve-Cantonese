import { NextResponse } from "next/server";
import { buildCoachInstructions } from "@/lib/coachInstructions";
import { getScenario } from "@/lib/scenarios";
import { registerWatchdog } from "@/lib/server/sessionWatchdog";
import { CONVERSATION_SUMMARY_LIMIT } from "@/lib/conversationMemory";
import { isPracticeLanguage } from "@/lib/languages";
import { isPracticeMode } from "@/lib/practiceMode";

export const runtime = "nodejs";

const LIVE_MODEL = "gpt-live-1";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Missing OPENAI_API_KEY. Add it to .env.local and restart the dev server."
      },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.sdp !== "string" || !body.sdp.trim()) {
    return NextResponse.json({ error: "A WebRTC SDP offer is required." }, { status: 400 });
  }

  const language = body.language ?? "cantonese";
  if (!isPracticeLanguage(language)) return NextResponse.json({ error: "Unsupported practice language." }, { status: 400 });
  const mode = body.mode ?? "normal";
  if (!isPracticeMode(mode)) return NextResponse.json({ error: "Unsupported practice mode." }, { status: 400 });
  const scenario = getScenario(typeof body.scenarioId === "string" ? body.scenarioId : undefined, language);
  if (body.conversationSummary !== undefined && (typeof body.conversationSummary !== "string" || body.conversationSummary.length > CONVERSATION_SUMMARY_LIMIT)) {
    return NextResponse.json({ error: "Invalid conversation summary." }, { status: 400 });
  }
  const response = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "local-cantonese-speaking-coach"
    },
    body: JSON.stringify({
      session: {
        model: LIVE_MODEL,
        instructions: buildCoachInstructions(scenario, body.conversationSummary, language, mode),
        audio: { output: { voice: "marin" } }
      },
      transport: { type: "webrtc", sdp: body.sdp }
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Could not create a GPT-Live voice session.",
        detail:
          payload && typeof payload === "object" && "error" in payload
            ? (payload as { error: unknown }).error
            : payload
      },
      { status: response.status }
    );
  }

  const result = payload as { session?: { id?: string }; transport?: { sdp?: string } } | null;
  if (typeof result?.session?.id !== "string" || typeof result?.transport?.sdp !== "string") {
    return NextResponse.json(
      { error: "OpenAI did not return a usable GPT-Live WebRTC answer." },
      { status: 502 }
    );
  }
  let watchdog;
  try {
    watchdog = await registerWatchdog(result.session.id, apiKey);
  } catch {
    return NextResponse.json({ error: "The server watchdog could not connect. Session closure has been requested; please try again." }, { status: 502 });
  }
  return NextResponse.json({
    session: { id: result.session.id },
    transport: { type: "webrtc", sdp: result.transport.sdp },
    model: LIVE_MODEL,
    watchdog
  });
}
