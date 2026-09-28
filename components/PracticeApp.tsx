"use client";

import {
  Activity,
  BookOpen,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Map as MapIcon,
  Mic,
  MicOff,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Volume2,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JourneyDashboard } from "@/components/JourneyDashboard";
import { Onboarding } from "@/components/Onboarding";
import { ReviewQueue } from "@/components/ReviewQueue";
import { buildCoachInstructions } from "@/lib/coachInstructions";
import {
  addCustomScenario,
  addSessionReview,
  beginJourney,
  completeSession,
  defaultProgress,
  gradeReviewPhrase,
  importProgress,
  loadProgress,
  recordFeedback,
  removeCustomScenario,
  saveProgress,
} from "@/lib/progress";
import type { GeneratedReview } from "@/lib/reviewSchema";
import { scenarios } from "@/lib/scenarios";
import { buildLocalReview, dateKey } from "@/lib/training";
import type {
  LocalProgress,
  PracticeScenario,
  PracticeSession,
  PracticeTurnFeedback,
  RealtimeSessionResponse,
  ReviewPhrase,
  SessionReview,
  SessionTranscriptLine,
} from "@/lib/types";

type ConnectionState =
  "idle" | "checking-mic" | "connecting" | "connected" | "error";
type TalkState = "muted" | "listening";
type ActiveView = "practice" | "journey" | "review";

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
    listening: "listening",
  };
  return labels[focus];
}

