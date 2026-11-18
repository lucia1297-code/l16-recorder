import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LessonJudgmentCapture from "../features/admin/LessonJudgmentCapture";
import type { LessonJudgmentStore } from "../lib/lessonJudgmentStore";
import { createQuickEvent } from "../core/lessonJudgment";

function makeStore(): LessonJudgmentStore {
  const events: any[] = [];
  const revisions: any[] = [];
  return {
    appendEvent: vi.fn(async (event) => { events.push(event); return "saved" as const; }),
    listEvents: vi.fn(async (filter?: any) => events.filter((event) => (!filter?.studentCode || event.studentCode === filter.studentCode) && (!filter?.lessonDate || event.lessonDate === filter.lessonDate))),
    appendRevision: vi.fn(async (revision) => { revisions.push(revision); }),
    listRevisions: vi.fn(async (eventId) => revisions.filter((row) => row.eventId === eventId)),
    flushOutbox: vi.fn(async () => ({ synced: 0, remaining: 0 })),
    getOutboxStatus: vi.fn(async () => ({ count: 0, oldestQueuedAt: null })),
    listQueuedEventIds: vi.fn(async () => []),
    deleteQueuedEvent: vi.fn(async () => {}),
  };
}

describe("LessonJudgmentCapture", () => {
  it("records all four quick outcomes with selected context", async () => {
    const store = makeStore();
    render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);

    for (const label of ["정답", "오답", "판단 보류", "미확인"]) fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(4));
    expect((store.appendEvent as any).mock.calls.map((call: any[]) => call[0].outcome)).toEqual(["correct", "incorrect", "hold", "unverified"]);
    expect((store.appendEvent as any).mock.calls[0][0]).toMatchObject({ studentCode: "S-1", lessonDate: "2026-11-18" });
  });

  it("deduplicates an accidental double tap of the same action", async () => {
    const store = makeStore();
    render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    const button = screen.getByRole("button", { name: "오답" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(1));
  });

  it("clears item and reason drafts when student or lesson date changes", async () => {
    const store = makeStore();
    const view = render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.change(screen.getByLabelText("문항 ID"), { target: { value: "Q-1" } });
    fireEvent.click(screen.getByRole("button", { name: "어휘" }));
    view.rerender(<LessonJudgmentCapture studentCode="S-2" sessionRef={null} lessonDate="2026-11-19" store={store} />);
    await waitFor(() => expect(screen.getByLabelText("문항 ID")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "어휘" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps an unsaved detail draft recoverable when switching students", async () => {
    const store = makeStore();
    const view = render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "오답" }));
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(1));
    fireEvent.change(await screen.findByLabelText("관찰된 사실"), { target: { value: "초안 보존 확인" } });

    view.rerender(<LessonJudgmentCapture studentCode="S-2" sessionRef={null} lessonDate="2026-11-19" store={store} />);
    await waitFor(() => expect(screen.getByText("오늘 수업에서 기록한 판단이 여기에 시간순으로 표시됩니다.")).toBeTruthy());
    view.rerender(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);

    await waitFor(() => expect(screen.getByLabelText("관찰된 사실")).toHaveValue("초안 보존 확인"));
  });

  it("allows no student context and saves judgment codes and optional reason tags", async () => {
    const store = makeStore();
    render(<LessonJudgmentCapture studentCode={null} sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "J-03 설명 효과" }));
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(1));
    expect((store.appendEvent as any).mock.calls[0][0]).toMatchObject({ eventType: "explanation_effect", judgmentCode: "J-03", studentCode: null });

    fireEvent.click(screen.getByRole("button", { name: "어휘" }));
    fireEvent.click(screen.getByRole("button", { name: "오답" }));
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(2));
    expect((store.appendEvent as any).mock.calls[1][0].reasonTags).toContain("vocabulary");
  });

  it("saves fact and interpretation as an append-only detail revision", async () => {
    const store = makeStore();
    render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "오답" }));
    await waitFor(() => expect(store.listEvents).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("관찰된 사실"), { target: { value: "근거 문장을 건너뜀" } });
    fireEvent.change(screen.getByLabelText("교사 해석"), { target: { value: "지시어 연결을 놓친 듯함" } });
    fireEvent.click(screen.getByRole("button", { name: "상세 이력 저장" }));
    await waitFor(() => expect(store.appendRevision).toHaveBeenCalledTimes(1));
    expect((store.appendRevision as any).mock.calls[0][0].detail).toMatchObject({ observedFact: "근거 문장을 건너뜀", teacherInterpretation: "지시어 연결을 놓친 듯함" });
  });

  it("shows pending queue count and communicates queued saves", async () => {
    const store = makeStore();
    (store.appendEvent as any).mockResolvedValue("queued");
    (store.getOutboxStatus as any).mockResolvedValue({ count: 2, oldestQueuedAt: "2026-11-18T00:00:00Z" });
    render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "오답" }));
    expect(await screen.findByText(/연결 대기 2건/)).toBeTruthy();
    expect(await screen.findByText(/기기에 저장했고 서버 전송 대기 중/)).toBeTruthy();
  });

  it("keeps the planned focus separate from actual lesson results", async () => {
    const store = makeStore();
    render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.change(screen.getByLabelText("문항 ID"), { target: { value: "Q-7" } });
    fireEvent.change(screen.getByLabelText("예정 초점"), { target: { value: "근거 문장 확인" } });
    fireEvent.change(screen.getByLabelText("예정 전략"), { target: { value: "근거 표시 후 선택지 대조" } });
    fireEvent.click(screen.getByRole("button", { name: "수업 계획 기록" }));
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("관찰된 사실"), { target: { value: "근거를 표시하고 정답을 선택" } });
    fireEvent.change(screen.getByLabelText("적용한 전략"), { target: { value: "근거 표시 후 선택지 대조" } });
    fireEvent.click(screen.getByRole("button", { name: "실제 수업 결과 기록" }));
    await waitFor(() => expect(store.appendEvent).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText("근거 문장 확인")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("관찰된 사실")).toHaveValue("근거를 표시하고 정답을 선택");
    expect(screen.getByLabelText("적용한 전략")).toHaveValue("근거 표시 후 선택지 대조");
    expect(screen.getAllByText(/전략 근거 표시 후 선택지 대조/)).toHaveLength(2);
  });

  it("shows chronological history for the same item across lesson dates", async () => {
    const store = makeStore();
    const earlier = createQuickEvent({ eventType: "item_outcome", lessonDate: "2026-11-11", studentCode: "S-1", itemId: "Q-1", outcome: "incorrect" }, "2026-11-11T01:00:00.000Z", "previous-event");
    await store.appendEvent(earlier);
    render(<LessonJudgmentCapture studentCode="S-1" sessionRef={null} lessonDate="2026-11-18" store={store} />);
    fireEvent.change(screen.getByLabelText("문항 ID"), { target: { value: "Q-1" } });
    fireEvent.click(screen.getByRole("button", { name: "정답" }));

    expect(await screen.findByText("같은 문항 이력 · Q-1")).toBeTruthy();
    expect(screen.getByText(/2026-11-11 · 오답/)).toBeTruthy();
    expect(screen.getByText(/2026-11-18 · 정답/)).toBeTruthy();
  });
});
