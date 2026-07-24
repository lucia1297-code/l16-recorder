import { describe, it, expect } from "vitest";
import { EXAM_CHECK_ANSWER_LABELS, type ExamCheckAnswer } from "../core/examCheck";

describe("EXAM_CHECK_ANSWER_LABELS", () => {
  it("has Korean labels for all three answers", () => {
    const answers: ExamCheckAnswer[] = ["yes", "no", "na"];
    for (const a of answers) {
      expect(EXAM_CHECK_ANSWER_LABELS[a]).toBeTruthy();
    }
  });

  it("uses the exact expected Korean wording", () => {
    expect(EXAM_CHECK_ANSWER_LABELS.yes).toBe("예");
    expect(EXAM_CHECK_ANSWER_LABELS.no).toBe("아니오");
    expect(EXAM_CHECK_ANSWER_LABELS.na).toBe("해당없음");
  });
});
