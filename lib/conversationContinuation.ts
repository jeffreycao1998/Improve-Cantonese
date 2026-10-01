export const CONVERSATION_FOLLOW_UP_MS = 6000;

// One continuation per learner interaction, including the opening lesson.
// Coach speech alone must not rearm this and keep an unattended session alive.
export class ConversationContinuation {
  private coachSpoke = false;
  private available = true;

  activity(speaker: "coach" | "learner") {
    if (speaker === "coach") this.coachSpoke = true;
    else this.available = true;
  }

  shouldContinue(quietMs: number) {
    if (!this.coachSpoke || !this.available || quietMs < CONVERSATION_FOLLOW_UP_MS) return false;
    this.available = false;
    return true;
  }
}
