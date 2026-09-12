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

// 마일스톤 정의 (순서대로 표시) - 프로페셔널 대시보드 스타일
const MILESTONE_ITEMS = [
  { key: "reportDeadline", label: "직보일", color: "#f97316" },      // 주황색
  { key: "englishExamDate", label: "영어시험일", color: "#dc2626" },  // 빨강색
  { key: "examEnd", label: "종료일", color: "#22c55e" },             // 초록색
];

// Gantt 바 색상 (프로페셔널 블루)
const GANTT_BAR_COLOR = "#2563eb";

const DAY_WIDTH = 50; // 각 날짜 열의 너비

// 마일스톤 심볼 렌더 함수 (동그라미)
function MilestoneSymbol({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ fill: color }}>
      <circle cx="6" cy="6" r="5" />
    </svg>
  );
}

export default function ExamSchedulePanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredMilestone, setHoveredMilestone] = useState<string | null>(null);

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

  // 날짜를 일 인덱스로 변환
  function getDateIndex(dateStr: string): number {
    if (!dateStr) return -1;
    const d = new Date(dateStr);
    const minTime = dateRange.minDate.getTime();
    const dTime = d.getTime();
    const daysDiff = Math.floor((dTime - minTime) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysDiff);
  }

  // 날짜 포맷팅
  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayName = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${month}월 ${day}일 (${dayName})`;
  }

  // 타임라인 헤더 날짜 포맷팅
  function formatHeaderDate(date: Date): string {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}월${day}일`;
  }

  if (loading) return <div className="card">로딩 중...</div>;

  const studentExams = new Map<string, ExamSchedule[]>();
  exams.forEach(exam => {
    if (!studentExams.has(exam.studentCode)) {
      studentExams.set(exam.studentCode, []);
    }
    studentExams.get(exam.studentCode)!.push(exam);
  });

  // 일 단위로 배열 생성
  const dayCount = Math.ceil(
    (dateRange.maxDate.getTime() - dateRange.minDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(dateRange.minDate);
    d.setDate(d.getDate() + i);
    return d;
  });

  const ganttWidth = 180 + DAY_WIDTH * dayCount;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#fff" }}>
      {/* 헤더 */}
      <div style={{
        padding: "20px 24px",
        borderBottom: "2px solid #e5e7eb",
        background: "#fff"
      }}>
        <h2 style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 700,
          color: "#111827",
          letterSpacing: "-0.5px"
        }}>
          📊 시험 일정 Gantt Chart
        </h2>
        <p style={{
          margin: "6px 0 0",
          fontSize: 13,
          color: "#6b7280",
          fontWeight: 500
        }}>
          학생별 시험 일정 및 마일스톤 추적
        </p>
      </div>

      {/* 범례 */}
      <div style={{
        padding: "16px 24px",
        borderBottom: "1px solid #f3f4f6",
        background: "#fafafa",
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
        alignItems: "center"
      }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {MILESTONE_ITEMS.map(item => (
            <div key={item.key} style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0"
            }}>
              <MilestoneSymbol color={item.color} size={14} />
              <span style={{
                fontSize: 12,
                color: "#374151",
                fontWeight: 600
              }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Gantt Chart Container */}
      <div style={{
        flex: 1,
        overflowX: "auto",
        overflowY: "auto",
        background: "#fff"
      }}>
        <div style={{ width: ganttWidth, minHeight: "100%" }}>
          {/* 타임라인 헤더 - Sticky */}
          <div style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            background: "#f9fafb",
            borderBottom: "2px solid #e5e7eb",
            height: 70
          }}>
            {/* 학생명 헤더 공간 */}
            <div style={{
              width: 180,
              flexShrink: 0,
              padding: "12px 16px",
              borderRight: "2px solid #e5e7eb",
              fontWeight: 700,
              fontSize: 12,
              color: "#374151",
              background: "#f3f4f6",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              display: "flex",
              alignItems: "center"
            }}>
              학생명
            </div>

            {/* 날짜 헤더 */}
            <div style={{
              display: "flex",
              background: "#fff"
            }}>
              {days.map((date, i) => {
                const isWeekStart = date.getDay() === 1;
                const dayName = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];

                return (
                  <div
                    key={i}
                    style={{
                      width: DAY_WIDTH,
                      flexShrink: 0,
                      padding: "8px 0",
                      textAlign: "center",
                      fontSize: 10,
                      fontWeight: isWeekStart ? 700 : 600,
                      color: isWeekStart ? "#1f2937" : "#6b7280",
                      borderLeft: isWeekStart ? "2px solid #d1d5db" : "1px solid #f3f4f6",
                      background: isWeekStart ? "#f0f9ff" : "#fff",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center"
                    }}
                  >
                    <div style={{ fontWeight: 700, lineHeight: 1.4 }}>
                      {formatHeaderDate(date)}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 500, marginTop: 2, lineHeight: 1 }}>
                      {dayName}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 학생 행 */}
          {Array.from(studentExams.entries()).map(([studentCode, studentExamList], studentIdx) => {
            const student = roster.find(r => r.studentCode === studentCode);
            if (!student) return null;

            return (
              <div key={studentCode} style={{
                display: "flex",
                position: "relative",
                borderBottom: "1px solid #f3f4f6",
                background: studentIdx % 2 === 0 ? "#fff" : "#fafafa",
                minHeight: 60
              }}>
                {/* 학생명 컬럼 - Sticky */}
                <div
                  style={{
                    width: 180,
                    flexShrink: 0,
                    padding: "12px 16px",
                    position: "sticky",
                    left: 0,
                    background: studentIdx % 2 === 0 ? "#fff" : "#fafafa",
                    borderRight: "2px solid #e5e7eb",
                    zIndex: 10,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 6,
                    boxShadow: "2px 0 4px rgba(0,0,0,0.05)"
                  }}
                >
                  <div style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#111827",
                    letterSpacing: "-0.3px"
                  }}>
                    {student.name}
                  </div>
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#fff",
                    background: "#2563eb",
                    borderRadius: 4,
                    padding: "2px 8px",
                    width: "fit-content"
                  }}>
                    {studentCode}
                  </div>
                </div>

                {/* 시험 일정 바 */}
                <div style={{
                  flex: 1,
                  position: "relative",
                  background: "inherit",
                  display: "flex"
                }}>
                  {/* 배경 그리드 라인 */}
                  {days.map((date, i) => {
                    const isWeekStart = date.getDay() === 1;
                    return (
                      <div
                        key={`grid-${i}`}
                        style={{
                          width: DAY_WIDTH,
                          flexShrink: 0,
                          height: "100%",
                          borderLeft: isWeekStart ? "2px solid #d1d5db" : "1px solid #f3f4f6",
                          pointerEvents: "none",
                          background: isWeekStart ? "#f0f9ff33" : "transparent"
                        }}
                      />
                    );
                  })}

                  {/* 시험 기간 바 - 절대 위치 */}
                  {studentExamList.map((exam) => {
                    if (!exam.examStart || !exam.examEnd) return null;
                    const startIdx = getDateIndex(exam.examStart);
                    const endIdx = getDateIndex(exam.examEnd);
                    const barWidth = (endIdx - startIdx + 1) * DAY_WIDTH;
                    const barLeft = startIdx * DAY_WIDTH;

                    if (barWidth < 2) return null;

                    return (
                      <div
                        key={`range-${exam.id}`}
                        style={{
                          position: "absolute",
                          left: `${barLeft}px`,
                          width: `${barWidth}px`,
                          height: 12,
                          background: GANTT_BAR_COLOR,
                          top: 24,
                          borderRadius: 3,
                          opacity: 0.9,
                          boxShadow: `0 2px 8px ${GANTT_BAR_COLOR}40`,
                          border: `1.5px solid ${GANTT_BAR_COLOR}`,
                          cursor: "pointer",
                          transition: "all 0.2s ease"
                        }}
                        title={`${exam.subject}: ${formatDate(exam.examStart)} ~ ${formatDate(exam.examEnd)}`}
                      />
                    );
                  })}

                  {/* 마일스톤 마커 */}
                  {studentExamList.map((exam) =>
                    MILESTONE_ITEMS.map(item => {
                      const dateStr = exam[item.key as keyof ExamSchedule];
                      if (!dateStr) return null;
                      const dayIdx = getDateIndex(dateStr as string);
                      const milestoneId = `${exam.id}-${item.key}`;
                      const isHovered = hoveredMilestone === milestoneId;
                      const leftPos = dayIdx * DAY_WIDTH + DAY_WIDTH / 2 - 7;

                      return (
                        <div
                          key={milestoneId}
                          style={{
                            position: "absolute",
                            left: `${leftPos}px`,
                            top: 8,
                            width: 14,
                            height: 14,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            filter: isHovered ? "drop-shadow(0 0 4px rgba(0,0,0,0.3))" : "none",
                            transform: isHovered ? "scale(1.3)" : "scale(1)",
                            transition: "all 0.2s ease",
                            zIndex: isHovered ? 15 : 5
                          }}
                          onMouseEnter={() => setHoveredMilestone(milestoneId)}
                          onMouseLeave={() => setHoveredMilestone(null)}
                          title={`${item.label}: ${formatDate(dateStr)}`}
                        >
                          <MilestoneSymbol color={item.color} size={14} />
                        </div>
                      );
                    })
                  )}

                  {studentExamList.length === 0 && (
                    <div style={{
                      padding: "16px",
                      color: "#9ca3af",
                      fontSize: 12,
                      fontStyle: "italic"
                    }}>
                      시험 일정 없음
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {studentExams.size === 0 && (
            <div style={{
              padding: "60px 40px",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 14
            }}>
              📋 시험 일정 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
