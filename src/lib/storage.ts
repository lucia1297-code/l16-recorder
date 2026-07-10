import type { ExamResult, DraftResult } from "../core/types";

// 모든 스토리지 백엔드가 구현해야 하는 공통 인터페이스.
// localStorage, Supabase, Firebase 등을 이 인터페이스 뒤에 두면 UI 코드는 바뀌지 않는다.
export interface Storage {
  saveResult(r: ExamResult): Promise<void>;
  listResults(): Promise<ExamResult[]>;
  saveDraft(d: DraftResult): Promise<void>;
  loadDraft(): Promise<DraftResult | null>;
  clearDraft(): Promise<void>;
}
