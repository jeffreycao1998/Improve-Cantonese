export type KeyboardCommand =
  "practice" | "journey" | "review" | "history" | "help" | "dismiss";

const commandByKey: Record<string, KeyboardCommand> = {
  "1": "practice",
  "2": "journey",
  "3": "review",
  "4": "history",
  "?": "help",
  Escape: "dismiss",
};

type ShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "repeat" | "target"
>;

function isEditableTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function getKeyboardCommand(event: ShortcutEvent) {
  if (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    isEditableTarget(event.target)
  ) {
    return null;
  }

  return commandByKey[event.key] ?? null;
}
