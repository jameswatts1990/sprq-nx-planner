import { useSyncExternalStore } from "react";

/** Who is using this browser - set from the navbar name chip. api/client.ts sends it with every
 * request as X-RunNx-Actor, so the audit trail (History → Activity) names who made each change,
 * and it prefills the Confirm-loaded "Your name" and a credit case's owner. Per browser, in
 * localStorage; storage errors (private window, blocked site data) just mean "no name yet". */

const KEY = "runnx.operator";
/** Where the Batch Sheet loader and the credit owner used to be remembered - adopted once, on the
 * first read, so nobody has to type their name again. */
const LEGACY_KEYS = ["runnx.batchSheet.loadedBy", "runnx.credit.owner"];
/** The backend's audit actor column is 120 characters. */
export const OPERATOR_NAME_MAX = 120;

const listeners = new Set<() => void>();
let cached: string | null = null;

function readStored(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored;
    const legacy = LEGACY_KEYS.map((k) => localStorage.getItem(k)?.trim() ?? "").find(Boolean) ?? "";
    if (legacy) localStorage.setItem(KEY, legacy);
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    return legacy;
  } catch {
    return "";
  }
}

export function getOperatorName(): string {
  cached ??= readStored();
  return cached;
}

export function setOperatorName(name: string): void {
  const next = name.trim().slice(0, OPERATOR_NAME_MAX);
  cached = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the name lasts until the tab closes.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  // Another tab changed the name: drop the cache so the next read picks it up.
  function onStorage(e: StorageEvent) {
    if (e.key !== null && e.key !== KEY) return;
    cached = null;
    notify();
  }
  listeners.add(notify);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

/** The operator name, re-rendering when it's changed here or in another tab. */
export function useOperatorName(): string {
  return useSyncExternalStore(subscribe, getOperatorName);
}
