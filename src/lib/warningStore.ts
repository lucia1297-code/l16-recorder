import type { WarningRecord } from "../core/warning";

export interface WarningStore {
  listAll(): Promise<WarningRecord[]>;
  saveAll(records: WarningRecord[]): Promise<void>;
}
