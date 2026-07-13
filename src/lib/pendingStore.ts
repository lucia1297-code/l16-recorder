import type { PendingRegistration } from "../core/pendingRegistration";
import type { RosterEntry } from "../core/roster";

export interface PendingStore {
  submit(entry: PendingRegistration): Promise<void>;
  listPending(): Promise<PendingRegistration[]>;
  findByPhone(phoneDigits: string): Promise<PendingRegistration | null>;
  /** 승인: 대기 목록에서 제거하고 완성된 RosterEntry 를 반환 (호출자가 rosterStore 에 저장) */
  approve(phoneDigits: string, studentCode: string): Promise<RosterEntry | null>;
  reject(phoneDigits: string): Promise<void>;
}
