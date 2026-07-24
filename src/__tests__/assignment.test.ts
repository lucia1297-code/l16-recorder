import { describe, it, expect } from "vitest";
import {
  computeAssignmentStatus,
  countSubmissionsForType,
  computeNextRound,
  isAutoRoundType,
  isMockExamKind,
  getGeneralFieldLabels,
  isPendingReview,
  REVIEW_STATUS_LABELS,
  validateAssignmentTypeInput,
  validateSubmissionInput,
  validateGeneralSubmissionInput,
  validateMockExamTimingInput,
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

describe("computeNextRound", () => {
  it("returns 1 when there are no prior submissions", () => {
    expect(computeNextRound([], "S1001", "t1")).toBe(1);
  });

  it("returns count+1 based on existing submissions for that student/type", () => {
    const rows = [
      sub({ id: "a", studentCode: "S1001", typeId: "t1", round: 1 }),
      sub({ id: "b", studentCode: "S1001", typeId: "t1", round: 2 }),
    ];
    expect(computeNextRound(rows, "S1001", "t1")).toBe(3);
  });

  it("only counts submissions for the matching student and type", () => {
    const rows = [
      sub({ id: "a", studentCode: "S1001", typeId: "t1" }),
      sub({ id: "b", studentCode: "S1002", typeId: "t1" }),
      sub({ id: "c", studentCode: "S1001", typeId: "t2" }),
    ];
    expect(computeNextRound(rows, "S1001", "t1")).toBe(2);
  });
});

describe("isAutoRoundType", () => {
  it("returns false for assignment types whose name mentions 모의고사", () => {
    expect(isAutoRoundType("모의고사 풀이")).toBe(false);
    expect(isAutoRoundType("3월 모의고사")).toBe(false);
  });

  it("returns true for other assignment type names", () => {
    expect(isAutoRoundType("어휘테스트")).toBe(true);
    expect(isAutoRoundType("문법과제")).toBe(true);
    expect(isAutoRoundType("독해과제")).toBe(true);
  });
});

describe("isMockExamKind", () => {
  it("uses the explicit kind field when present, regardless of name", () => {
    expect(isMockExamKind({ id: "1", name: "EBS 수능완성", targetCount: 10, kind: "mock_exam" })).toBe(
      true,
    );
    expect(isMockExamKind({ id: "2", name: "모의고사 풀이", targetCount: 5, kind: "general" })).toBe(
      false,
    );
  });

  it("falls back to the old name-based heuristic when kind is missing (legacy types)", () => {
    expect(isMockExamKind({ id: "3", name: "모의고사 풀이", targetCount: 5 })).toBe(true);
    expect(isMockExamKind({ id: "4", name: "어휘테스트", targetCount: 3 })).toBe(false);
  });
});

describe("getGeneralFieldLabels", () => {
  it("returns the requested defaults when no custom labels are set", () => {
    const labels = getGeneralFieldLabels({ id: "1", name: "단어암기", targetCount: 3 });
    expect(labels.itemLabel).toBe("분야명");
    expect(labels.scopeLabel).toBe("학습내용");
    expect(labels.completedLabel).toBe("완수여부");
  });

  it("uses custom labels when the admin has set them", () => {
    const labels = getGeneralFieldLabels({
      id: "1",
      name: "단어암기",
      targetCount: 3,
      itemLabel: "교재명",
      scopeLabel: "페이지 범위",
      completedLabel: "제출여부",
    });
    expect(labels.itemLabel).toBe("교재명");
    expect(labels.scopeLabel).toBe("페이지 범위");
    expect(labels.completedLabel).toBe("제출여부");
  });

  it("falls back to defaults for any label left blank/empty individually", () => {
    const labels = getGeneralFieldLabels({
      id: "1",
      name: "단어암기",
      targetCount: 3,
      itemLabel: "",
      scopeLabel: "페이지 범위",
    });
    expect(labels.itemLabel).toBe("분야명");
    expect(labels.scopeLabel).toBe("페이지 범위");
    expect(labels.completedLabel).toBe("완수여부");
  });
});

describe("isPendingReview", () => {
  it("returns true when reviewStatus is missing (not yet reviewed)", () => {
    expect(isPendingReview(sub())).toBe(true);
  });
  it("returns true when reviewStatus is explicitly pending", () => {
    expect(isPendingReview(sub({ reviewStatus: "pending" }))).toBe(true);
  });
  it("returns false once reviewed pass or fail", () => {
    expect(isPendingReview(sub({ reviewStatus: "pass" }))).toBe(false);
    expect(isPendingReview(sub({ reviewStatus: "fail" }))).toBe(false);
  });
});

describe("REVIEW_STATUS_LABELS", () => {
  it("has Korean labels for all three states", () => {
    expect(REVIEW_STATUS_LABELS.pending).toBeTruthy();
    expect(REVIEW_STATUS_LABELS.pass).toBeTruthy();
    expect(REVIEW_STATUS_LABELS.fail).toBeTruthy();
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

describe("validateGeneralSubmissionInput", () => {
  it("accepts a valid item/scope/completed submission", () => {
    expect(
      validateGeneralSubmissionInput({ item: "어휘 Day5", scope: "101~150번", completed: true })
        .length,
    ).toBe(0);
  });
  it("requires item and scope, but completed defaults are fine either way", () => {
    expect(
      validateGeneralSubmissionInput({ item: "", scope: "101~150번", completed: true }).length,
    ).toBeGreaterThan(0);
    expect(
      validateGeneralSubmissionInput({ item: "어휘 Day5", scope: "", completed: false }).length,
    ).toBeGreaterThan(0);
  });
});

describe("validateMockExamTimingInput", () => {
  it("accepts empty timing (all optional)", () => {
    expect(validateMockExamTimingInput({}).length).toBe(0);
  });
  it("accepts valid positive minute values", () => {
    expect(
      validateMockExamTimingInput({
        totalMinutes: 44,
        step1Minutes: 10,
        step2Minutes: 17,
        step3Minutes: 17,
      }).length,
    ).toBe(0);
  });
  it("rejects negative values", () => {
    expect(validateMockExamTimingInput({ step1Minutes: -3 }).length).toBeGreaterThan(0);
  });
});
