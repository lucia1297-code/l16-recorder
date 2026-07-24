import type { MockExamTimingConfig } from "../core/mockExamTiming";

export interface MockExamTimingStore {
  getConfig(): Promise<MockExamTimingConfig>;
  saveConfig(config: MockExamTimingConfig): Promise<void>;
}
