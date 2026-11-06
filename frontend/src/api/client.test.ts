import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, errorMessage } from "./client";

const FALLBACK = "Couldn't save the sample.";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("errorMessage", () => {
  it("passes the server's own sentence through", () => {
    expect(errorMessage(new ApiError(409, null, "A completed sample can no longer be edited"), FALLBACK)).toBe(
      "A completed sample can no longer be edited",
    );
    expect(errorMessage(new ApiError(422, { detail: "At least one barcode is required" }, "At least one barcode is required"), FALLBACK)).toBe(
      "At least one barcode is required",
    );
  });

  it("names each rejected form value instead of dumping the validation JSON", () => {
    const body = {
      detail: [
        { loc: ["body", "objective"], msg: "Input should be 'fewest' or 'fastest'", type: "literal_error" },
        { loc: ["body", "movie_time_hours"], msg: "Input should be a valid integer", type: "int_parsing" },
      ],
    };
    expect(errorMessage(new ApiError(422, body, JSON.stringify(body.detail)), FALLBACK)).toBe(
      "Couldn't save the sample. Not accepted — objective: Input should be 'fewest' or 'fastest'; movie time hours: Input should be a valid integer.",
    );
  });

  it("never shows a server fault's body", () => {
    expect(errorMessage(new ApiError(500, null), FALLBACK)).toMatch(/^Couldn't save the sample\. The server hit a problem\./);
    expect(errorMessage(new ApiError(503, null), FALLBACK)).toMatch(/may be restarting/);
  });

  it("falls back for a bare status and for anything that isn't an API error", () => {
    expect(errorMessage(new ApiError(404, null), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new Error("boom"), FALLBACK)).toBe(FALLBACK);
  });
});

describe("request", () => {
  it("turns a dropped connection into a 'couldn't reach the server' message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.get("/api/samples").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(errorMessage(err, "Couldn't load the samples.")).toBe(
      "Couldn't load the samples. RunNx couldn't reach its server — check your connection, then try again.",
    );
  });

  it("signs every request with the operator name, URI-encoded", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "Zoë O'Brien", setItem: () => {}, removeItem: () => {} });
    vi.resetModules();
    const { api: freshApi } = await import("./client");
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await freshApi.get("/api/samples");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-RunNx-Actor"]).toBe(encodeURIComponent("Zoë O'Brien"));
    expect(headers["X-RunNx"]).toBe("1");
  });
});
