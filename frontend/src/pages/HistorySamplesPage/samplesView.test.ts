import { describe, expect, it } from "vitest";

import { writeListView } from "@/utils/listView";

import { DEFAULT_SAMPLES_VIEW, SAMPLES_VIEW, sampleHistoryParams } from "./samplesView";

describe("SAMPLES_VIEW.read", () => {
  it("shows every sample, most recently updated first, by default", () => {
    expect(SAMPLES_VIEW.read(new URLSearchParams())).toEqual(DEFAULT_SAMPLES_VIEW);
    expect(sampleHistoryParams(DEFAULT_SAMPLES_VIEW)).toMatchObject({
      status: undefined,
      priority: undefined,
      sort_by: "updated_at",
      sort_dir: "desc",
    });
  });

  it("ignores a garbled URL", () => {
    expect(SAMPLES_VIEW.read(new URLSearchParams("status=lost&sort=created_at&dir=up&size=3"))).toEqual(
      DEFAULT_SAMPLES_VIEW,
    );
  });
});

describe("sampleHistoryParams", () => {
  it("sends Finished as completed + failed", () => {
    expect(sampleHistoryParams({ ...DEFAULT_SAMPLES_VIEW, status: "finished" }).status).toBe("completed,failed");
    expect(sampleHistoryParams({ ...DEFAULT_SAMPLES_VIEW, status: "in_progress" }).status).toBe("in_progress");
  });

  it("keeps a priority filter in the URL and sends it", () => {
    const url = writeListView(SAMPLES_VIEW, new URLSearchParams(), { priority: "High" });
    expect(url.toString()).toBe("priority=High");
    expect(sampleHistoryParams(SAMPLES_VIEW.read(url)).priority).toBe("High");
  });
});
