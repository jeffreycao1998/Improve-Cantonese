"use client";

import {
  Activity,
  ChevronRight,
  CircleAlert,
  Mic,
  MicOff,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Volume2,
  Waves
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildCoachInstructions } from "@/lib/coachInstructions";
import {
  completeSession,
  defaultProgress,
  loadProgress,
  recordFeedback,
  saveProgress
} from "@/lib/progress";
import { scenarios } from "@/lib/scenarios";
import type {
  LocalProgress,
  PracticeScenario,
  PracticeSession,
  PracticeTurnFeedback,
  RealtimeSessionResponse
} from "@/lib/types";

type ConnectionState = "idle" | "checking-mic" | "connecting" | "connected" | "error";
type TalkState = "muted" | "listening";

type CoachLine = {
  speaker: "coach" | "learner" | "system";
  text: string;
};

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  error?: {
    message?: string;
  };
  item?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      transcript?: string;
    }>;
  };
  response?: {
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
        transcript?: string;
      }>;
    }>;
  };
};

type RealtimeHistoryItem = {
  itemId?: string;
  type?: string;
  role?: "system" | "user" | "assistant";
  status?: "in_progress" | "completed" | "incomplete";
  content?: Array<{
    type?: string;
    text?: string;
    transcript?: string | null;
  }>;
};

