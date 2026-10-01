export const SILENCE_TIMEOUT_MS = 30_000;

export class SilenceDeadline {
  private lastActivity: number;
  constructor(now: number) { this.lastActivity = now; }
  activity(now: number) { this.lastActivity = now; }
  expired(now: number) { return now - this.lastActivity >= SILENCE_TIMEOUT_MS; }
  elapsed(now: number) { return Math.max(0, now - this.lastActivity); }
}

// Measure actual microphone and incoming audio. Transcript gaps alone do not
// mean silence, and usage heartbeats do not mean anyone is speaking.
export class SilenceMonitor {
  private context = new AudioContext();
  private sources: MediaStreamAudioSourceNode[] = [];
  private analysers: AnalyserNode[] = [];
  private speakers: ("coach" | "learner")[] = [];
  private samples = new Float32Array(2048);
  private deadline: SilenceDeadline | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private onSilence: () => void, private onQuiet?: (quietMs: number) => void, private onActivity?: (speaker: "coach" | "learner") => void) {
    void this.context.resume().catch(() => {});
  }

  addStream(stream: MediaStream, speaker: "coach" | "learner" = "learner") {
    const source = this.context.createMediaStreamSource(stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = this.samples.length;
    source.connect(analyser);
    this.sources.push(source);
    this.analysers.push(analyser);
    this.speakers.push(speaker);
  }

  start() {
    this.deadline = new SilenceDeadline(Date.now());
    this.timer = setInterval(() => {
      // A suspended audio context cannot establish whether speech is present.
      if (this.context.state !== "running") {
        this.activity();
        return;
      }
      const now = Date.now();
      let speaking = false;
      for (const [index, analyser] of this.analysers.entries()) {
        analyser.getFloatTimeDomainData(this.samples);
        const power = this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length;
        if (Math.sqrt(power) >= 0.015) {
          speaking = true;
          this.onActivity?.(this.speakers[index]);
        }
      }
      if (speaking) this.deadline?.activity(now);
      else if (this.deadline?.expired(now)) {
        this.stop();
        this.onSilence();
      } else if (!speaking && this.deadline) this.onQuiet?.(this.deadline.elapsed(now));
    }, 100);
  }

  activity(speaker?: "coach" | "learner") {
    this.deadline?.activity(Date.now());
    if (speaker) this.onActivity?.(speaker);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  dispose() {
    this.stop();
    this.sources.forEach((source) => source.disconnect());
    this.analysers.forEach((analyser) => analyser.disconnect());
    void this.context.close().catch(() => {});
  }
}
