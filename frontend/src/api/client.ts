/** Thin fetch wrapper - the one seam that needs to change when real auth arrives
 * (add an Authorization header or credentials:'include' here, nowhere else). Calls
 * are always relative paths (/api/...), proxied same-origin by nginx in prod and by
 * the Vite dev server locally - see vite.config.ts. */

import { getOperatorName } from "@/utils/operatorName";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** status 0: the request never reached the server (offline, server down, blocked). */
const NO_RESPONSE = 0;

/** The one way to turn a failed mutation/query error into user-facing text. Fallbacks follow the
 * app's error voice - "Couldn't <do the thing>." - and this adds what went wrong and what to do:
 * - the server's own sentence when it sent one (a 409 "already loaded", a 422 "at least one barcode");
 * - a rejected form value (a 422 listing fields) as "field: reason";
 * - a server fault (5xx) or no answer at all as a plain "try again" line - never a stack trace. */
export function errorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === NO_RESPONSE) {
    return `${fallback} RunNx couldn't reach its server — check your connection, then try again.`;
  }
  if (err.status >= 502 && err.status <= 504) {
    return `${fallback} The RunNx server isn't answering — it may be restarting. Try again in a minute.`;
  }
  if (err.status >= 500) {
    return `${fallback} The server hit a problem. Try again, and if it keeps happening tell whoever looks after RunNx.`;
  }
  if (err.status === 422) {
    const fields = rejectedFields(err.body);
    if (fields) return `${fallback} Not accepted — ${fields}.`;
  }
  return err.message.startsWith("API error") ? fallback : err.message;
}

/** FastAPI's request-validation 422 lists each rejected value as {loc, msg}: "objective: Input
 * should be …; movie time hours: …". Null when the body isn't that shape. */
function rejectedFields(body: unknown): string | null {
  const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : null;
  if (!Array.isArray(detail) || detail.length === 0) return null;
  return detail
    .slice(0, 3)
    .map((item: { loc?: unknown[]; msg?: string }) => {
      const field = (item.loc ?? []).filter((part) => part !== "body" && part !== "query").join(" ").replace(/_/g, " ");
      return field ? `${field}: ${item.msg ?? "invalid"}` : (item.msg ?? "invalid value");
    })
    .join("; ");
}

function extractDetail(body: unknown): string | undefined {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const operator = getOperatorName();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        // Cross-site write guard: the backend 403s any /api write without it (main.py
        // block_cross_site_writes). Sent on reads too, so no call site has to think about it.
        "X-RunNx": "1",
        // Who is making the change, for the audit trail (deps.get_actor). URI-encoded because
        // HTTP headers only carry ASCII and names don't.
        ...(operator ? { "X-RunNx-Actor": encodeURIComponent(operator) } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // fetch only rejects when no response came back at all; a caller's own abort stays an abort.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(NO_RESPONSE, null, "No response from the server.");
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not all error responses are JSON */
    }
    throw new ApiError(res.status, body, extractDetail(body));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  // `del` (not `delete`, a reserved word) - used for 204-no-body endpoints like
  // DELETE /api/cell-uses/{id}; request() returns undefined for a 204.
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

type QueryValue = string | number | boolean | undefined | null;

// `params: object` (not Record<string, QueryValue>) deliberately - named interfaces without
// an explicit index signature (e.g. ListSamplesParams) aren't assignable to an indexed Record
// type in TypeScript, but any interface instance is trivially assignable to `object`.
export function buildQuery(params: object): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, QueryValue][]) {
    if (value !== undefined && value !== null && value !== "") usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}
