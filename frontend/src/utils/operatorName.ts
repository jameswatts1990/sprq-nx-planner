import { useSyncExternalStore } from "react";

/** Who is using this browser - set from the navbar name chip. api/client.ts sends it with every
 * request as X-RunNx-Actor, so the audit trail (History → Activity) names who made each change,
 * and it prefills the Confirm-loaded "Your name" and a credit case's owner. Per browser, in
 * localStorage; storage errors (private window, blocked site data) just mean "no name yet".
 *
 * The browser also keeps every name picked on it, for the chip's drop-down: on someone's own
 * computer that's just them, on a shared one it's everyone who uses it. Names are only ever
 * removed by hand (the drop-down's ×). */

const KEY = "runnx.operator";
const NAMES_KEY = "runnx.operators";
/** Where the Batch Sheet loader and the credit owner used to be remembered - adopted once, on the
 * first read, so nobody has to type their name again. */
const LEGACY_KEYS = ["runnx.batchSheet.loadedBy", "runnx.credit.owner"];
/** The backend's audit actor column is 120 characters. */
export const OPERATOR_NAME_MAX = 120;

const listeners = new Set<() => void>();
let cached: string | null = null;
let cachedNames: string[] | null = null;

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

function readStoredNames(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NAMES_KEY) ?? "null");
    if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === "string" && n !== "");
  } catch {
    // Blocked or unreadable: fall through.
  }
  // No list yet (a browser whose name was set before the list existed): start it with that name.
  const current = getOperatorName();
  return current ? [current] : [];
}

function storeNames(names: string[]): void {
  cachedNames = names;
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // Storage blocked: the list lasts until the tab closes.
  }
}

function notifyAll(): void {
  listeners.forEach((notify) => notify());
}

export function getOperatorName(): string {
  cached ??= readStored();
  return cached;
}

/** Every name picked in this browser, in the order they were first picked. */
export function getOperatorNames(): string[] {
  cachedNames ??= readStoredNames();
  return cachedNames;
}

/** Sign this browser as `name` (blank = sign out), adding it to the browser's list of names. */
export function setOperatorName(name: string): void {
  const next = name.trim().slice(0, OPERATOR_NAME_MAX);
  cached = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the name lasts until the tab closes.
  }
  const names = getOperatorNames();
  if (next && !names.includes(next)) storeNames([...names, next]);
  notifyAll();
}

/** Take a name off this browser's list - signing out too if it's the current name. */
export function forgetOperatorName(name: string): void {
  storeNames(getOperatorNames().filter((n) => n !== name));
  if (getOperatorName() === name) setOperatorName("");
  else notifyAll();
}

function subscribe(notify: () => void): () => void {
  // Another tab changed the name or the list: drop the caches so the next read picks them up.
  function onStorage(e: StorageEvent) {
    if (e.key !== null && e.key !== KEY && e.key !== NAMES_KEY) return;
    cached = null;
    cachedNames = null;
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

/** This browser's list of names, re-rendering when it changes here or in another tab. */
export function useOperatorNames(): string[] {
  return useSyncExternalStore(subscribe, getOperatorNames);
}
