import type { PendingStore } from "./pendingStore";
import type { PendingRegistration } from "../core/pendingRegistration";
import type { RosterEntry } from "../core/roster";

const KEY = "asx.pending";

export class LocalPendingStore implements PendingStore {
  async submit(entry: PendingRegistration): Promise<void> {
    const all = await this.listPending();
    const withoutDup = all.filter((e) => e.phone !== entry.phone);
    withoutDup.push(entry);
    localStorage.setItem(KEY, JSON.stringify(withoutDup));
  }

  async listPending(): Promise<PendingRegistration[]> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PendingRegistration[];
    } catch {
      return [];
    }
  }

  async findByPhone(phoneDigits: string): Promise<PendingRegistration | null> {
    const all = await this.listPending();
    return all.find((e) => e.phone === phoneDigits) ?? null;
  }

  async approve(phoneDigits: string, studentCode: string): Promise<RosterEntry | null> {
    const all = await this.listPending();
    const found = all.find((e) => e.phone === phoneDigits);
    if (!found) return null;
    const remaining = all.filter((e) => e.phone !== phoneDigits);
    localStorage.setItem(KEY, JSON.stringify(remaining));
    return {
      studentCode,
      name: found.name,
      school: found.school,
      grade: found.grade,
      phone: found.phone,
      teacher: "",
      note: "학생 자가등록 승인",
    };
  }

  async reject(phoneDigits: string): Promise<void> {
    const all = await this.listPending();
    const remaining = all.filter((e) => e.phone !== phoneDigits);
    localStorage.setItem(KEY, JSON.stringify(remaining));
  }
}
