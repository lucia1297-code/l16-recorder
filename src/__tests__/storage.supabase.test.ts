import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamResult } from "../core/types";

const mocks = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { single, select, eq, update, from, createClient: vi.fn(() => ({ from })) };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { SupabaseStorage } from "../lib/storage.supabase";

const result: ExamResult = {
  id: "exam-1",
  student: { studentCode: "TEST", name: "테스트", school: "테스트", grade: "2" },
  exam: { examName: "시험", year: 2026, month: 10, round: 1, totalQuestions: 45, maxScore: 100, provider: "교재" },
  teacher: "Master",
  date: "2026-10-03",
  score: 89,
  wrongAnswers: [],
  reflection: { hardestReason: "", nextGoal: "", satisfaction: 0 },
  submittedAt: "2026-10-03T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-key");
  mocks.single.mockResolvedValue({ data: { id: result.id, score: 89 }, error: null });
});

describe("Supabase result updates", () => {
  it("updates the existing ID through the session-aware SDK and checks the returned score", async () => {
    await new SupabaseStorage().updateResult(result);
    expect(mocks.eq).toHaveBeenCalledWith("id", result.id);
    expect(mocks.select).toHaveBeenCalledWith("id, score");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ score: 89, provider: "교재", submitted_at: result.submittedAt }));
  });

  it("rejects an update that affects no rows", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    await expect(new SupabaseStorage().updateResult(result)).rejects.toThrow("DB에 반영되지 않았습니다");
  });

  it("rejects a returned score that differs from the requested score", async () => {
    mocks.single.mockResolvedValue({ data: { id: result.id, score: 86 }, error: null });
    await expect(new SupabaseStorage().updateResult(result)).rejects.toThrow("DB에 반영되지 않았습니다");
  });

  it("surfaces database permission errors", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(new SupabaseStorage().updateResult(result)).rejects.toThrow("permission denied");
  });
});
