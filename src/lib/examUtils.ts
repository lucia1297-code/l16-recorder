// ════════════════════════════════════════════════════════
// L16 시험 데이터 공유 유틸리티
// ExamPrepPanel(관리자 등록) ↔ ExamPlanPanel(계획) 간
// 데이터 변환을 단일 함수로 관리
// ════════════════════════════════════════════════════════

export interface ExamSchedule {
  id: string;
  studentCode: string;
  semester: "1" | "2";
  examType: "midterm" | "final";
  subject: string;
  examStart: string;
  examEnd: string;
  englishExamDate: string;
  examRange: string;
  reportDeadline: string;
  nextLessonDate: string;
  score: number | null;
  examPaperReceived: boolean;
  completed: boolean;
  memo: string;
}

export interface UnifiedExam {
  id: string;
  student_code: string;
  student_name: string;
  school: string;
  grade: string;
  semester: string;
  exam_type: string;
  english_exam_date: string;   // 항상 이 필드 사용
  exam_range: string;
  admin_confirmed: boolean;
  completed: boolean;
  source: "local" | "supabase";
}

export interface RosterEntry {
  studentCode: string;
  name: string;
  school?: string;
  grade?: string;
  [key: string]: any;
}

/**
 * localStorage ExamSchedule → UnifiedExam 변환
 * ExamPlanPanel에서 단독 사용 — 필드명 불일치 방지
 */
export function localToUnified(
  ex: ExamSchedule,
  roster: RosterEntry[]
): UnifiedExam {
  const r = roster.find(r => r.studentCode === ex.studentCode);
  // 영어시험일 우선순위: englishExamDate → examStart → examEnd
  const engDate = ex.englishExamDate || ex.examStart || ex.examEnd || "";
  return {
    id: ex.id ?? `local_${ex.studentCode}_${engDate || Date.now()}`,
    student_code: ex.studentCode,
    student_name: r?.name ?? ex.studentCode,
    school: r?.school ?? "",
    grade: r?.grade ?? "",
    semester: ex.semester ?? "2",
    exam_type: ex.examType ?? "final",
    english_exam_date: engDate,
    exam_range: ex.examRange ?? "",
    admin_confirmed: true,
    completed: ex.completed ?? false,
    source: "local",
  };
}

/**
 * Supabase student_exams row → UnifiedExam 변환
 */
export function supabaseToUnified(
  se: any,
  roster: RosterEntry[]
): UnifiedExam {
  const r = roster.find(r => r.studentCode === se.student_code);
  return {
    id: se.id,
    student_code: se.student_code,
    student_name: se.student_name || r?.name || se.student_code,
    school: se.school || r?.school || "",
    grade: se.grade || r?.grade || "",
    semester: se.semester ?? "2",
    exam_type: se.exam_type ?? "final",
    english_exam_date: se.english_exam_date ?? "",
    exam_range: se.exam_range ?? "",
    admin_confirmed: se.admin_confirmed ?? false,
    completed: false,
    source: "supabase",
  };
}

/**
 * localStorage + Supabase 통합 및 중복 제거
 */
export function mergeExams(
  local: UnifiedExam[],
  remote: UnifiedExam[]
): UnifiedExam[] {
  const all = [...local];
  remote.forEach(se => {
    const dup = all.find(e =>
      e.student_code === se.student_code &&
      e.english_exam_date === se.english_exam_date
    );
    if (!dup) all.push(se);
  });
  return all.sort((a, b) =>
    (a.english_exam_date || "z").localeCompare(b.english_exam_date || "z")
  );
}

/**
 * localStorage에서 전체 시험 목록 로드
 */
export function loadLocalExams(roster: RosterEntry[]): UnifiedExam[] {
  try {
    const raw = localStorage.getItem("l16.examSchedules");
    if (!raw) return [];
    const parsed: ExamSchedule[] = JSON.parse(raw);
    return parsed
      .filter(ex => ex.studentCode)           // studentCode만 있으면 포함
      .map(ex => localToUnified(ex, roster));
  } catch(e) {
    console.error("loadLocalExams 오류:", e);
    return [];
  }
}
