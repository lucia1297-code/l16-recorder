import { describe, it, expect } from "vitest";
import {
  computeAssignmentStatus,
  countSubmissionsForType,
  validateAssignmentTypeInput,
  validateSubmissionInput,
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentSubmission,
  type AssignmentType,
} from "../core/assignment";

function sub(over: Partial<AssignmentSubmission> = {}): AssignmentSubmission {
  return {
    id: "s1",
    studentCode: "S1001",
    typeId: "t1",
    round: 1,
    score: null,
    wrongNumbers: [],
    submittedAt: "2026-07-13T10:00:00.000Z",
    ...over,
  };
}

describe("computeAssignmentStatus", () => {
  it("returns good when submitted count meets or exceeds target", () => {
    expect(computeAssignmentStatus(3, 3)).toBe("good");
    expect(computeAssignmentStatus(5, 3)).toBe("good");
  });
  it("returns not_bad when partially submitted", () => {
    expect(computeAssignmentStatus(1, 3)).toBe("not_bad");
    expect(computeAssignmentStatus(2, 3)).toBe("not_bad");
  });
  it("returns warning when nothing submitted", () => {
    expect(computeAssignmentStatus(0, 3)).toBe("warning");
  });
  it("returns none when there is no target set", () => {
    expect(computeAssignmentStatus(0, 0)).toBe("none");
    expect(computeAssignmentStatus(2, 0)).toBe("none");
  });
});

describe("ASSIGNMENT_STATUS_LABELS", () => {
  it("has the exact labels requested", () => {
    expect(ASSIGNMENT_STATUS_LABELS.good).toBe("good");
    expect(ASSIGNMENT_STATUS_LABELS.not_bad).toBe("not bad");
    expect(ASSIGNMENT_STATUS_LABELS.warning).toBe("경고");
  });
});

describe("countSubmissionsForType", () => {
  it("counts only submissions matching student and type", () => {
    const rows = [
      sub({ id: "a", studentCode: "S1001", typeId: "t1" }),
      sub({ id: "b", studentCode: "S1001", typeId: "t1", round: 2 }),
      sub({ id: "c", studentCode: "S1001", typeId: "t2" }),
      sub({ id: "d", studentCode: "S1002", typeId: "t1" }),
    ];
    expect(countSubmissionsForType(rows, "S1001", "t1")).toBe(2);
    expect(countSubmissionsForType(rows, "S1001", "t2")).toBe(1);
    expect(countSubmissionsForType(rows, "S1002", "t1")).toBe(1);
    expect(countSubmissionsForType(rows, "S9999", "t1")).toBe(0);
  });
});

describe("validateAssignmentTypeInput", () => {
  const existing: AssignmentType[] = [
    { id: "1", name: "모의고사 풀이", targetCount: 5 },
  ];

  it("accepts a valid new type", () => {
    expect(validateAssignmentTypeInput({ name: "어휘테스트", targetCount: 3 }, existing).length).toBe(0);
  });
  it("rejects when 8 types already exist", () => {
    const full = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `t${i}`, targetCount: 1 }));
    expect(
      validateAssignmentTypeInput({ name: "새유형", targetCount: 1 }, full).some((e) => e.includes("8")),
    ).toBe(true);
  });
  it("rejects a duplicate name", () => {
    expect(
      validateAssignmentTypeInput({ name: "모의고사 풀이", targetCount: 5 }, existing).some((e) =>
        e.includes("중복"),
      ),
    ).toBe(true);
  });
  it("rejects empty name or non-positive target", () => {
    expect(validateAssignmentTypeInput({ name: "", targetCount: 3 }, existing).length).toBeGreaterThan(0);
    expect(validateAssignmentTypeInput({ name: "새유형", targetCount: 0 }, existing).length).toBeGreaterThan(0);
  });
});

describe("validateSubmissionInput", () => {
  it("accepts a minimal valid submission (round only)", () => {
    expect(validateSubmissionInput({ round: 1, score: null, wrongNumbers: [] }).length).toBe(0);
  });
  it("accepts free-form wrong numbers and score", () => {
    expect(
      validateSubmissionInput({ round: 6, score: 88, wrongNumbers: [3, 17, 40] }).length,
    ).toBe(0);
  });
  it("rejects a non-positive round", () => {
    expect(validateSubmissionInput({ round: 0, score: null, wrongNumbers: [] }).length).toBeGreaterThan(0);
  });
  it("rejects a negative score", () => {
    expect(validateSubmissionInput({ round: 1, score: -5, wrongNumbers: [] }).length).toBeGreaterThan(0);
  });
});
