import type { LiveSessionResponse } from "@/lib/types";
import { SilenceMonitor } from "@/lib/silenceMonitor";
import type { PracticeLanguage } from "@/lib/languages";
import type { PracticeMode } from "@/lib/practiceMode";
import { ConversationContinuation } from "@/lib/conversationContinuation";

export type LiveEvent = {
  type: string;
  event_id?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  error?: { message?: string };
  usage?: { seconds?: number };
};

export class LiveSession {
  private peer = new RTCPeerConnection();
  private audio = new Audio();
  private microphone: MediaStream | null = null;
  private events = this.peer.createDataChannel("oai-events");
  private closed = false;
  private closing = false;
  private finalized = false;
  private closeTimeout: ReturnType<typeof setTimeout> | undefined;
  private silence: SilenceMonitor;
  private watchdogToken: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private mode: PracticeMode = "normal";
  private micMuted = true;
  private continuation = new ConversationContinuation();

  constructor(private onEvent: (event: LiveEvent) => void) {
    this.silence = new SilenceMonitor(() => {
      this.onEvent({ type: "session.idle_timeout" });
      this.close();
    }, (quietMs) => {
      if (this.micMuted || this.closed || this.closing || this.events.readyState !== "open") return;
      if (this.continuation.shouldContinue(quietMs)) this.sendMessage(
        this.mode === "super-beginner"
          ? "The lesson has gone quiet. Take the lead and speak now: move from your last praise or recap into the next practice activity at the difficulty the learner most recently requested, explaining any new phrase in English and modeling it clearly. If they asked for more complex material, introduce a useful longer sentence or new pattern rather than repeating greetings or thanks. Do not ask whether to continue or wait for the learner to say keep going. Give a concrete action they can try. This is one follow-up; if they remain silent, do not add repeated check-ins."
          : "The conversation has gone quiet. Take the lead and speak now in the selected practice language: naturally build on the last topic, add a brief thought, or ask an easy follow-up that moves the conversation forward. Stay in the current scenario and keep your contribution short. Do not require the learner to say keep going. This is one follow-up; if they remain silent, do not add repeated check-ins."
      );
    }, (speaker) => this.continuation.activity(speaker));
    this.audio.autoplay = true;
    this.peer.addEventListener("track", ({ track }) => {
      this.audio.srcObject = new MediaStream([track]);
      this.silence.addStream(this.audio.srcObject, "coach");
      void this.audio.play().catch(() => this.onEvent({
        type: "error", error: { message: "Audio playback was blocked. Restart the session to try again." }
      }));
    });
    this.events.addEventListener("message", ({ data }) => {
      let event: LiveEvent;
      try { event = JSON.parse(data) as LiveEvent; } catch { return; }
      if (event.type === "session.started") this.silence.start();
      if ((event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") && event.delta?.trim()) {
        this.silence.activity(event.type === "session.input_transcript.delta" ? "learner" : "coach");
      }
      if (event.type === "session.closed") this.finalized = true;
      this.onEvent(event);
      if (event.type === "session.closed") this.cleanup();
    });
    this.events.addEventListener("close", () => {
      if (!this.closed) {
        this.onEvent({ type: "error", error: { message: "The voice connection closed before finalization." } });
        this.cleanup();
      }
    });
    this.peer.addEventListener("connectionstatechange", () => {
      if (this.peer.connectionState === "failed" && !this.closed) {
        this.onEvent({ type: "error", error: { message: "The voice connection failed. Start a new session." } });
        this.cleanup();
      }
    });
  }

  async connect(scenarioId: string, conversationSummary?: string, language: PracticeLanguage = "cantonese", mode: PracticeMode = "normal") {
    this.mode = mode;
    let startupTimeout: ReturnType<typeof setTimeout> | undefined;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const onStartup = ({ data }: MessageEvent) => {
      let event: LiveEvent;
      try { event = JSON.parse(data) as LiveEvent; } catch { return; }
      if (event.type === "session.started") resolveReady();
      if (event.type === "error" || event.type === "session.closed") {
        rejectReady(new Error(event.error?.message ?? "The voice session ended during startup."));
      }
    };
    this.events.addEventListener("message", onStartup);
    void ready.catch(() => {});
    try {
      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      if (this.closed) {
        this.microphone.getTracks().forEach((track) => track.stop());
        throw new Error("The voice session was cancelled.");
      }
      this.mute(false);
      this.silence.addStream(this.microphone);
      this.microphone.getAudioTracks().forEach((track) => this.peer.addTrack(track, this.microphone!));
      await this.peer.setLocalDescription(await this.peer.createOffer());
      await this.waitForIce();
      const sdp = this.peer.localDescription?.sdp;
      if (!sdp) throw new Error("Could not create the microphone connection offer.");
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId, sdp, conversationSummary, language, mode }),
        signal: AbortSignal.timeout(40_000)
      });
      const result = await response.json() as LiveSessionResponse & { error?: string; detail?: { message?: string } };
      if (!response.ok || !result.transport?.sdp || !result.watchdog?.token) {
        throw new Error(result.detail?.message ?? result.error ?? "Could not create a GPT-Live session.");
      }
      this.watchdogToken = result.watchdog.token;
      await this.heartbeat();
      if (this.closed || this.closing) throw new Error("The voice session was cancelled.");
      this.heartbeatTimer = setInterval(() => {
        void this.heartbeat().catch(() => {
          if (this.closed || this.closing) return;
          this.onEvent({ type: "error", error: { message: "The server watchdog is unavailable. Closing the session for safety." } });
          this.close();
        });
      }, result.watchdog.heartbeatIntervalMs);
      this.onEvent({ type: "session.created" });
      await this.peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      startupTimeout = setTimeout(() => rejectReady(new Error("Timed out starting GPT-Live.")), 15_000);
      await ready;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      clearTimeout(startupTimeout);
      this.events.removeEventListener("message", onStartup);
    }
  }

  private waitForIce() {
    if (this.peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onState = () => {
        if (this.peer.iceGatheringState !== "complete") return;
        clearTimeout(timeout);
        this.peer.removeEventListener("icegatheringstatechange", onState);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.peer.removeEventListener("icegatheringstatechange", onState);
        reject(new Error("Timed out connecting the microphone."));
      }, 10_000);
      this.peer.addEventListener("icegatheringstatechange", onState);
      onState();
    });
  }

  mute(muted: boolean) {
    this.micMuted = muted;
    this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  }

  private async heartbeat() {
    const response = await fetch("/api/realtime/watchdog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: this.watchdogToken, action: "heartbeat" }),
      signal: AbortSignal.timeout(5000)
    });
    const body = await response.json();
    if (!response.ok || body.status !== "armed") throw new Error("The server watchdog is not protecting this session.");
  }

  sendMessage(content: string) {
    if (this.closing || this.events.readyState !== "open") return;
    this.events.send(JSON.stringify({
      type: "session.instructions.append",
      event_id: crypto.randomUUID(),
      delegation_id: null,
      content
    }));
  }

  close() {
    if (this.closed || this.closing) return;
    this.closing = true;
    clearInterval(this.heartbeatTimer);
    this.requestServerClose();
    this.silence.stop();
    this.mute(true);
    this.audio.pause();
    this.onEvent({ type: "session.close.requested" });
    if (this.events.readyState !== "open") {
      this.cleanup();
      return;
    }
    this.events.send(JSON.stringify({ type: "session.close" }));
    this.closeTimeout = setTimeout(() => {
      this.onEvent({ type: "error", error: { message: "The voice session closed without confirmed final usage." } });
      this.cleanup();
    }, 15_000);
  }

  private cleanup() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    if (!this.finalized) this.requestServerClose();
    clearTimeout(this.closeTimeout);
    this.silence.dispose();
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.events.close();
    this.peer.close();
    this.audio.pause();
    this.audio.srcObject = null;
    if (!this.finalized) this.onEvent({ type: "connection.closed" });
  }

  private requestServerClose() {
    if (!this.watchdogToken) return;
    void fetch("/api/realtime/watchdog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: this.watchdogToken, action: "close" }),
      keepalive: true,
      signal: AbortSignal.timeout(5000)
    }).catch(() => {});
  }
}
