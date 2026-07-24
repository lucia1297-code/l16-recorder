import type { TeacherLogStore } from "./teacherLogStore";
import type { TeacherLog } from "../core/teacherLog";

const KEY = "asx.teacherLogs";

export class LocalTeacherLogStore implements TeacherLogStore {
  private async listAll(): Promise<TeacherLog[]> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as TeacherLog[];
    } catch {
      return [];
    }
  }

  async saveLog(log: TeacherLog): Promise<void> {
    const all = await this.listAll();
    const idx = all.findIndex((l) => l.id === log.id);
    if (idx >= 0) all[idx] = log;
    else all.push(log);
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  async listLogsForStudent(studentCode: string): Promise<TeacherLog[]> {
    const all = await this.listAll();
    return all
      .filter((l) => l.studentCode === studentCode)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async getLog(studentCode: string, date: string): Promise<TeacherLog | null> {
    const all = await this.listAll();
    return all.find((l) => l.studentCode === studentCode && l.date === date) ?? null;
  }
}
