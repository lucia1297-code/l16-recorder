export const TEACHER_LOG_ROW_COUNT = 8;

export interface TeacherLogRow {
  no: number; // 1~8
  material: string; // 교재 (예: voca, 듣기, 모의고사, EBS)
  materialDetail: string; // 교재 세부 (예: 수능심화(해커스), 기출리허설)
  scope: string; // 범위 (예: 1-5, 3회분)
  completion: string; // 수행 (예: 매일, 예정, 보류중)
  wrongNumbers: string; // 틀린문항 (자유 텍스트, 예: "24, 30, 32")
}

export interface ExamScoreRecord {
  id: string;
  label: string; // 자유 라벨, 예: "22년 7월"
  mission: number | null;
  myScore: number | null;
  lc: number | null;
  st1: number | null;
  st2: number | null;
  st3: number | null;
  wrongNumbers: string;
}

export interface TeacherLog {
  id: string;
  studentCode: string;
  date: string; // "2026-07-24"
  rows: TeacherLogRow[];
  examRecords: ExamScoreRecord[];
  notes: string; // 처리
  nextPlan: string; // 다음계획
  classContent: string; // 수업내용
}

export function createEmptyRows(): TeacherLogRow[] {
  return Array.from({ length: TEACHER_LOG_ROW_COUNT }, (_, i) => ({
    no: i + 1,
    material: "",
    materialDetail: "",
    scope: "",
    completion: "",
    wrongNumbers: "",
  }));
}

const DAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

/** "2026-07-24" 형태의 날짜 문자열에서 한국어 요일을 계산한다. */
export function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()];
}

/** 학생코드+날짜로 고유하고 결정적인 id를 만든다 — 같은 날짜에 다시 저장하면 새로 안 생기고 갱신된다. */
export function makeLogId(studentCode: string, date: string): string {
  return `${studentCode}_${date}`;
}
