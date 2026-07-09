/** Thin fetch wrapper - the one seam that needs to change when real auth arrives
 * (add an Authorization header or credentials:'include' here, nowhere else). Calls
 * are always relative paths (/api/...), proxied same-origin by nginx in prod and by
 * the Vite dev server locally - see vite.config.ts. */

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

function extractDetail(body: unknown): string | undefined {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

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
