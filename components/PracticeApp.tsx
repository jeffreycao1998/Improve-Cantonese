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
import { LiveSession, type LiveEvent } from "@/lib/liveSession";
import { SessionMeter } from "@/components/SessionMeter";
import { PronunciationCaption } from "@/components/PronunciationCaption";
import { isPracticeLanguage, languageSettings, type PracticeLanguage } from "@/lib/languages";
import { beginnerPrompts, isPracticeMode, type PracticeMode } from "@/lib/practiceMode";
import { summarizeConversation, CONVERSATION_SUMMARY_LIMIT } from "@/lib/conversationMemory";
import { addTranscriptFragment, getLatestCaption, getSpeakerText, type TranscriptFragment } from "@/lib/liveTranscript";
import { emptySessionUsage, updateSessionUsage, getSessionMetrics } from "@/lib/liveUsage";
import {
  completeSession,
  defaultProgress,
  loadProgress,
  recordFeedback,
  saveProgress
} from "@/lib/progress";
import { adaptScenario, getScenario, scenarios } from "@/lib/scenarios";
import type {
  LocalProgress,
  PracticeScenario,
  PracticeSession,
  PracticeTurnFeedback
} from "@/lib/types";

type ConnectionState = "idle" | "paused" | "checking-mic" | "connecting" | "connected" | "closing" | "error";
const PAUSED_CONVERSATION_KEY = "cantonese-paused-conversation-v1";
type SavedConversation = { summary: string; scenarioId: PracticeScenario["id"]; language: PracticeLanguage; mode: PracticeMode; elapsedSeconds: number; costUsd: number };
const LANGUAGE_STORAGE_KEY = "speaking-coach-language-v1";
const MODE_STORAGE_KEY = "speaking-coach-mode-v1";
type TalkState = "muted" | "listening";

type CoachLine = {
  id?: string;
  speaker: "coach" | "learner" | "system";
  text: string;
};

