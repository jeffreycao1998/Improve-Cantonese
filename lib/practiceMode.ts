export type PracticeMode = "normal" | "super-beginner";

export function isPracticeMode(value: unknown): value is PracticeMode {
  return value === "normal" || value === "super-beginner";
}

export const beginnerPrompts = ["Teach me one useful word.", "Repeat that slowly.", "Help me pronounce it.", "Teach me something harder."];
