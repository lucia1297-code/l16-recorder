import type { MockExamTimingStore } from "./mockExamTimingStore";
import type { MockExamTimingConfig } from "../core/mockExamTiming";
import { DEFAULT_MOCK_EXAM_TIMING_CONFIG } from "../core/mockExamTiming";

const KEY = "asx.mockExamTiming";

export class LocalMockExamTimingStore implements MockExamTimingStore {
  async getConfig(): Promise<MockExamTimingConfig> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_MOCK_EXAM_TIMING_CONFIG;
    try {
      return { ...DEFAULT_MOCK_EXAM_TIMING_CONFIG, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_MOCK_EXAM_TIMING_CONFIG;
    }
  }

  async saveConfig(config: MockExamTimingConfig): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(config));
  }
}
