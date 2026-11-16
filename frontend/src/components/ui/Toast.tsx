import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "./Button";
import styles from "./Toast.module.css";

/**
 * A transient confirmation at the bottom of the screen - "3 samples removed · Undo". Only for
 * success and Undo messages: warnings and errors about the grid stay in its pinned Notes, which
 * never time out. One toast at a time (a new one replaces the old), always closable with ✕, and
 * it lingers while hovered or focused so an Undo is never snatched away mid-reach.
 *
 * A module store, not a context: any component (or a mutation callback) can call showToast
 * without being threaded a handle. <ToastProvider> mounts the one live region that renders it.
 */

export type ToastTone = "good" | "bad";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
}

interface ToastState extends ToastOptions {
  id: number;
}

/** A plain confirmation reads in 5 s; one offering an action (Undo) or reporting a failure gets
 * 15 s, long enough to notice, read and reach for it. */
export const TOAST_MS = 5000;
export const TOAST_ACTION_MS = 15000;

let current: ToastState | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Show a toast, replacing any current one. Returns its id (for dismissToast). */
export function showToast(options: ToastOptions): number {
  current = { ...options, id: nextId++ };
  emit();
  return current.id;
}

/** Close the current toast - or only toast `id`, if it is still the one showing. */
export function dismissToast(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToast() {
  return { show: showToast, dismiss: dismissToast };
}

function ToastView() {
  const toast = useSyncExternalStore(subscribe, () => current);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (toast === null || paused) return;
    const ms = toast.action || toast.tone === "bad" ? TOAST_ACTION_MS : TOAST_MS;
    const timer = setTimeout(() => dismissToast(toast.id), ms);
    return () => clearTimeout(timer);
  }, [toast, paused]);

  useEffect(() => setPaused(false), [toast]);

  return (
    // Always mounted, so screen readers hear a toast that appears inside it.
    <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
      {toast && (
        <div
          className={`${styles.toast} ${toast.tone === "bad" ? styles.bad : ""}`}
          data-testid="toast"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span className={styles.message}>{toast.message}</span>
          {toast.action && (
            <Button size="sm" variant="tonal" onClick={toast.action.onClick}>
              {toast.action.label}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastView />
    </>
  );
}
