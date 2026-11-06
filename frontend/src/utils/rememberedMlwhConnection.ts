/** The MLWH connection details (host, port, user, database) last used successfully in this
 * browser, pre-filled the next time the dev-tools MLWH probe opens so a re-test only needs the
 * password. Never the password itself - that lives only in component state. A per-viewer
 * convenience: reads and writes swallow storage errors (private window, blocked site data). */
const KEY = "runnx.mlwh.connection";

export interface MlwhConnectionDetails {
  host: string;
  port: string;
  user: string;
  database: string;
}

const EMPTY: MlwhConnectionDetails = { host: "", port: "3306", user: "", database: "" };

export function readRememberedMlwhConnection(): MlwhConnectionDetails {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MlwhConnectionDetails> | null;
    return { ...EMPTY, ...saved };
  } catch {
    return EMPTY;
  }
}

export function rememberMlwhConnection({ host, port, user, database }: MlwhConnectionDetails): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ host, port, user, database }));
  } catch {
    /* ignore - remembering is a convenience, not a requirement */
  }
}
