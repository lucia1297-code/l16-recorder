import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ExamResult } from "../core/types";
import AdminInputPanel from "../features/admin/AdminInputPanel";

const mocks = vi.hoisted(() => ({ listResults: vi.fn(), updateResult: vi.fn(), saveResult: vi.fn() }));

vi.mock("../lib/storageFactory", () => ({ createStorage: () => mocks }));
vi.mock("../lib/rosterStoreFactory", () => ({
  createRosterStore: () => ({ listRoster: async () => [{ studentCode: "TEST", name: "테스트", school: "테스트", grade: "2" }] }),
}));
vi.mock("../lib/assignmentStoreFactory", () => ({
  createAssignmentStore: () => ({ listTypes: async () => [], listSubmissionsForStudent: async () => [] }),
}));

let results: ExamResult[];

beforeEach(() => {
  vi.clearAllMocks();
  results = [{
    id: "exam-1",
    student: { studentCode: "TEST", name: "테스트", school: "테스트", grade: "2" },
    exam: { examName: "2026년 10월 학력평가", year: 2026, month: 10, round: 1, totalQuestions: 45, maxScore: 100 },
    teacher: "Master", date: "2026-10-03", score: 86, wrongAnswers: [],
    reflection: { hardestReason: "", nextGoal: "목표", satisfaction: 3 },
    submittedAt: "2026-10-03T00:00:00.000Z",
  }];
  mocks.listResults.mockImplementation(async () => results);
  mocks.updateResult.mockImplementation(async (updated: ExamResult) => { results = [updated]; });
});

afterEach(cleanup);

async function openEdit() {
  render(<AdminInputPanel />);
  await screen.findByRole("option", { name: /테스트/ });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "TEST" } });
  fireEvent.click(await screen.findByRole("button", { name: "수정" }));
  return screen.getByDisplayValue("86");
}

describe("direct exam score editing", () => {
  it("turns the save button green and saves 86 to 89 without creating a duplicate", async () => {
    const scoreInput = await openEdit();
    expect(screen.getByRole("button", { name: "테스트 점수 수정" })).toHaveStyle({ background: "#7c3aed" });
    fireEvent.change(scoreInput, { target: { value: "89" } });
    const saveButton = screen.getByRole("button", { name: "테스트 89점으로 수정 저장" });
    expect(saveButton).toHaveStyle({ background: "#16a34a" });
    fireEvent.click(saveButton);
    await screen.findByText(/89점 수정 완료/);
    expect(mocks.updateResult).toHaveBeenCalledOnce();
    expect(mocks.saveResult).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "exam-1", score: 89, teacher: "Master", reflection: { nextGoal: "목표", satisfaction: 3 } });
    expect(screen.getByText("89점")).toBeInTheDocument();
  });

  it("keeps the entered score and reports failure when the database still returns 86", async () => {
    mocks.updateResult.mockResolvedValue(undefined);
    const scoreInput = await openEdit();
    fireEvent.change(scoreInput, { target: { value: "89" } });
    fireEvent.click(screen.getByRole("button", { name: "테스트 89점으로 수정 저장" }));
    await screen.findByText(/저장된 점수가 입력한 점수와 다릅니다/);
    expect(screen.getByRole("alert")).toHaveTextContent("저장 실패");
    expect(screen.getByDisplayValue("89")).toBeInTheDocument();
    expect(screen.getByText("86점")).toBeInTheDocument();
    expect(screen.queryByText(/89점 수정 완료/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "테스트 89점으로 수정 저장" })).not.toBeDisabled());
  });
});
