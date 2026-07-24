import type { ExamCheckRecord } from "../core/examCheck";

export interface ExamCheckStore {
  submit(record: ExamCheckRecord): Promise<void>;
  listAll(): Promise<ExamCheckRecord[]>;
}
