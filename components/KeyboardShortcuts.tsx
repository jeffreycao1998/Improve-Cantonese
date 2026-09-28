"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

type KeyboardShortcutsProps = {
  onClose: () => void;
};

const shortcuts = [
  { key: "1", label: "Open practice" },
  { key: "2", label: "Open journey" },
  { key: "3", label: "Open phrase review" },
  { key: "4", label: "Open session history" },
  { key: "?", label: "Show or hide this guide" },
  { key: "Esc", label: "Close this guide" },
];

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.showModal();
    closeButtonRef.current?.focus();

    return () => {
      dialogRef.current?.close();
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <dialog
      aria-labelledby="shortcut-title"
      className="shortcut-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <section className="shortcut-card">
        <div className="shortcut-heading">
          <div>
            <p className="eyebrow">Move quickly</p>
            <h2 id="shortcut-title">Keyboard shortcuts</h2>
          </div>
          <button
            aria-label="Close keyboard shortcuts"
            className="icon-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p className="shortcut-intro">
          Use these keys anywhere except while typing in a form.
        </p>
        <dl className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.key}>
              <dt>
                <kbd>{shortcut.key}</kbd>
              </dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </dialog>
  );
}
