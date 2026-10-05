/** The credit-case owner last saved in this browser, offered as the default the next time an
 * owner is entered - never applied without the user saving it. A per-viewer convenience: reads
 * and writes swallow storage errors (private window, blocked site data). */
const KEY = "runnx.credit.owner";

export function readRememberedOwner(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberOwner(owner: string | null): void {
  if (!owner) return;
  try {
    localStorage.setItem(KEY, owner);
  } catch {
    /* ignore - remembering is a convenience, not a requirement */
  }
}
