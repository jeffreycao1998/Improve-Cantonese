import { describe, expect, it } from "vitest";
import { getKeyboardCommand } from "@/lib/keyboardShortcuts";

function shortcutEvent(
  key: string,
  overrides: Partial<Parameters<typeof getKeyboardCommand>[0]> = {},
) {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    repeat: false,
    target: null,
    ...overrides,
  };
}

describe("getKeyboardCommand", () => {
  it.each([
    ["1", "practice"],
    ["2", "journey"],
    ["3", "review"],
    ["4", "history"],
    ["?", "help"],
    ["Escape", "dismiss"],
  ])("maps %s to %s", (key, command) => {
    expect(getKeyboardCommand(shortcutEvent(key))).toBe(command);
  });

  it("ignores unknown, modified, and repeated keys", () => {
    expect(getKeyboardCommand(shortcutEvent("5"))).toBeNull();
    expect(
      getKeyboardCommand(shortcutEvent("1", { ctrlKey: true })),
    ).toBeNull();
    expect(getKeyboardCommand(shortcutEvent("?", { repeat: true }))).toBeNull();
  });
});
