import { useEffect, useMemo, useState } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface ExamSchedule {
  id: string;
  studentCode: string;
  semester: "1" | "2";
  examType: "midterm" | "final";
  subject: string;
  examStart: string;      // 시험 시작일
  examEnd: string;        // 시험 종료일
  englishExamDate: string;    // 영어 시험일
  reportDeadline: string;     // 직보일
  nextLessonDate: string;     // 다음 수업 예정일
  score: number | null;
  completed: boolean;
  memo: string;
}

const SCHEDULE_ITEMS = [
  { key: "reportDeadline", label: "직보일", color: "#ef4444" },
  { key: "examStart", label: "시작일", color: "#f97316" },
  { key: "englishExamDate", label: "영어시험일", color: "#3b82f6" },
  { key: "examEnd", label: "종료일", color: "#22c55e" },
  { key: "nextLessonDate", label: "다음수업", color: "#8b5cf6" },
];

// 학생별 고유색
const STUDENT_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
  "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#A8D8EA",
];

export default function ExamSchedulePanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rosterStore.listRoster().then(r => {
      setRoster(r.filter(s => (s.studentStatus ?? "active") !== "withdrawn"));
    });
    loadExams();
  }, []);

  async function loadExams() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_exam_schedules?order=created_at.asc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (res.ok) {
        const data = await res.json();
        const mapped: ExamSchedule[] = data.map((r: any) => ({
          id: r.id,
          studentCode: r.student_code,
          semester: r.semester,
          examType: r.exam_type,
          subject: r.subject ?? "영어",
          examStart: r.exam_start ?? "",
          examEnd: r.exam_end ?? "",
          englishExamDate: r.english_exam_date ?? "",
          reportDeadline: r.report_deadline ?? "",
          nextLessonDate: r.next_lesson_date ?? "",
          score: r.score ?? null,
          completed: r.completed ?? false,
          memo: r.memo ?? "",
        }));
        setExams(mapped);
      }
    } catch (e) {
      console.error("Load failed:", e);
    } finally {
      setLoading(false);
    }
  }

  // 날짜 범위 계산
  const dateRange = useMemo(() => {
    let minDate = new Date();
    let maxDate = new Date();
    let hasData = false;

    exams.forEach(exam => {
      const dates = [
        exam.reportDeadline,
        exam.examStart,
        exam.englishExamDate,
        exam.examEnd,
        exam.nextLessonDate,
      ].filter(Boolean);

      dates.forEach(dateStr => {
        const d = new Date(dateStr);
        if (!hasData || d < minDate) minDate = new Date(d);
        if (!hasData || d > maxDate) maxDate = new Date(d);
        hasData = true;
      });
    });

    if (!hasData) {
      minDate = new Date();
      maxDate = new Date();
      minDate.setDate(minDate.getDate() - 30);
      maxDate.setDate(maxDate.getDate() + 30);
    } else {
      minDate.setDate(minDate.getDate() - 10);
      maxDate.setDate(maxDate.getDate() + 10);
    }

    return { minDate, maxDate };
  }, [exams]);

  // 날짜를 px로 변환
  function dateToPx(dateStr: string): number {
    if (!dateStr) return -100;
    const d = new Date(dateStr);
    const range = dateRange.maxDate.getTime() - dateRange.minDate.getTime();
    if (range <= 0) return 0;
    const offset = d.getTime() - dateRange.minDate.getTime();
    return Math.max(0, (offset / range) * 1000);
  }

  if (loading) return <div className="card">로딩 중...</div>;

  const studentExams = new Map<string, ExamSchedule[]>();
  exams.forEach(exam => {
    if (!studentExams.has(exam.studentCode)) {
      studentExams.set(exam.studentCode, []);
    }
    studentExams.get(exam.studentCode)!.push(exam);
  });

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "#f8fafc" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
          📊 시험일정 chart
        </h2>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
          학생별 시험 일정 시각화 (직보일, 시작일, 영어시험일, 종료일, 다음수업)
        </p>
      </div>

      {/* 범례 */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #f1f5f9", background: "#fafafa", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {SCHEDULE_ITEMS.map(item => (
          <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, background: item.color, borderRadius: 2 }} />
            <span style={{ color: "#64748b", fontWeight: 600 }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Gantt Chart */}
      <div style={{ padding: 20, overflowX: "auto" }}>
        <div style={{ minWidth: 1400 }}>
          {/* 타임라인 헤더 */}
          <div style={{ display: "flex", marginBottom: 20, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ width: 120, flexShrink: 0 }}></div>
            <div style={{ flex: 1, display: "flex", position: "relative", height: 40 }}>
              {Array.from({ length: Math.ceil((dateRange.maxDate.getTime() - dateRange.minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1 }, (_, i) => {
                const date = new Date(dateRange.minDate);
                date.setDate(date.getDate() + i);
                const px = dateToPx(date.toISOString().split('T')[0]);
                const monthDay = `${date.getMonth() + 1}.${date.getDate()}`;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${px}px`,
                      fontSize: 11,
                      color: "#94a3b8",
                      borderBottom: "1px solid #e2e8f0",
                      paddingBottom: 4,
                      minWidth: 40,
                      textAlign: "center",
                    }}
                  >
                    {monthDay}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 학생 행 */}
          {Array.from(studentExams.entries()).map(([studentCode, studentExamList], studentIdx) => {
            const student = roster.find(r => r.studentCode === studentCode);
            if (!student) return null;
            const studentColor = STUDENT_COLORS[studentIdx % STUDENT_COLORS.length];

            return (
              <div key={studentCode} style={{ marginBottom: 1, display: "flex", position: "relative" }}>
                {/* 학생명 - Sticky */}
                <div
                  style={{
                    width: 120,
                    flexShrink: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1e293b",
                    paddingRight: 10,
                    paddingTop: 12,
                    position: "sticky",
                    left: 0,
                    background: "#fafafa",
                    zIndex: 5,
                    borderRight: "1px solid #e2e8f0",
                  }}
                >
                  {student.name}
                </div>

                {/* 시험 일정 바 */}
                <div style={{ flex: 1, position: "relative", height: 40, background: "#fff", borderBottom: "1px solid #f1f5f9" }}>
                  {/* 시작일-종료일 연결 선 */}
                  {studentExamList.map((exam) => {
                    if (!exam.examStart || !exam.examEnd) return null;
                    const startPx = dateToPx(exam.examStart);
                    const endPx = dateToPx(exam.examEnd);
                    const width = endPx - startPx;
                    if (width <= 0) return null;

                    return (
                      <div
                        key={`range-${exam.id}`}
                        style={{
                          position: "absolute",
                          left: `${startPx}px`,
                          width: `${Math.max(2, width)}px`,
                          height: 3,
                          background: studentColor,
                          top: "50%",
                          transform: "translateY(-50%)",
                          borderRadius: 2,
                          opacity: 0.7,
                        }}
                      />
                    );
                  })}

                  {/* 각 일정의 포인트 */}
                  {studentExamList.map((exam, idx) => (
                    <div
                      key={`${exam.id}-${idx}`}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${12 + idx * 14}px`,
                        height: 10,
                        display: "flex",
                        gap: 3,
                        alignItems: "center",
                        fontSize: 8,
                        color: "#64748b",
                      }}
                    >
                      {SCHEDULE_ITEMS.map(item => {
                        const dateStr = exam[item.key as keyof ExamSchedule];
                        if (!dateStr) return null;
                        const px = dateToPx(dateStr as string);
                        const formattedDate = new Date(dateStr as string).toLocaleDateString("ko-KR", {
                          month: "short",
                          day: "numeric",
                        });

                        return (
                          <div
                            key={`${exam.id}-${item.key}`}
                            style={{
                              position: "absolute",
                              left: `${px}px`,
                              width: 24,
                              height: 6,
                              background: item.color,
                              borderRadius: 1,
                              opacity: 0.8,
                              title: `${item.label}: ${formattedDate}`,
                              cursor: "pointer",
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}

                  {studentExamList.length === 0 && (
                    <div style={{ padding: "8px 12px", color: "#cbd5e1", fontSize: 12 }}>
                      시험 일정 없음
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {studentExams.size === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
              📋 시험 일정 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