function makeSessionId() {
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeFeedbackId() {
  return `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusCopy(state: ConnectionState) {
  if (state === "paused") return "Paused";
  if (state === "checking-mic") {
    return "Checking mic";
  }
  if (state === "connecting") {
    return "Connecting";
  }
  if (state === "connected") {
    return "Live";
  }
  if (state === "closing") return "Finishing";
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

function sendKickoff(session: LiveSession | null, scenario: PracticeScenario, language: PracticeLanguage, mode: PracticeMode) {
  if (mode === "super-beginner") {
    session?.sendMessage(`Lead the ${scenario.title} lesson now in English for a learner who knows zero ${languageSettings[language].name}. Teach one useful word or tiny phrase, explain its English meaning, model it slowly, and give a concrete practice action. After their attempt or acknowledgment, give brief feedback and proactively introduce the next tiny step without needing keep going. Offer one short English hint if they hesitate, then leave room for a reply. This is only the starting level: honor requests for more complex material immediately with a longer useful sentence, new pattern, or supported roleplay. Explain unfamiliar content instead of returning to greetings or thanks.`);
    return;
  }
  session?.sendMessage(`Start the ${scenario.title} practice now. Greet me in ${languageSettings[language].name} immediately, give one short spoken prompt, then continue a natural conversation. Listen while speaking and let me interrupt or ask follow-up questions at any time.`);
}

export function PracticeApp() {
  const [language, setLanguage] = useState<PracticeLanguage>("cantonese");
  const [mode, setMode] = useState<PracticeMode>("normal");
  const languageConfig = languageSettings[language];
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0].id);
  const languageScenarios = useMemo(() => scenarios.map(scenario => adaptScenario(scenario, language)), [language]);
  const selectedScenario = useMemo(
    () => getScenario(selectedScenarioId, language),
    [selectedScenarioId, language]
  );
  const [progress, setProgress] = useState<LocalProgress>(defaultProgress);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [talkState, setTalkState] = useState<TalkState>("muted");
  const [coachLines, setCoachLines] = useState<CoachLine[]>([
    {
      speaker: "system",
      text: "Start the conversation with the selected scenario, or choose another."
    }
  ]);
  const [currentSession, setCurrentSession] = useState<PracticeSession | null>(null);
  const currentSessionRef = useRef<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveCaptions, setLiveCaptions] = useState({ coach: "", learner: "" });
  const [sessionUsage, setSessionUsage] = useState(emptySessionUsage);
  const realtimeSessionRef = useRef<LiveSession | null>(null);
  const transcriptFragmentsRef = useRef<TranscriptFragment[]>([]);
  const feedbackSavedRef = useRef(false);
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pauseRequestedRef = useRef(false);
  const savedConversationRef = useRef<SavedConversation | null>(null);
  const [previousMetrics, setPreviousMetrics] = useState({ elapsedSeconds: 0, costUsd: 0 });
  const [segmentCounted, setSegmentCounted] = useState(false);
  const sessionUsageRef = useRef(sessionUsage);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);



  useEffect(() => {
    let restoredLanguage: PracticeLanguage = "cantonese";
    let restoredMode: PracticeMode = "normal";
    try {
      const modePreference = localStorage.getItem(MODE_STORAGE_KEY);
      if (isPracticeMode(modePreference)) restoredMode = modePreference;
      const preference = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isPracticeLanguage(preference)) restoredLanguage = preference;
      const saved = JSON.parse(localStorage.getItem(PAUSED_CONVERSATION_KEY) ?? "null") as SavedConversation | null;
      if (saved && typeof saved.summary === "string" && saved.summary.length <= CONVERSATION_SUMMARY_LIMIT
        && (saved.language === undefined || isPracticeLanguage(saved.language))
        && (saved.mode === undefined || isPracticeMode(saved.mode))
        && scenarios.some(scenario => scenario.id === saved.scenarioId)
        && Number.isFinite(saved.elapsedSeconds) && saved.elapsedSeconds >= 0
        && Number.isFinite(saved.costUsd) && saved.costUsd >= 0) {
        restoredLanguage = saved.language ?? "cantonese";
        restoredMode = saved.mode ?? "normal";
        savedConversationRef.current = { ...saved, language: restoredLanguage, mode: restoredMode };
        setSelectedScenarioId(saved.scenarioId);
        setPreviousMetrics(saved);
        setSegmentCounted(true);
        setConnectionState("paused");
        const practiceSession: PracticeSession = { id: makeSessionId(), scenarioId: saved.scenarioId, startedAt: new Date().toISOString(), turns: [] };
        currentSessionRef.current = practiceSession;
        setCurrentSession(practiceSession);
        setCoachLines([{ speaker: "system", text: "Your paused conversation is ready to resume." }]);
      }
    } catch { /* Storage may be unavailable or contain an older format. */ }
    setLanguage(restoredLanguage);
    setMode(restoredMode);
    try { setProgress(loadProgress(restoredLanguage)); } catch { setProgress(defaultProgress); }
    setProgressLoaded(true);
  }, []);

  useEffect(() => {
    if (!progressLoaded) return;
    try { saveProgress(progress, language); } catch { /* Keep in-memory progress when storage is unavailable. */ }
  }, [progress, language, progressLoaded]);

  useEffect(() => {
    return () => {
      clearTimeout(captionTimerRef.current);
      realtimeSessionRef.current?.close();
      realtimeSessionRef.current = null;
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

  function finishCoachFeedback() {
    if (feedbackSavedRef.current) return;
    feedbackSavedRef.current = true;
    const fragments = transcriptFragmentsRef.current;
    if (!getSpeakerText(fragments, "learner").trim()) return;
    // Corrections are occasional in a flowing conversation. Save learning notes
    // at the end instead of treating each speaker change as an evaluated turn.
    const notes = getSpeakerText(fragments, "coach")
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => /\b(tone|pitch|pronunciation|rhythm|try saying|try to say|more natural|instead of|correction)\b/i.test(sentence))
      .join(" ");
    if (notes) applyFeedback(notes);
  }

  function handleLiveEvent(event: LiveEvent) {
    if (event.type === "session.idle_timeout") {
      stopSession();
      setError("Conversation ended after 30 seconds of silence. Start a new conversation when you’re ready.");
      return;
    }
    if (["session.created", "session.started", "session.usage.updated", "session.close.requested", "session.closed", "connection.closed"].includes(event.type)) {
      const now = performance.now();
      sessionUsageRef.current = updateSessionUsage(sessionUsageRef.current, event, now);
      setSessionUsage(sessionUsageRef.current);
    }
    if (event.type === "connection.closed") {
      setConnectionState("error");
      setTalkState("muted");
      realtimeSessionRef.current = null;
      return;
    }
    if (event.type === "error") {
      setError(event.error?.message ?? "The voice session reported an error.");
      setConnectionState("error");
      setTalkState("muted");
      realtimeSessionRef.current?.close();
      return;
    }
    if (event.type === "session.closed") {
      if (pauseRequestedRef.current) {
        const segment = getSessionMetrics(sessionUsageRef.current, performance.now());
        const previous = savedConversationRef.current;
        const saved: SavedConversation = {
          summary: summarizeConversation(previous?.summary ?? "", transcriptFragmentsRef.current),
          scenarioId: currentSessionRef.current?.scenarioId ?? selectedScenario.id,
          language,
          mode,
          elapsedSeconds: (previous?.elapsedSeconds ?? 0) + segment.elapsedSeconds,
          costUsd: (previous?.costUsd ?? 0) + segment.costUsd
        };
        savedConversationRef.current = saved;
        setPreviousMetrics(saved);
        setSegmentCounted(true);
        try { localStorage.setItem(PAUSED_CONVERSATION_KEY, JSON.stringify(saved)); }
        catch { setError("Conversation is paused, but browser storage is unavailable. Keep this page open to resume."); }
        pauseRequestedRef.current = false;
        setConnectionState("paused");
        pushLine({ speaker: "system", text: "Paused. OpenAI confirmed session closure. Resume when you’re ready." });
      } else {
        finishCoachFeedback();
        setConnectionState("idle");
      }
      setTalkState("muted");
      realtimeSessionRef.current = null;
      return;
    }
    const fragments = addTranscriptFragment(transcriptFragmentsRef.current, event);
    if (fragments === transcriptFragmentsRef.current) return;
    transcriptFragmentsRef.current = fragments;
    if (captionTimerRef.current === undefined) {
      captionTimerRef.current = setTimeout(() => {
        captionTimerRef.current = undefined;
        const latest = transcriptFragmentsRef.current;
        const next = { coach: getLatestCaption(latest, "coach"), learner: getLatestCaption(latest, "learner") };
        setLiveCaptions(previous => previous.coach === next.coach && previous.learner === next.learner ? previous : next);
      }, 50);
    }
  }

  async function startSession(resume = false) {
    if (connectionState === "connected" || connectionState === "closing" || connectionState === "connecting" || connectionState === "checking-mic") {
      return;
    }

    setError(null);
    setConnectionState("checking-mic");
    const saved = resume ? savedConversationRef.current : null;
    const sessionLanguage = saved?.language ?? language;
    const sessionMode = saved?.mode ?? mode;
    const scenario = saved ? getScenario(saved.scenarioId, sessionLanguage) : selectedScenario;
    setSelectedScenarioId(scenario.id);

    try {
      clearTimeout(captionTimerRef.current);
      captionTimerRef.current = undefined;
      setLiveCaptions({ coach: "", learner: "" });
      realtimeSessionRef.current?.close();
      sessionUsageRef.current = emptySessionUsage();
      setSessionUsage(sessionUsageRef.current);
      setSegmentCounted(false);
      transcriptFragmentsRef.current = [];
      feedbackSavedRef.current = false;
      pauseRequestedRef.current = false;
      if (!resume) {
        savedConversationRef.current = null;
        setPreviousMetrics({ elapsedSeconds: 0, costUsd: 0 });
        try { localStorage.removeItem(PAUSED_CONVERSATION_KEY); } catch { /* Best effort. */ }
      }
      const session = new LiveSession((event) => {
        if (realtimeSessionRef.current === session) handleLiveEvent(event);
      });
      realtimeSessionRef.current = session;
      setConnectionState("connecting");
      await session.connect(scenario.id, saved?.summary, sessionLanguage, sessionMode);
      if (realtimeSessionRef.current !== session) return;
      setTalkState("listening");
      setConnectionState("connected");
      const practiceSession = resume && currentSessionRef.current && !currentSessionRef.current.endedAt ? currentSessionRef.current : {
        id: makeSessionId(),
        scenarioId: scenario.id,
        startedAt: new Date().toISOString(),
        turns: []
      };
      currentSessionRef.current = practiceSession;
      setCurrentSession(practiceSession);
      try { localStorage.removeItem(PAUSED_CONVERSATION_KEY); } catch { /* Best effort. */ }
      pushLine({
        speaker: "system",
        text: `${scenario.title} ${resume ? "has resumed" : "is live"}. Your mic is on — speak whenever you like.`
      });
      if (resume) session.sendMessage(sessionMode === "super-beginner"
        ? `Lead the resumed ${languageSettings[sessionLanguage].name} lesson with English support. Continue at the latest difficulty requested in the saved conversation, rather than restarting greetings or mastered phrases. Give a concrete practice action and proactively introduce new material after my attempt or acknowledgment; do not wait for keep going. Explain unfamiliar vocabulary in English.`
        : `Resume the previous discussion in ${languageSettings[sessionLanguage].name} now. Ask one brief follow-up based on the saved conversation, rather than starting the scenario again.`);
      else sendKickoff(session, scenario, sessionLanguage, sessionMode);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not start the voice coach.";
      setConnectionState("error");
      setTalkState("muted");
      setError(message);
      pushLine({ speaker: "system", text: message });
      realtimeSessionRef.current?.close();
      realtimeSessionRef.current = null;
    }
  }

  function stopSession() {
    pauseRequestedRef.current = false;
    savedConversationRef.current = null;
    try { localStorage.removeItem(PAUSED_CONVERSATION_KEY); } catch { /* Best effort. */ }
    finishCoachFeedback();
    setTalkState("muted");
    setConnectionState(realtimeSessionRef.current ? "closing" : "idle");
    realtimeSessionRef.current?.close();

    if (currentSessionRef.current && !currentSessionRef.current.endedAt) {
      setCurrentSession((session) => session ? {
        ...session,
        endedAt: new Date().toISOString()
      } : session);
      setProgress((existing) => completeSession(existing));
      pushLine({
        speaker: "system",
        text: "Session saved locally."
      });
    }
  }

  function pauseSession() {
    if (connectionState !== "connected") return;
    finishCoachFeedback();
    pauseRequestedRef.current = true;
    setTalkState("muted");
    setConnectionState("closing");
    realtimeSessionRef.current?.close();
  }

  function toggleMicrophone() {
    if (connectionState !== "connected") return;
    const muted = talkState === "listening";
    realtimeSessionRef.current?.mute(muted);
    setTalkState(muted ? "muted" : "listening");
  }

  function changeLanguage(nextLanguage: PracticeLanguage) {
    if (nextLanguage === language || !progressLoaded || realtimeSessionRef.current || (connectionState !== "idle" && connectionState !== "error")) return;
    setLanguage(nextLanguage);
    try {
      setProgress(loadProgress(nextLanguage));
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
      localStorage.removeItem(PAUSED_CONVERSATION_KEY);
    } catch { setProgress(defaultProgress); }
    savedConversationRef.current = null;
    setLiveCaptions({ coach: "", learner: "" });
    transcriptFragmentsRef.current = [];
    setPreviousMetrics({ elapsedSeconds: 0, costUsd: 0 });
    setSegmentCounted(false);
    sessionUsageRef.current = emptySessionUsage();
    setSessionUsage(sessionUsageRef.current);
    setError(null);
    setConnectionState("idle");
    setCoachLines([{ speaker: "system", text: `${languageSettings[nextLanguage].name} practice is ready. Start when you’re ready.` }]);
  }

  function repeatPrompt() {
    if (connectionState !== "connected") {
      return;
    }

    if (mode === "super-beginner") realtimeSessionRef.current?.sendMessage(
      `Choose a fresh ${languageSettings[language].name} practice activity in the current scenario at the learner's latest requested difficulty. Introduce meaningful new material with English support. Do not restart greetings, thanks, or the first lesson unless the learner asks to review them.`
    );
    else sendKickoff(realtimeSessionRef.current, selectedScenario, language, mode);
  }

  function changeMode(nextMode: PracticeMode) {
    if (nextMode === mode || !progressLoaded || realtimeSessionRef.current || (connectionState !== "idle" && connectionState !== "error")) return;
    setMode(nextMode);
    try { localStorage.setItem(MODE_STORAGE_KEY, nextMode); } catch { /* Keep the selected mode in memory. */ }
    setCoachLines([{ speaker: "system", text: nextMode === "super-beginner"
      ? "No vocabulary needed. We’ll start in English and learn one tiny phrase at a time."
      : "Start the conversation with the selected scenario, or choose another." }]);
    setLiveCaptions({ coach: "", learner: "" });
  }

  const canTalk = connectionState === "connected";
  const isBusy = connectionState === "checking-mic" || connectionState === "connecting" || connectionState === "closing";
  const recentFeedback = progress.recentFeedback.slice(0, 4);

  return (
    <main className="app-shell">
      <section className="top-band" aria-label="Practice overview">
        <div>
          <p className="eyebrow">{languageConfig.title}</p>
          <h1>Speak first. Read almost never.</h1>
        </div>
        <div className={`status-pill status-${connectionState}`}>
          <Activity size={16} aria-hidden="true" />
          <span>{connectionState === "closing" && pauseRequestedRef.current ? "Pausing" : statusCopy(connectionState)}</span>
        </div>
      </section>

      <div className="language-controls">
        <div className="language-toggle" role="group" aria-label="Practice language">
          {(["cantonese", "mandarin"] as const).map(option => <button key={option} type="button"
            aria-pressed={language === option}
            disabled={!progressLoaded || !!realtimeSessionRef.current || (connectionState !== "idle" && connectionState !== "error")}
            onClick={() => changeLanguage(option)}>
            {languageSettings[option].name}
          </button>)}
        </div>
        <div className="language-toggle" role="group" aria-label="Learning mode">
          {(["normal", "super-beginner"] as const).map(option => <button key={option} type="button"
            aria-pressed={mode === option}
            disabled={!progressLoaded || !!realtimeSessionRef.current || (connectionState !== "idle" && connectionState !== "error")}
            onClick={() => changeMode(option)}>
            {option === "normal" ? "Normal" : "Super beginner"}
          </button>)}
        </div>
        <p>{connectionState === "paused" || isBusy || canTalk ? "Finish this conversation to switch language or learning mode."
          : mode === "super-beginner" ? `English explanations · One phrase at a time · ${languageConfig.pronunciation} below captions`
          : `${languageConfig.pronunciation} pronunciation shown below captions.`}</p>
      </div>

      <section className="workspace" aria-label={`${languageConfig.name} speaking coach`}>
        <aside className="scenario-rail" aria-label="Practice scenarios">
          <div className="rail-heading">
            <Waves size={18} aria-hidden="true" />
            <span>Scenarios</span>
          </div>
          <div className="scenario-list">
            {languageScenarios.map((scenario) => (
              <button
                className={`scenario-card ${scenario.id === selectedScenario.id ? "active" : ""}`}
                key={scenario.id}
                disabled={connectionState !== "idle" && connectionState !== "error"}
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
                  <small>{mode === "super-beginner" ? "First words" : scenario.level}</small>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>

        <section className="practice-stage" aria-label="Current practice">
          <div className="stage-header">
            <div>
              <p className="eyebrow">{mode === "super-beginner" ? "Super beginner" : selectedScenario.level}</p>
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

          <SessionMeter sessionUsage={sessionUsage} previousMetrics={previousMetrics}
            segmentCounted={segmentCounted} paused={connectionState === "paused"} />

          <div className="voice-panel" aria-live="polite">
            <div className="pulse-field">
              <span className={talkState === "listening" ? "wave live" : "wave"} />
              <span className={talkState === "listening" ? "wave live delay-one" : "wave delay-one"} />
              <span className={talkState === "listening" ? "wave live delay-two" : "wave delay-two"} />
              {talkState === "listening" ? <Mic size={34} /> : <MicOff size={34} />}
            </div>
            <p className="conversation-status">
              {canTalk ? talkState === "listening"
                ? "Mic on · Speak anytime · Auto-close after 30 seconds of silence"
                : "Mic muted · Auto-close after 30 seconds of silence"
                : connectionState === "paused" ? "Paused · Session closed · Resume with saved context"
                : connectionState === "closing" && pauseRequestedRef.current ? "Pausing · Waiting for OpenAI to confirm closure…"
                : "Start a conversation. Your mic will stay on until you mute, pause, or finish."}
            </p>
            <div className="transcript-stack">
              {liveCaptions.coach || liveCaptions.learner ? (
                <>
                  {liveCaptions.coach ? <div className="caption coach-caption">
                    <span>Coach · {languageConfig.pronunciation} below</span><PronunciationCaption text={liveCaptions.coach} language={language} />
                  </div> : null}
                  {liveCaptions.learner ? <div className="caption learner-caption">
                    <span>You · {languageConfig.pronunciation} below</span><PronunciationCaption text={liveCaptions.learner} language={language} />
                  </div> : null}
                </>
              ) : <p>{coachLines[0]?.text ?? "Start when you are ready."}</p>}
            </div>
          </div>

          {error ? (
            <div className="notice" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="control-strip">
            {connectionState === "connected" ? <button className="secondary-button" onClick={pauseSession} type="button">
              <Pause size={17} aria-hidden="true" /> Pause
            </button> : null}
            {connectionState === "connected" || connectionState === "paused" ? (
              <button className="secondary-button" onClick={stopSession} type="button">
                <Square size={17} aria-hidden="true" />
                Finish
              </button>
            ) : (
              <button className="primary-button" disabled={isBusy} onClick={() => void startSession()} type="button">
                <Play size={18} aria-hidden="true" />
                {connectionState === "closing" ? pauseRequestedRef.current ? "Pausing…" : "Finishing…" : isBusy ? "Connecting…" : "Start conversation"}
              </button>
            )}
            {connectionState === "paused" ? <button className="primary-button" onClick={() => void startSession(true)} type="button">
              <Play size={18} aria-hidden="true" /> Resume
            </button> : null}

            <button
              className={`talk-button ${talkState === "listening" ? "listening" : ""}`}
              disabled={!canTalk}
              onClick={toggleMicrophone}
              aria-label={talkState === "listening" ? "Mute microphone" : "Unmute microphone"}
              aria-pressed={canTalk && talkState === "listening"}
              type="button"
            >
              {talkState === "listening" ? <Mic size={24} /> : <MicOff size={24} />}
              <span>{talkState === "listening" ? "Mute mic" : "Unmute mic"}</span>
            </button>

            <button
              className="secondary-button"
              disabled={!canTalk}
              onClick={repeatPrompt}
              type="button"
            >
              <RefreshCw size={17} aria-hidden="true" />
              New prompt
            </button>
          </div>

          <div className="prompt-row" aria-label="Sample prompts">
            {(mode === "super-beginner" ? beginnerPrompts : selectedScenario.samplePrompts).map((prompt) => (
              <button
                key={prompt}
                onClick={() => {
                  pushLine({ speaker: "system", text: prompt });
                  if (connectionState === "connected") {
                    realtimeSessionRef.current?.sendMessage(`The learner requests: ${prompt} Respond in ${languageSettings[language].name}${mode === "super-beginner" ? " with English explanations at the current or explicitly requested difficulty; beginner mode sets the starting level, not a ceiling" : " with the current scenario"}.`);
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
              <p className="empty-copy">Learning notes from the coach’s corrections will appear when you finish.</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