function makeSessionId() {
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeFeedbackId() {
  return `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusCopy(state: ConnectionState) {
  if (state === "checking-mic") {
    return "Checking mic";
  }
  if (state === "connecting") {
    return "Connecting";
  }
  if (state === "connected") {
    return "Live";
  }
  if (state === "error") {
    return "Needs attention";
  }
  return "Ready";
}

function focusLabel(focus: PracticeTurnFeedback["focusArea"]) {
  const labels: Record<PracticeTurnFeedback["focusArea"], string> = {
    tone: "tone",
    wording: "natural wording",
    flow: "flow",
    confidence: "confidence",
    listening: "listening"
  };
  return labels[focus];
}

function inferFocus(text: string): PracticeTurnFeedback["focusArea"] {
  const lowered = text.toLowerCase();
  if (lowered.includes("tone") || lowered.includes("pitch")) {
    return "tone";
  }
  if (lowered.includes("word") || lowered.includes("phrase") || lowered.includes("natural")) {
    return "wording";
  }
  if (lowered.includes("listen") || lowered.includes("understand") || lowered.includes("repeat")) {
    return "listening";
  }
  if (lowered.includes("smooth") || lowered.includes("rhythm") || lowered.includes("flow")) {
    return "flow";
  }
  return "confidence";
}

function extractText(event: RealtimeEvent) {
  if (typeof event.delta === "string") {
    return event.delta;
  }
  if (typeof event.transcript === "string") {
    return event.transcript;
  }
  if (typeof event.text === "string") {
    return event.text;
  }

  const itemText = event.item?.content
    ?.map((content) => content.text ?? content.transcript ?? "")
    .filter(Boolean)
    .join(" ");
  if (itemText) {
    return itemText;
  }

  const responseText = event.response?.output
    ?.flatMap((output) => output.content ?? [])
    .map((content) => content.text ?? content.transcript ?? "")
    .filter(Boolean)
    .join(" ");

  return responseText ?? "";
}

function extractHistoryItemText(item: RealtimeHistoryItem) {
  return (
    item.content
      ?.map((content) => content.text ?? content.transcript ?? "")
      .filter(Boolean)
      .join(" ")
      .trim() ?? ""
  );
}

function parseFeedback(text: string, scenario: PracticeScenario): PracticeTurnFeedback {
  const clean = text.trim().replace(/\s+/g, " ");
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(" ").slice(0, 220) || "Good repetition. Keep the answer short and natural.";
  const naturalRewrite = sentences.find((sentence) => /try|say|natural|instead/i.test(sentence));

  return {
    id: makeFeedbackId(),
    scenarioId: scenario.id,
    createdAt: new Date().toISOString(),
    summary,
    naturalRewrite,
    focusArea: inferFocus(clean),
    confidenceDelta: clean ? 1 : 0
  };
}

async function getMicrophonePreview() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not expose microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

function setSessionMuted(session: unknown, muted: boolean) {
  const candidate = session as {
    mute?: (value?: boolean) => void | Promise<void>;
    unmute?: () => void | Promise<void>;
    setMuted?: (value: boolean) => void | Promise<void>;
    inputAudio?: {
      setMuted?: (value: boolean) => void | Promise<void>;
    };
    transport?: {
      setMuted?: (value: boolean) => void | Promise<void>;
      mute?: (value?: boolean) => void | Promise<void>;
      unmute?: () => void | Promise<void>;
    };
  };

  if (typeof candidate.setMuted === "function") {
    void candidate.setMuted(muted);
    return;
  }

  if (typeof candidate.inputAudio?.setMuted === "function") {
    void candidate.inputAudio.setMuted(muted);
    return;
  }

  if (typeof candidate.transport?.setMuted === "function") {
    void candidate.transport.setMuted(muted);
    return;
  }

  if (muted && typeof candidate.mute === "function") {
    void candidate.mute(true);
    return;
  }

  if (!muted && typeof candidate.mute === "function") {
    void candidate.mute(false);
    return;
  }

  if (muted && typeof candidate.transport?.mute === "function") {
    void candidate.transport.mute(true);
    return;
  }

  if (!muted && typeof candidate.transport?.mute === "function") {
    void candidate.transport.mute(false);
    return;
  }

  if (!muted && typeof candidate.unmute === "function") {
    void candidate.unmute();
    return;
  }

  if (!muted && typeof candidate.transport?.unmute === "function") {
    void candidate.transport.unmute();
  }
}

function closeRealtimeSession(session: unknown) {
  const candidate = session as {
    close?: () => void | Promise<void>;
    disconnect?: () => void | Promise<void>;
  };

  if (typeof candidate.close === "function") {
    void candidate.close();
    return;
  }

  if (typeof candidate.disconnect === "function") {
    void candidate.disconnect();
  }
}

function sendKickoff(session: unknown, scenario: PracticeScenario) {
  const candidate = session as {
    sendMessage?: (message: string) => void | Promise<void>;
    send?: (event: unknown) => void | Promise<void>;
    addItem?: (item: unknown) => void | Promise<void>;
    response?: {
      create?: (event?: unknown) => void | Promise<void>;
    };
  };

  const text = `Start the ${scenario.title} practice now. Give one short spoken prompt and wait for my answer.`;

  if (typeof candidate.sendMessage === "function") {
    void candidate.sendMessage(text);
    return;
  }

  if (typeof candidate.addItem === "function") {
    void candidate.addItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    });
    void candidate.response?.create?.();
    return;
  }

  if (typeof candidate.send === "function") {
    void candidate.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }]
      }
    });
    void candidate.send({ type: "response.create" });
  }
}

export function PracticeApp() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0].id);
  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0],
    [selectedScenarioId]
  );
  const [progress, setProgress] = useState<LocalProgress>(defaultProgress);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [talkState, setTalkState] = useState<TalkState>("muted");
  const [coachLines, setCoachLines] = useState<CoachLine[]>([
    {
      speaker: "system",
      text: "Choose a scenario and start the voice coach."
    }
  ]);
  const [currentSession, setCurrentSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const realtimeSessionRef = useRef<unknown>(null);
  const latestCoachTextRef = useRef("");
  const seenHistoryItemsRef = useRef<Set<string>>(new Set());
  const learnerSpokeSinceLastCoachRef = useRef(false);

  useEffect(() => {
    setProgress(loadProgress());
  }, []);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    return () => {
      closeRealtimeSession(realtimeSessionRef.current);
    };
  }, []);

  function pushLine(line: CoachLine) {
    setCoachLines((lines) => [line, ...lines].slice(0, 8));
  }

  function applyFeedback(text: string) {
    if (!text.trim()) {
      return;
    }

    const feedback = parseFeedback(text, selectedScenario);
    setProgress((existing) => recordFeedback(existing, feedback));
    setCurrentSession((session) =>
      session
        ? {
            ...session,
            turns: [feedback, ...session.turns]
          }
        : session
    );
  }

  function handleRealtimeHistoryItem(item: RealtimeHistoryItem) {
    if (item.type !== "message" || item.status === "in_progress") {
      return;
    }

    const text = extractHistoryItemText(item);
    if (!text) {
      return;
    }

    const itemKey = item.itemId ?? `${item.role}-${text}`;
    if (seenHistoryItemsRef.current.has(itemKey)) {
      return;
    }

    seenHistoryItemsRef.current.add(itemKey);

    if (item.role === "user") {
      learnerSpokeSinceLastCoachRef.current = true;
      pushLine({ speaker: "learner", text });
      return;
    }

    if (item.role === "assistant") {
      pushLine({ speaker: "coach", text });
      if (learnerSpokeSinceLastCoachRef.current) {
        applyFeedback(text);
        learnerSpokeSinceLastCoachRef.current = false;
      }
    }
  }

  function handleRealtimeHistory(history: unknown) {
    if (!Array.isArray(history)) {
      return;
    }

    history.forEach((item) => handleRealtimeHistoryItem(item as RealtimeHistoryItem));
  }

  function handleRealtimeError(errorEvent: unknown) {
    const message =
      errorEvent && typeof errorEvent === "object" && "error" in errorEvent
        ? JSON.stringify((errorEvent as { error: unknown }).error)
        : "The realtime session reported an error.";

    setError(message);
    setConnectionState("error");
  }

  function handleRealtimeEvent(event: RealtimeEvent) {
    if (event.type === "error") {
      setError(event.error?.message ?? "The realtime session reported an error.");
      setConnectionState("error");
      return;
    }

    const text = extractText(event);
    if (!text) {
      return;
    }

    if (event.type?.includes("input_audio_transcription")) {
      learnerSpokeSinceLastCoachRef.current = true;
      pushLine({ speaker: "learner", text });
      return;
    }

    if (event.type?.includes("delta") || event.type === "transcript_delta") {
      latestCoachTextRef.current += text;
      setLiveTranscript(latestCoachTextRef.current);
      return;
    }

    if (!event.type?.includes("done") && !event.type?.includes("completed")) {
      return;
    }

    const finalText = latestCoachTextRef.current || text;
    latestCoachTextRef.current = "";
    setLiveTranscript("");
    pushLine({ speaker: "coach", text: finalText });
    if (learnerSpokeSinceLastCoachRef.current) {
      applyFeedback(finalText);
      learnerSpokeSinceLastCoachRef.current = false;
    }
  }

  async function startSession() {
    if (connectionState === "connecting" || connectionState === "checking-mic") {
      return;
    }

    setError(null);
    setConnectionState("checking-mic");

    try {
      await getMicrophonePreview();
      setConnectionState("connecting");

      const sessionResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ scenarioId: selectedScenario.id })
      });

      const data = (await sessionResponse.json()) as Partial<RealtimeSessionResponse> & {
        error?: string;
        detail?: unknown;
      };

      if (!sessionResponse.ok || !data.client_secret) {
        throw new Error(data.error ?? "Could not create a realtime session.");
      }

      const realtimeModule = await import("@openai/agents/realtime");
      const RealtimeAgent = realtimeModule.RealtimeAgent as new (config: {
        name: string;
        instructions: string;
      }) => unknown;
      const RealtimeSession = realtimeModule.RealtimeSession as new (
        agent: unknown,
        config: {
          model: string;
          config: {
            outputModalities: Array<"audio" | "text">;
            audio: {
              input: {
                transcription: {
                  model: string;
                  language: string;
                };
                turnDetection: {
                  type: string;
                  createResponse: boolean;
                  silenceDurationMs: number;
                };
              };
              output: {
                voice: string;
              };
            };
          };
        }
      ) => {
        connect: (options: { apiKey: string }) => Promise<void>;
        close: () => void;
        mute: (muted: boolean) => void;
        sendMessage: (message: string) => void;
        on?: (eventName: string, handler: (event: unknown) => void) => void;
      };

      const agent = new RealtimeAgent({
        name: "Guangzhou Cantonese Speaking Coach",
        instructions: buildCoachInstructions(selectedScenario)
      });
      const session = new RealtimeSession(agent, {
        model: data.model ?? "gpt-realtime-2",
        config: {
          outputModalities: ["audio", "text"],
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "yue"
              },
              turnDetection: {
                type: "server_vad",
                createResponse: true,
                silenceDurationMs: 650
              }
            },
            output: {
              voice: "alloy"
            }
          }
        }
      });

      if (typeof session.on === "function") {
        session.on("transport_event", (event) => handleRealtimeEvent(event as RealtimeEvent));
        session.on("history_added", (item) => handleRealtimeHistoryItem(item as RealtimeHistoryItem));
        session.on("history_updated", handleRealtimeHistory);
        session.on("error", handleRealtimeError);
        session.on("audio_start", () => setLiveTranscript(""));
        session.on("audio_stopped", () => {
          latestCoachTextRef.current = "";
          setLiveTranscript("");
        });
        session.on("audio_interrupted", () => {
          latestCoachTextRef.current = "";
          setLiveTranscript("");
        });
      }

      await session.connect({ apiKey: data.client_secret });
      realtimeSessionRef.current = session;
      setSessionMuted(session, true);
      setTalkState("muted");
      seenHistoryItemsRef.current = new Set();
      learnerSpokeSinceLastCoachRef.current = false;
      setConnectionState("connected");
      setCurrentSession({
        id: makeSessionId(),
        scenarioId: selectedScenario.id,
        startedAt: new Date().toISOString(),
        turns: []
      });
      pushLine({
        speaker: "system",
        text: `${selectedScenario.title} is live.`
      });
      sendKickoff(session, selectedScenario);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not start the voice coach.";
      setConnectionState("error");
      setTalkState("muted");
      setError(message);
      pushLine({ speaker: "system", text: message });
      closeRealtimeSession(realtimeSessionRef.current);
      realtimeSessionRef.current = null;
    }
  }

  function stopSession() {
    closeRealtimeSession(realtimeSessionRef.current);
    realtimeSessionRef.current = null;
    setTalkState("muted");
    setConnectionState("idle");
    setLiveTranscript("");
    latestCoachTextRef.current = "";

    if (currentSession) {
      setCurrentSession({
        ...currentSession,
        endedAt: new Date().toISOString()
      });
      setProgress((existing) => completeSession(existing));
      pushLine({
        speaker: "system",
        text: "Session saved locally."
      });
    }
  }

  function beginTalking() {
    if (connectionState !== "connected") {
      return;
    }

    setSessionMuted(realtimeSessionRef.current, false);
    setTalkState("listening");
  }

  function endTalking() {
    if (connectionState !== "connected") {
      return;
    }

    setSessionMuted(realtimeSessionRef.current, true);
    setTalkState("muted");
  }

  function repeatPrompt() {
    if (connectionState !== "connected") {
      return;
    }

    sendKickoff(realtimeSessionRef.current, selectedScenario);
  }

  const canTalk = connectionState === "connected";
  const recentFeedback = progress.recentFeedback.slice(0, 4);

  return (
    <main className="app-shell">
      <section className="top-band" aria-label="Practice overview">
        <div>
          <p className="eyebrow">Guangzhou Cantonese</p>
          <h1>Speak first. Read almost never.</h1>
        </div>
        <div className={`status-pill status-${connectionState}`}>
          <Activity size={16} aria-hidden="true" />
          <span>{statusCopy(connectionState)}</span>
        </div>
      </section>

      <section className="workspace" aria-label="Cantonese speaking coach">
        <aside className="scenario-rail" aria-label="Practice scenarios">
          <div className="rail-heading">
            <Waves size={18} aria-hidden="true" />
            <span>Scenarios</span>
          </div>
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <button
                className={`scenario-card ${scenario.id === selectedScenario.id ? "active" : ""}`}
                key={scenario.id}
                onClick={() => {
                  setSelectedScenarioId(scenario.id);
                  if (connectionState === "idle" || connectionState === "error") {
                    setCoachLines([
                      {
                        speaker: "system",
                        text: `${scenario.title} is ready.`
                      }
                    ]);
                  }
                }}
                type="button"
              >
                <span>
                  <strong>{scenario.title}</strong>
                  <small>{scenario.level}</small>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>

        <section className="practice-stage" aria-label="Current practice">
          <div className="stage-header">
            <div>
              <p className="eyebrow">{selectedScenario.level}</p>
              <h2>{selectedScenario.title}</h2>
              <p>{selectedScenario.situation}</p>
            </div>
            <button
              className="icon-button"
              disabled={!canTalk}
              onClick={repeatPrompt}
              title="Repeat prompt"
              type="button"
            >
              <RefreshCw size={19} aria-hidden="true" />
            </button>
          </div>

          <div className="voice-panel" aria-live="polite">
            <div className="pulse-field">
              <span className={talkState === "listening" ? "wave live" : "wave"} />
              <span className={talkState === "listening" ? "wave live delay-one" : "wave delay-one"} />
              <span className={talkState === "listening" ? "wave live delay-two" : "wave delay-two"} />
              {talkState === "listening" ? <Mic size={34} /> : <Volume2 size={34} />}
            </div>
            <div className="transcript-stack">
              {liveTranscript ? (
                <p className="live-transcript">{liveTranscript}</p>
              ) : (
                <p>{coachLines[0]?.text ?? "Start when you are ready."}</p>
              )}
            </div>
          </div>

          {error ? (
            <div className="notice" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="control-strip">
            {connectionState === "connected" ? (
              <button className="secondary-button" onClick={stopSession} type="button">
                <Square size={17} aria-hidden="true" />
                Finish
              </button>
            ) : (
              <button className="primary-button" onClick={startSession} type="button">
                <Play size={18} aria-hidden="true" />
                Start coach
              </button>
            )}

            <button
              className={`talk-button ${talkState === "listening" ? "listening" : ""}`}
              disabled={!canTalk}
              onMouseDown={beginTalking}
              onMouseLeave={endTalking}
              onMouseUp={endTalking}
              onTouchEnd={endTalking}
              onTouchStart={beginTalking}
              type="button"
            >
              {talkState === "listening" ? <Pause size={24} /> : <Mic size={24} />}
              <span>{talkState === "listening" ? "Listening" : "Hold to talk"}</span>
            </button>

            <button
              className="secondary-button"
              disabled={connectionState === "checking-mic" || connectionState === "connecting"}
              onClick={connectionState === "connected" ? endTalking : startSession}
              type="button"
            >
              {connectionState === "connected" ? <MicOff size={17} /> : <RefreshCw size={17} />}
              {connectionState === "connected" ? "Mute" : "Retry"}
            </button>
          </div>

          <div className="prompt-row" aria-label="Sample prompts">
            {selectedScenario.samplePrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => {
                  pushLine({ speaker: "system", text: prompt });
                  if (connectionState === "connected") {
                    sendKickoff(realtimeSessionRef.current, selectedScenario);
                  }
                }}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>

        <aside className="progress-panel" aria-label="Progress">
          <div className="metric-grid">
            <div>
              <span>{progress.streak}</span>
              <small>streak</small>
            </div>
            <div>
              <span>{progress.sessionsCompleted}</span>
              <small>sessions</small>
            </div>
            <div>
              <span>{progress.confidenceScore}</span>
              <small>confidence</small>
            </div>
          </div>

          <div className="focus-block">
            <div className="rail-heading">
              <Sparkles size={18} aria-hidden="true" />
              <span>Focus</span>
            </div>
            <div className="tag-list">
              {progress.weakAreas.map((area) => (
                <span key={area}>{area}</span>
              ))}
            </div>
          </div>

          <div className="feedback-list">
            <div className="rail-heading">
              <Volume2 size={18} aria-hidden="true" />
              <span>Recent feedback</span>
            </div>
            {recentFeedback.length ? (
              recentFeedback.map((feedback) => (
                <article key={feedback.id} className="feedback-item">
                  <strong>{focusLabel(feedback.focusArea)}</strong>
                  <p>{feedback.summary}</p>
                </article>
              ))
            ) : (
              <p className="empty-copy">Feedback will appear after your first spoken turn.</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
