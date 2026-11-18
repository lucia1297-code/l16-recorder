import { describe, expect, it } from "vitest";
import { createQuickEvent, type CreateQuickEventInput, type JudgmentCode } from "../core/lessonJudgment";

const base: CreateQuickEventInput = {
  eventType: "item_outcome",
  lessonDate: "2026-11-18",
};

describe("createQuickEvent", () => {
  it("creates an unlinked quick event with a required lesson date and empty detail", () => {
    const event = createQuickEvent(base, "2026-11-18T01:02:03.000Z", "event-1");

    expect(event).toMatchObject({
      eventId: "event-1",
      schemaVersion: "1.0",
      eventType: "item_outcome",
      recordedAt: "2026-11-18T01:02:03.000Z",
      lessonDate: "2026-11-18",
      studentCode: null,
      sessionRef: null,
      itemId: null,
      itemVersion: null,
      reasonTags: [],
      recordStatus: "quick_saved",
      detail: {
        initialHypothesis: "",
        observedFact: "",
        studentStatement: "",
        teacherInterpretation: "",
        revisionReason: "",
        strategyApplied: "",
        observedOutcome: "",
        nextHypothesis: "",
      },
    });
    expect(event).not.toHaveProperty("outcome");
  });

  it("keeps hold and unverified as distinct recorded outcomes", () => {
    const held = createQuickEvent({ ...base, outcome: "hold" }, "2026-11-18T00:00:00.000Z", "held");
    const unverified = createQuickEvent({ ...base, outcome: "unverified" }, "2026-11-18T00:00:00.000Z", "unverified");

    expect(held.outcome).toBe("hold");
    expect(unverified.outcome).toBe("unverified");
    expect(held.eventId).not.toBe(unverified.eventId);
  });

  it.each([
    ["judgment_changed", "J-01"],
    ["new_discovery", "J-02"],
    ["explanation_effect", "J-03"],
    ["follow_up_review", "J-04"],
  ] as const)("maps %s to judgment code %s", (eventType, judgmentCode: JudgmentCode) => {
    const event = createQuickEvent({ ...base, eventType }, "2026-11-18T00:00:00.000Z", judgmentCode);

    expect(event.judgmentCode).toBe(judgmentCode);
    expect(event.eventType).toBe(eventType);
  });

  it("preserves optional context without copying student names or item answers", () => {
    const event = createQuickEvent({
      ...base,
      studentCode: "STU-100",
      sessionRef: "STU-100_2026-11-18",
      itemId: "ITEM-22",
      itemVersion: "2",
      outcome: "incorrect",
      reasonTags: ["logic", "time"],
    }, "2026-11-18T01:02:03.000Z", "event-2");

    expect(event).toMatchObject({
      studentCode: "STU-100",
      sessionRef: "STU-100_2026-11-18",
      itemId: "ITEM-22",
      itemVersion: "2",
      outcome: "incorrect",
      reasonTags: ["logic", "time"],
    });
    expect(JSON.stringify(event)).not.toContain("answer");
  });

  it("rejects a malformed lesson date and mismatched result fields", () => {
    expect(() => createQuickEvent({ ...base, lessonDate: "2026-02-30" }, undefined, "bad-date")).toThrow(/lesson date/i);
    expect(() => createQuickEvent({ ...base, eventType: "new_discovery", outcome: "correct" }, undefined, "bad-outcome")).toThrow(/outcome/i);
  });
});
