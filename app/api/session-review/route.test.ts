import { afterEach, describe, expect, it, vi } from "vitest";

const phrase = {
  original: "Original", improved: "Improved", englishHint: "Hint", focusArea: "tone",
};
const review = {
  overallScore: 80,
  skillScores: { tone: 80, wording: 80, flow: 80, confidence: 80, listening: 80 },
  summary: "Good work",
  wins: ["Clear tones"], nextSteps: ["Keep practicing"], phrases: [phrase],
};
const request = () => new Request("http://localhost/api/session-review", {
  method: "POST",
  body: JSON.stringify({
    session: {
      id: "session-1", scenarioId: "daily", startedAt: "2026-09-28",
      transcript: [{ speaker: "learner", text: "Hello", createdAt: "2026-09-28" }],
    },
    scenario: { title: "Daily", situation: "Greeting", learnerGoal: "Say hello", accentFocus: [] },
    profile: null,
  }),
});

async function run(output: unknown, model = "gpt-4o-mini") {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_REVIEW_MODEL", model);
  vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }],
  }));
  vi.stubGlobal("fetch", fetchMock);
  const { POST } = await import("./route");
  const response = await POST(request());
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
  return { response, schema: sent.text.format.schema };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("session review", () => {
  it.each([401, 429, 500])("hides upstream %s details and logs them on the server", async (status) => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const error = { message: "Private upstream diagnostics", code: "private_code" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error }, { status })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Session review is temporarily unavailable." });
    expect(log).toHaveBeenCalledWith("OpenAI session review failed", { status, error });
  });

  it("logs non-JSON upstream diagnostics without sending them to the browser", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Private proxy error", { status: 503 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Session review is temporarily unavailable." });
    expect(log).toHaveBeenCalledWith("OpenAI session review failed", { status: 503, error: "Private proxy error" });
  });

  it("caps arrays before validation and sends only string bounds", async () => {
    const { response, schema } = await run({
      ...review, wins: Array(6).fill("Win"), nextSteps: Array(7).fill("Step"),
      phrases: Array(8).fill(phrase),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.wins).toHaveLength(4);
    expect(body.review.nextSteps).toHaveLength(4);
    expect(body.review.phrases).toHaveLength(5);
    expect(schema.properties.summary).toEqual({ type: "string", minLength: 1, maxLength: 500 });
    for (const field of ["wins", "nextSteps"]) {
      expect(schema.properties[field].items).toEqual({ type: "string", minLength: 1, maxLength: 180 });
    }
    for (const field of ["original", "improved", "englishHint"]) {
      expect(schema.properties.phrases.items.properties[field]).toEqual({ type: "string", minLength: 1, maxLength: 240 });
    }
    expect(JSON.stringify(schema)).not.toMatch(/minItems|maxItems/);
  });

  it("normalizes fine-tuned text locally and omits unsupported constraints", async () => {
    const long = "a".repeat(600);
    const { response, schema } = await run({
      ...review, summary: long, wins: [long], nextSteps: [long],
      phrases: [{ ...phrase, original: long, improved: long, englishHint: long }],
    }, "ft:gpt-4o-mini:org:review:example");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.summary).toHaveLength(500);
    expect(body.review.wins[0]).toHaveLength(180);
    expect(body.review.nextSteps[0]).toHaveLength(180);
    for (const field of ["original", "improved", "englishHint"]) {
      expect(body.review.phrases[0][field]).toHaveLength(240);
    }
    expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|minimum|maximum|minItems|maxItems/);
  });

  it.each([
    { ...review, summary: "" },
    { ...review, wins: [42] },
    { ...review, phrases: [null] },
    { ...review, overallScore: 101 },
  ])("still rejects invalid fine-tuned output", async (invalid) => {
    const { response } = await run(invalid, "ft:gpt-4o-mini:org:review:example");
    expect(response.status).toBe(502);
  });
});