function inferFocus(text: string): PracticeTurnFeedback["focusArea"] {
  const lowered = text.toLowerCase();
  if (lowered.includes("tone") || lowered.includes("pitch")) {
    return "tone";
  }
  if (
    lowered.includes("word") ||
    lowered.includes("phrase") ||
    lowered.includes("natural")
  ) {
    return "wording";
  }
  if (
    lowered.includes("listen") ||
    lowered.includes("understand") ||
    lowered.includes("repeat")
  ) {
    return "listening";
  }
  if (
    lowered.includes("smooth") ||
    lowered.includes("rhythm") ||
    lowered.includes("flow")
  ) {
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

function parseFeedback(
  text: string,
  scenario: PracticeScenario,
): PracticeTurnFeedback {
  const clean = text.trim().replace(/\s+/g, " ");
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary =
    sentences.slice(0, 2).join(" ").slice(0, 220) ||
    "Good repetition. Keep the answer short and natural.";
  const naturalRewrite = sentences.find((sentence) =>
    /try|say|natural|instead/i.test(sentence),
  );

  return {
    id: makeFeedbackId(),
    scenarioId: scenario.id,
    createdAt: new Date().toISOString(),
    summary,
    naturalRewrite,
    focusArea: inferFocus(clean),
    confidenceDelta: clean ? 1 : 0,
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

function sendCoachMessage(session: unknown, text: string) {
  const candidate = session as {
    sendMessage?: (message: string) => void | Promise<void>;
    send?: (event: unknown) => void | Promise<void>;
    addItem?: (item: unknown) => void | Promise<void>;
    response?: {
      create?: (event?: unknown) => void | Promise<void>;
    };
  };

  if (typeof candidate.sendMessage === "function") {
    void candidate.sendMessage(text);
    return;
  }

  if (typeof candidate.addItem === "function") {
    void candidate.addItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
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
        content: [{ type: "input_text", text }],
      },
    });
    void candidate.send({ type: "response.create" });
  }
}

function sendKickoff(
  session: unknown,
  scenario: PracticeScenario,
  instruction?: string,
) {
  sendCoachMessage(
    session,
    instruction ??
      `Start the ${scenario.title} practice now. Give one short spoken prompt and wait for my answer.`,
  );
}

export function PracticeApp() {
  const [progress, setProgress] = useState<LocalProgress>(defaultProgress);
  const [hasLoadedProgress, setHasLoadedProgress] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("practice");
  const [selectedScenarioId, setSelectedScenarioId] = useState<
    PracticeScenario["id"]
  >(scenarios[0].id);
  const allScenarios = useMemo(
    () => [...scenarios, ...progress.customScenarios],
    [progress.customScenarios],
  );
  const selectedScenario = useMemo(
    () =>
      allScenarios.find((scenario) => scenario.id === selectedScenarioId) ??
      scenarios[0],
    [allScenarios, selectedScenarioId],
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [talkState, setTalkState] = useState<TalkState>("muted");
  const [isGeneratingReview, setIsGeneratingReview] = useState(false);
  const [queuedCoachInstruction, setQueuedCoachInstruction] = useState<
    string | null
  >(null);
  const [coachLines, setCoachLines] = useState<CoachLine[]>([
    {
      speaker: "system",
      text: "Choose a scenario and start the voice coach.",
    },
  ]);
  const [, setCurrentSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const realtimeSessionRef = useRef<unknown>(null);
  const currentSessionRef = useRef<PracticeSession | null>(null);
  const transcriptRef = useRef<SessionTranscriptLine[]>([]);
  const latestCoachTextRef = useRef("");
  const latestLearnerTextRef = useRef("");
  const recentLineSignaturesRef = useRef<Map<string, number>>(new Map());
  const seenHistoryItemsRef = useRef<Set<string>>(new Set());
  const learnerSpokeSinceLastCoachRef = useRef(false);

  useEffect(() => {
    setProgress(loadProgress());
    setHasLoadedProgress(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedProgress) {
      return;
    }
    saveProgress(progress);
  }, [hasLoadedProgress, progress]);

  useEffect(() => {
    return () => {
      closeRealtimeSession(realtimeSessionRef.current);
    };
  }, []);

  function pushLine(line: CoachLine) {
    const signature = `${line.speaker}:${line.text.trim()}`;
    const now = Date.now();
    const lastSeenAt = recentLineSignaturesRef.current.get(signature);
    if (lastSeenAt && now - lastSeenAt < 5_000) {
      return;
    }
    recentLineSignaturesRef.current.set(signature, now);
    if (recentLineSignaturesRef.current.size > 20) {
      const oldestKey = recentLineSignaturesRef.current.keys().next().value;
      if (oldestKey) {
        recentLineSignaturesRef.current.delete(oldestKey);
      }
    }

    setCoachLines((lines) => [line, ...lines].slice(0, 8));
    if (line.speaker === "system" || !currentSessionRef.current) {
      return;
    }

    const transcriptLine: SessionTranscriptLine = {
      speaker: line.speaker,
      text: line.text,
      createdAt: new Date().toISOString(),
    };
    transcriptRef.current = [...transcriptRef.current, transcriptLine].slice(
      -60,
    );
    const nextSession = {
      ...currentSessionRef.current,
      transcript: transcriptRef.current,
    };
    currentSessionRef.current = nextSession;
    setCurrentSession(nextSession);
  }

  function applyFeedback(text: string) {
    if (!text.trim()) {
      return;
    }

    const feedback = parseFeedback(text, selectedScenario);
    setProgress((existing) => recordFeedback(existing, feedback));
    if (currentSessionRef.current) {
      const nextSession = {
        ...currentSessionRef.current,
        turns: [feedback, ...currentSessionRef.current.turns],
      };
      currentSessionRef.current = nextSession;
      setCurrentSession(nextSession);
    }
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
      const containsAudio = item.content?.some((content) =>
        content.type?.includes("audio"),
      );
      if (!containsAudio) {
        return;
      }
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

    history.forEach((item) =>
      handleRealtimeHistoryItem(item as RealtimeHistoryItem),
    );
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
      setError(
        event.error?.message ?? "The realtime session reported an error.",
      );
      setConnectionState("error");
      return;
    }

    const text = extractText(event);
    if (!text) {
      return;
    }

    if (event.type?.includes("input_audio_transcription")) {
      if (event.type.includes("delta")) {
        latestLearnerTextRef.current += text;
        return;
      }
      if (!event.type.includes("done") && !event.type.includes("completed")) {
        return;
      }
      const finalLearnerText = latestLearnerTextRef.current || text;
      latestLearnerTextRef.current = "";
      learnerSpokeSinceLastCoachRef.current = true;
      pushLine({ speaker: "learner", text: finalLearnerText });
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
    if (
      isGeneratingReview ||
      connectionState === "connecting" ||
      connectionState === "checking-mic"
    ) {
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
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: selectedScenario.id,
          customScenario: selectedScenario.isCustom
            ? selectedScenario
            : undefined,
        }),
      });

      const data =
        (await sessionResponse.json()) as Partial<RealtimeSessionResponse> & {
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
        },
      ) => {
        connect: (options: { apiKey: string }) => Promise<void>;
        close: () => void;
        mute: (muted: boolean) => void;
        sendMessage: (message: string) => void;
        on?: (eventName: string, handler: (event: unknown) => void) => void;
      };

      const agent = new RealtimeAgent({
        name: "Guangzhou Cantonese Speaking Coach",
        instructions: buildCoachInstructions(selectedScenario),
      });
      const session = new RealtimeSession(agent, {
        model: data.model ?? "gpt-realtime-2",
        config: {
          outputModalities: ["audio", "text"],
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "yue",
              },
              turnDetection: {
                type: "server_vad",
                createResponse: true,
                silenceDurationMs: 650,
              },
            },
            output: {
              voice: "alloy",
            },
          },
        },
      });

      if (typeof session.on === "function") {
        session.on("transport_event", (event) =>
          handleRealtimeEvent(event as RealtimeEvent),
        );
        session.on("history_added", (item) =>
          handleRealtimeHistoryItem(item as RealtimeHistoryItem),
        );
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
      recentLineSignaturesRef.current = new Map();
      latestLearnerTextRef.current = "";
      learnerSpokeSinceLastCoachRef.current = false;
      setConnectionState("connected");
      transcriptRef.current = [];
      const practiceSession: PracticeSession = {
        id: makeSessionId(),
        scenarioId: selectedScenario.id,
        startedAt: new Date().toISOString(),
        turns: [],
        transcript: [],
      };
      currentSessionRef.current = practiceSession;
      setCurrentSession(practiceSession);
      pushLine({
        speaker: "system",
        text: `${selectedScenario.title} is live.`,
      });
      sendKickoff(
        session,
        selectedScenario,
        queuedCoachInstruction ?? undefined,
      );
      setQueuedCoachInstruction(null);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not start the voice coach.";
      setConnectionState("error");
      setTalkState("muted");
      setError(message);
      pushLine({ speaker: "system", text: message });
      closeRealtimeSession(realtimeSessionRef.current);
      realtimeSessionRef.current = null;
    }
  }

  async function generateSessionReview(
    session: PracticeSession,
    scenario: PracticeScenario,
  ) {
    setIsGeneratingReview(true);
    let review = buildLocalReview(session, scenario);
    const hasLearnerTurn = session.transcript.some(
      (line) => line.speaker === "learner",
    );

    if (hasLearnerTurn) {
      try {
        const response = await fetch("/api/session-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session,
            scenario,
            profile: progress.profile,
          }),
        });
        const data = (await response.json()) as {
          review?: GeneratedReview;
          error?: string;
        };
        if (!response.ok || !data.review) {
          throw new Error(
            data.error ?? "Could not generate the detailed review.",
          );
        }

        review = {
          ...review,
          ...data.review,
          source: "ai",
        } satisfies SessionReview;
      } catch {
        pushLine({
          speaker: "system",
          text: "The detailed review was unavailable, so your session was saved with a quick local summary.",
        });
      }
    }

    setProgress((existing) => addSessionReview(existing, review));
    setIsGeneratingReview(false);
    setActiveView("journey");
  }

  function stopSession() {
    closeRealtimeSession(realtimeSessionRef.current);
    realtimeSessionRef.current = null;
    setTalkState("muted");
    setConnectionState("idle");
    setLiveTranscript("");
    latestCoachTextRef.current = "";

    const currentSession = currentSessionRef.current;
    if (currentSession) {
      const endedSession = {
        ...currentSession,
        endedAt: new Date().toISOString(),
        transcript: transcriptRef.current,
      };
      currentSessionRef.current = null;
      setCurrentSession(null);
      setProgress((existing) => completeSession(existing, selectedScenario.id));
      pushLine({
        speaker: "system",
        text: "Session saved. Building your coach report…",
      });
      void generateSessionReview(endedSession, selectedScenario);
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

    sendCoachMessage(
      realtimeSessionRef.current,
      "Repeat your most recent spoken prompt once, a little more slowly, then wait for my answer.",
    );
  }

  function openScenario(
    scenarioId: PracticeScenario["id"],
    instruction?: string,
  ) {
    if (connectionState === "connected") {
      return;
    }
    const scenario =
      allScenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
    setSelectedScenarioId(scenario.id);
    setQueuedCoachInstruction(instruction ?? null);
    setCoachLines([
      {
        speaker: "system",
        text: instruction
          ? "Your targeted drill is queued."
          : `${scenario.title} is ready.`,
      },
    ]);
    setActiveView("practice");
  }

  function practiceReviewPhrase(phrase: ReviewPhrase) {
    openScenario(
      phrase.scenarioId,
      `Run a short correction drill. Say this natural version out loud: “${phrase.improved}”. Explain the meaning briefly, ask me to repeat it, then give feedback on ${phrase.focusArea}.`,
    );
  }

  const canTalk = connectionState === "connected";
  const recentFeedback = progress.recentFeedback.slice(0, 4);
  const dueReviewCount = progress.reviewQueue.filter(
    (phrase) => phrase.nextReviewDate <= dateKey(),
  ).length;

  if (!hasLoadedProgress) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" size={28} aria-hidden="true" />
        <span>Loading your training journey…</span>
      </main>
    );
  }

  if (!progress.profile || isEditingProfile) {
    return (
      <Onboarding
        onComplete={(profile) => {
          setProgress((existing) => beginJourney(existing, profile));
          setIsEditingProfile(false);
          setActiveView("journey");
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="top-band" aria-label="Practice overview">
        <div>
          <p className="eyebrow">Guangzhou Cantonese</p>
          <h1>Speak first. Read almost never.</h1>
        </div>
        <div className={`status-pill status-${connectionState}`}>
          {isGeneratingReview ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : (
            <Activity size={16} aria-hidden="true" />
          )}
          <span>
            {isGeneratingReview
              ? "Reviewing session"
              : statusCopy(connectionState)}
          </span>
        </div>
      </section>

      <nav className="app-nav" aria-label="Main navigation">
        <button
          aria-current={activeView === "practice" ? "page" : undefined}
          className={activeView === "practice" ? "active" : ""}
          onClick={() => setActiveView("practice")}
          type="button"
        >
          <BookOpen size={17} aria-hidden="true" /> Practice
        </button>
        <button
          aria-current={activeView === "journey" ? "page" : undefined}
          className={activeView === "journey" ? "active" : ""}
          disabled={connectionState === "connected"}
          onClick={() => setActiveView("journey")}
          type="button"
        >
          <MapIcon size={17} aria-hidden="true" /> Journey
        </button>
        <button
          aria-current={activeView === "review" ? "page" : undefined}
          className={activeView === "review" ? "active" : ""}
          disabled={connectionState === "connected"}
          onClick={() => setActiveView("review")}
          type="button"
        >
          <RefreshCw size={17} aria-hidden="true" /> Review
          {dueReviewCount ? <span>{dueReviewCount}</span> : null}
        </button>
      </nav>

      {activeView === "practice" ? (
        <section className="workspace" aria-label="Cantonese speaking coach">
          <aside className="scenario-rail" aria-label="Practice scenarios">
            <div className="rail-heading">
              <Waves size={18} aria-hidden="true" />
              <span>Scenarios</span>
            </div>
            <div className="scenario-list">
              {allScenarios.map((scenario) => (
                <button
                  className={`scenario-card ${scenario.id === selectedScenario.id ? "active" : ""}`}
                  disabled={
                    connectionState === "connected" &&
                    scenario.id !== selectedScenario.id
                  }
                  key={scenario.id}
                  onClick={() => openScenario(scenario.id)}
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
                <span
                  className={talkState === "listening" ? "wave live" : "wave"}
                />
                <span
                  className={
                    talkState === "listening"
                      ? "wave live delay-one"
                      : "wave delay-one"
                  }
                />
                <span
                  className={
                    talkState === "listening"
                      ? "wave live delay-two"
                      : "wave delay-two"
                  }
                />
                {talkState === "listening" ? (
                  <Mic size={34} />
                ) : (
                  <Volume2 size={34} />
                )}
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
                <button
                  className="secondary-button"
                  onClick={stopSession}
                  type="button"
                >
                  <Square size={17} aria-hidden="true" />
                  Finish
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={isGeneratingReview}
                  onClick={startSession}
                  type="button"
                >
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
                {talkState === "listening" ? (
                  <Pause size={24} />
                ) : (
                  <Mic size={24} />
                )}
                <span>
                  {talkState === "listening" ? "Listening" : "Hold to talk"}
                </span>
              </button>

              <button
                className="secondary-button"
                disabled={
                  isGeneratingReview ||
                  connectionState === "checking-mic" ||
                  connectionState === "connecting"
                }
                onClick={
                  connectionState === "connected" ? endTalking : startSession
                }
                type="button"
              >
                {connectionState === "connected" ? (
                  <MicOff size={17} />
                ) : (
                  <RefreshCw size={17} />
                )}
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
                      sendCoachMessage(
                        realtimeSessionRef.current,
                        `Practice this next: “${prompt}” Ask me one short spoken question, then wait for my answer.`,
                      );
                    } else {
                      setQueuedCoachInstruction(
                        `Practice this next: “${prompt}” Ask me one short spoken question, then wait for my answer.`,
                      );
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
                <p className="empty-copy">
                  Feedback will appear after your first spoken turn.
                </p>
              )}
            </div>
          </aside>
        </section>
      ) : activeView === "journey" ? (
        <JourneyDashboard
          onAddCustomScenario={(scenario) =>
            setProgress((existing) => addCustomScenario(existing, scenario))
          }
          onEditProfile={() => setIsEditingProfile(true)}
          onImport={(serialized) => setProgress(importProgress(serialized))}
          onRemoveCustomScenario={(scenarioId) => {
            if (selectedScenarioId === scenarioId) {
              setSelectedScenarioId(scenarios[0].id);
            }
            setProgress((existing) =>
              removeCustomScenario(existing, scenarioId),
            );
          }}
          onStartScenario={openScenario}
          progress={progress}
          scenarios={allScenarios}
        />
      ) : (
        <ReviewQueue
          onGrade={(phraseId, rating) =>
            setProgress((existing) =>
              gradeReviewPhrase(existing, phraseId, rating),
            )
          }
          onPractice={practiceReviewPhrase}
          phrases={progress.reviewQueue}
        />
      )}
    </main>
  );
}
