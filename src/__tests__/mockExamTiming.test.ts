import { describe, it, expect } from "vitest";
import {
  evaluateStepTiming,
  DEFAULT_MOCK_EXAM_TIMING_CONFIG,
  TIMING_EVALUATION_LABELS,
} from "../core/mockExamTiming";

describe("DEFAULT_MOCK_EXAM_TIMING_CONFIG", () => {
  it("has the exact target minutes and question ranges requested", () => {
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.step1.targetMinutes).toBe(10);
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.step1.range).toBe("18~28번");
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.step2.targetMinutes).toBe(17);
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.step2.range).toBe("35~45번");
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.step3.targetMinutes).toBe(17);
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.step3.range).toBe("29~34번");
  });

  it("defaults to disabled (세부내용 첨부 = No)", () => {
    expect(DEFAULT_MOCK_EXAM_TIMING_CONFIG.enabled).toBe(false);
  });
});

describe("evaluateStepTiming", () => {
  it("returns on_target when within tolerance of the target", () => {
    expect(evaluateStepTiming(10, 10)).toBe("on_target");
    expect(evaluateStepTiming(9, 10)).toBe("on_target");
    expect(evaluateStepTiming(12, 10)).toBe("on_target");
  });

  it("returns fast when meaningfully under target", () => {
    expect(evaluateStepTiming(5, 10)).toBe("fast");
  });

  it("returns slow when meaningfully over target", () => {
    expect(evaluateStepTiming(20, 17)).toBe("slow");
  });

  it("matches the requested targets (10/17/17) for a realistic case", () => {
    // step1 target 10, student took 15 -> slow
    expect(evaluateStepTiming(15, 10)).toBe("slow");
    // step2 target 17, student took 16 -> on_target
    expect(evaluateStepTiming(16, 17)).toBe("on_target");
    // step3 target 17, student took 8 -> fast
    expect(evaluateStepTiming(8, 17)).toBe("fast");
  });
});

describe("TIMING_EVALUATION_LABELS", () => {
  it("has Korean labels for all three outcomes", () => {
    expect(TIMING_EVALUATION_LABELS.fast).toBeTruthy();
    expect(TIMING_EVALUATION_LABELS.on_target).toBeTruthy();
    expect(TIMING_EVALUATION_LABELS.slow).toBeTruthy();
  });
});
