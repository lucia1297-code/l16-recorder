import type { TeacherLog } from "../core/teacherLog";

export interface TeacherLogStore {
  saveLog(log: TeacherLog): Promise<void>;
  listLogsForStudent(studentCode: string): Promise<TeacherLog[]>;
  getLog(studentCode: string, date: string): Promise<TeacherLog | null>;
}
