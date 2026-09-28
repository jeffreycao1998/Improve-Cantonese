import { NextResponse } from "next/server";
import { buildCoachInstructions } from "@/lib/coachInstructions";
import { getScenario } from "@/lib/scenarios";
import type { PracticeScenario } from "@/lib/types";

export const runtime = "nodejs";

const REALTIME_MODEL = "gpt-realtime-2";

type RequestBody = {
  scenarioId?: string;
  customScenario?: unknown;
};

function parseCustomScenario(value: unknown): PracticeScenario | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PracticeScenario>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.startsWith("custom-") ||
    typeof candidate.title !== "string" ||
    typeof candidate.situation !== "string" ||
    typeof candidate.coachGoal !== "string" ||
    typeof candidate.learnerGoal !== "string" ||
    !Array.isArray(candidate.accentFocus) ||
    !Array.isArray(candidate.samplePrompts)
  ) {
    return null;
  }

  return {
    id: candidate.id as PracticeScenario["id"],
    title: candidate.title.slice(0, 100),
    situation: candidate.situation.slice(0, 600),
    coachGoal: candidate.coachGoal.slice(0, 400),
    learnerGoal: candidate.learnerGoal.slice(0, 400),
    level:
      candidate.level === "Stretch"
        ? "Stretch"
        : candidate.level === "Warm-up"
          ? "Warm-up"
          : "Everyday",
    accentFocus: candidate.accentFocus
      .filter((focus): focus is string => typeof focus === "string")
      .slice(0, 8)
      .map((focus) => focus.slice(0, 100)),
    samplePrompts: candidate.samplePrompts
      .filter((prompt): prompt is string => typeof prompt === "string")
      .slice(0, 6)
      .map((prompt) => prompt.slice(0, 200)),
    isCustom: true,
  };
}

function pickClientSecret(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const direct = record.client_secret ?? record.value ?? record.secret;

  if (typeof direct === "string") {
    return direct;
  }

  if (direct && typeof direct === "object") {
    const nested = direct as Record<string, unknown>;
    if (typeof nested.value === "string") {
      return nested.value;
    }
    if (typeof nested.secret === "string") {
      return nested.secret;
    }
  }

  return null;
}

function pickExpiry(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.expires_at === "number") {
    return record.expires_at;
  }

  if (record.client_secret && typeof record.client_secret === "object") {
    const nested = record.client_secret as Record<string, unknown>;
    if (typeof nested.expires_at === "number") {
      return nested.expires_at;
    }
  }

  return null;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Missing OPENAI_API_KEY. Add it to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }

  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = {};
  }

  const scenario =
    parseCustomScenario(body.customScenario) ?? getScenario(body.scenarioId);
  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "local-cantonese-speaking-coach",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: buildCoachInstructions(scenario),
          output_modalities: ["audio", "text"],
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "yue",
              },
              turn_detection: {
                type: "server_vad",
                create_response: true,
                silence_duration_ms: 650,
              },
            },
            output: {
              voice: "alloy",
            },
          },
        },
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Could not create a realtime voice session.",
        detail:
          payload && typeof payload === "object" && "error" in payload
            ? (payload as { error: unknown }).error
            : payload,
      },
      { status: response.status },
    );
  }

  const clientSecret = pickClientSecret(payload);

  if (!clientSecret) {
    return NextResponse.json(
      {
        error: "OpenAI did not return a usable realtime client secret.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    client_secret: clientSecret,
    expires_at: pickExpiry(payload),
    model: REALTIME_MODEL,
  });
}
