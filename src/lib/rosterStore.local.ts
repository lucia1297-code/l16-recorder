import type { RosterStore } from "./rosterStore";
import type { RosterEntry } from "../core/roster";

const KEY = "asx.roster";

export class LocalRosterStore implements RosterStore {
  async saveRoster(entries: RosterEntry[]): Promise<void> {
    const existing = await this.listRoster();
    const byCode = new Map(existing.map((e) => [e.studentCode, e]));
    for (const e of entries) byCode.set(e.studentCode, e);
    localStorage.setItem(KEY, JSON.stringify([...byCode.values()]));
  }

  async listRoster(): Promise<RosterEntry[]> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as RosterEntry[];
    } catch {
      return [];
    }
  }

  async findByPhone(phoneDigits: string): Promise<RosterEntry | null> {
    const all = await this.listRoster();
    return all.find((e) => e.phone === phoneDigits) ?? null;
  }

  async clearRoster(): Promise<void> {
    localStorage.removeItem(KEY);
  }
}
