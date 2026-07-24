import { describe, it, expect, beforeEach } from "vitest";
import { LocalMockExamTimingStore } from "../lib/mockExamTimingStore.local";
import { DEFAULT_MOCK_EXAM_TIMING_CONFIG } from "../core/mockExamTiming";

describe("LocalMockExamTimingStore", () => {
  beforeEach(() => localStorage.clear());

  it("returns the default config when nothing has been saved", async () => {
    const store = new LocalMockExamTimingStore();
    const config = await store.getConfig();
    expect(config).toEqual(DEFAULT_MOCK_EXAM_TIMING_CONFIG);
  });

  it("saves and retrieves an updated config", async () => {
    const store = new LocalMockExamTimingStore();
    await store.saveConfig({
      enabled: true,
      step1: { label: "지문독해", range: "18~28번", targetMinutes: 12 },
      step2: { label: "빈칸추론", range: "35~45번", targetMinutes: 20 },
      step3: { label: "순서삽입", range: "29~34번", targetMinutes: 15 },
    });
    const config = await store.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.step1.targetMinutes).toBe(12);
    expect(config.step1.label).toBe("지문독해");
  });
});
