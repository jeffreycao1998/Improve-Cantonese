import WebSocket from "ws";
import { randomBytes } from "node:crypto";

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
type Status = "connecting" | "armed" | "closing" | "confirmed" | "unconfirmed";

export class SessionWatchdog {
  readonly token = randomBytes(32).toString("hex");
  status: Status = "connecting";
  private lastHeartbeat: number;
  private socket?: WebSocket;
  private poll: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private finalTimeout?: ReturnType<typeof setTimeout>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  readonly ready: Promise<void>;

  constructor(
    private sessionId: string,
    private apiKey: string,
    private now: () => number = () => performance.now(),
    private createSocket: (url: string, options: WebSocket.ClientOptions) => WebSocket = (url, options) => new WebSocket(url, options)
  ) {
    this.lastHeartbeat = now();
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.ready.catch(() => {});
    this.poll = setInterval(() => this.checkDeadline(), 1000);
    this.poll.unref();
    this.connect();
  }

  private connect() {
    if (this.terminal()) return;
    const socket = this.createSocket(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(this.sessionId)}/attach`,
      { headers: { Authorization: `Bearer ${this.apiKey}`, "OpenAI-Safety-Identifier": "local-cantonese-speaking-coach" }, handshakeTimeout: 10_000 }
    );
    this.socket = socket;
    socket.on("open", () => {
      if (this.socket !== socket || this.terminal()) return;
      if (this.status === "closing") this.sendClose();
      else { this.status = "armed"; this.resolveReady(); }
    });
    socket.on("message", (raw) => {
      if (this.socket !== socket || this.terminal()) return;
      let event: { type?: string; usage?: { seconds?: number } };
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === "session.closed") {
        this.status = "confirmed";
        this.dispose();
      } else if (event.type === "error" && this.status === "closing") {
        // A rejected close is not a successful close; retry on a fresh sideband.
        socket.close();
      }
    });
    socket.on("error", () => {
      if (this.socket !== socket || this.terminal()) return;
      this.rejectReady(new Error("Could not connect the server session watchdog."));
      this.requestClose();
      socket.terminate();
    });
    socket.on("close", () => {
      if (this.socket !== socket || this.terminal()) return;
      this.rejectReady(new Error("The server watchdog connection closed."));
      this.requestClose();
      clearTimeout(this.finalTimeout);
      this.retry = setTimeout(() => this.connect(), 2000);
      this.retry.unref();
    });
    socket.on("unexpected-response", (request, response) => {
      if (this.socket !== socket || this.terminal()) { request.destroy(); socket.terminate(); return; }
      if (response.statusCode === 404 || response.statusCode === 410) {
        // The provider no longer has this session. Stop retries, but never
        // represent missing final usage as confirmed billing information.
        this.status = "unconfirmed";
        this.rejectReady(new Error("The OpenAI session is no longer available."));
        console.warn("GPT-Live watchdog: session unavailable; final usage unconfirmed.");
        this.dispose();
      }
      request.destroy();
      socket.terminate();
    });
  }

  private terminal() { return this.status === "confirmed" || this.status === "unconfirmed"; }

  heartbeat() {
    this.checkDeadline();
    if (this.status !== "armed") return false;
    this.lastHeartbeat = this.now();
    return true;
  }

  checkDeadline() {
    if (!this.terminal() && this.now() - this.lastHeartbeat >= HEARTBEAT_TIMEOUT_MS) this.requestClose();
  }

  requestClose() {
    if (this.terminal()) return;
    const wasClosing = this.status === "closing";
    this.status = "closing";
    if (!wasClosing) this.sendClose();
  }

  private sendClose() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "session.close", event_id: randomBytes(16).toString("hex") }));
    clearTimeout(this.finalTimeout);
    this.finalTimeout = setTimeout(() => {
      if (this.status !== "confirmed") {
        console.warn("GPT-Live watchdog: closure unconfirmed; reconnecting to retry.");
        this.socket?.terminate();
      }
    }, 15_000);
    this.finalTimeout.unref();
  }

  private dispose() {
    clearInterval(this.poll);
    clearTimeout(this.retry);
    clearTimeout(this.finalTimeout);
    this.socket?.close();
    this.apiKey = "";
  }
}

// Keep the registry across Next.js development reloads in this Node process.
const shared = globalThis as typeof globalThis & { cantoneseWatchdogs?: Map<string, SessionWatchdog> };
const watchdogs = shared.cantoneseWatchdogs ??= new Map<string, SessionWatchdog>();

export async function registerWatchdog(sessionId: string, apiKey: string) {
  const watchdog = new SessionWatchdog(sessionId, apiKey);
  watchdogs.set(watchdog.token, watchdog);
  // Completed entries need only remain long enough for the last heartbeat.
  const cleanup = setInterval(() => {
    if (watchdog.status === "confirmed" || watchdog.status === "unconfirmed") {
      watchdogs.delete(watchdog.token);
      clearInterval(cleanup);
    }
  }, 60_000);
  cleanup.unref();
  try { await watchdog.ready; } catch (error) { watchdog.requestClose(); throw error; }
  return { token: watchdog.token, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS, heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS };
}

export function controlWatchdog(token: string, action: "heartbeat" | "close") {
  const watchdog = watchdogs.get(token);
  if (!watchdog) return null;
  if (action === "close") watchdog.requestClose();
  else watchdog.heartbeat();
  return watchdog.status;
}
