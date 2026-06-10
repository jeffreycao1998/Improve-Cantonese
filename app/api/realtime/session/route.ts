import { NextResponse } from "next/server";
import { buildCoachInstructions } from "@/lib/coachInstructions";
import { getScenario } from "@/lib/scenarios";

export const runtime = "nodejs";

const REALTIME_MODEL = "gpt-realtime-2";

type RequestBody = {
  scenarioId?: string;
};

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
        error: "Missing OPENAI_API_KEY. Add it to .env.local and restart the dev server."
      },
      { status: 500 }
    );
  }

  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = {};
  }

  const scenario = getScenario(body.scenarioId);
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "local-cantonese-speaking-coach"
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
              language: "yue"
            },
            turn_detection: {
              type: "server_vad",
              create_response: true,
              silence_duration_ms: 650
            }
          },
          output: {
            voice: "alloy"
          }
        }
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Could not create a realtime voice session.",
        detail:
          payload && typeof payload === "object" && "error" in payload
            ? (payload as { error: unknown }).error
            : payload
      },
      { status: response.status }
    );
  }

  const clientSecret = pickClientSecret(payload);

  if (!clientSecret) {
    return NextResponse.json(
      {
        error: "OpenAI did not return a usable realtime client secret."
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    client_secret: clientSecret,
    expires_at: pickExpiry(payload),
    model: REALTIME_MODEL
  });
}
