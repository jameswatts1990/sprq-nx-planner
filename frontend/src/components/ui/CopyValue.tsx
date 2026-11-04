import { useEffect, useRef, useState } from "react";

import { copyText } from "@/utils/clipboard";

import styles from "./CopyValue.module.css";

type CopyState = "idle" | "copied" | "failed";

export interface CopyValueProps {
  value: string;
  /** What the value is, for the tooltip and screen readers, e.g. "Pool ID". */
  label: string;
  /** Called after a successful copy (e.g. to mark a well as entered). */
  onCopied?: () => void;
}

/** A value shown as a one-click copy button, for pasting into another system (e.g. Traction).
 * Confirms with a brief "Copied". If the browser blocks the copy, it selects the value and says
 * "Press Ctrl+C" instead, so a failed copy is never silent. */
export function CopyValue({ value, label, onCopied }: CopyValueProps) {
  const [state, setState] = useState<CopyState>("idle");
  const valueRef = useRef<HTMLSpanElement>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function onClick() {
    const ok = await copyText(value);
    window.clearTimeout(resetTimer.current);
    if (ok) {
      setState("copied");
      onCopied?.();
      resetTimer.current = window.setTimeout(() => setState("idle"), 1500);
      return;
    }
    const node = valueRef.current;
    const selection = window.getSelection();
    if (node && selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setState("failed");
  }

  return (
    <button
      type="button"
      className={styles.copy}
      data-state={state}
      onClick={onClick}
      title={`Copy ${label} to the clipboard`}
    >
      <span ref={valueRef} className={styles.value}>
        {value}
      </span>
      <span className={styles.action} aria-live="polite">
        {state === "copied" ? "✓ Copied" : state === "failed" ? "Press Ctrl+C" : "Copy"}
      </span>
    </button>
  );
}
