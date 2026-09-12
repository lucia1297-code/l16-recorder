import { useEffect, useMemo, useState } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry, ExamSchedule } from "../../core/roster";

export default function ExamSchedulePanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // 모달
  const [editingStudent, setEditingStudent] = useState<RosterEntry | null>(null);
  const [newExam, setNewExam] = useState<Omit<ExamSchedule, "color">>({
    name: "",
    startDate: "",
    endDate: "",
  });

  useEffect(() => {
    rosterStore.listRoster().then(r => {
      const filtered = r.filter(s => (s.studentStatus ?? "active") !== "withdrawn");
      setRoster(filtered);
      setLoading(false);
    });
  }, [rosterStore]);

  // 모든 시험 일정에서 최소/최대 날짜 구하기
  const dateRange = useMemo(() => {
    let minDate = new Date();
    let maxDate = new Date();

    roster.forEach(student => {
      student.examSchedules?.forEach(exam => {
        const start = new Date(exam.startDate);
        const end = new Date(exam.endDate);
        if (start < minDate) minDate = start;
        if (end > maxDate) maxDate = end;
      });
    });

    // 범위 확장 (시작 7일 전, 종료 7일 후)
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);

    return { minDate, maxDate };
  }, [roster]);

  // 날짜 → px 위치 변환
  function dateToPx(date: string): number {
    const d = new Date(date);
    const range = dateRange.maxDate.getTime() - dateRange.minDate.getTime();
    const offset = d.getTime() - dateRange.minDate.getTime();
    return (offset / range) * 800; // 800px 너비
  }

  function durationToPx(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const range = dateRange.maxDate.getTime() - dateRange.minDate.getTime();
    const duration = end.getTime() - start.getTime();
    return Math.max((duration / range) * 800, 30); // 최소 30px
  }

  const examColors = ["#0891b2", "#059669", "#7c3aed", "#ea580c", "#dc2626", "#475569"];

  async function saveExamSchedules() {
    if (!editingStudent) return;

    try {
      const exams = editingStudent.examSchedules || [];
      exams.forEach((e, i) => {
        if (!e.color) e.color = examColors[i % examColors.length];
      });

      await rosterStore.saveRoster([editingStudent]);
      const all = await rosterStore.listRoster();
      setRoster(all.filter(s => (s.studentStatus ?? "active") !== "withdrawn"));
      setEditingStudent(null);
    } catch(e) {
      alert("저장 실패: " + (e as any)?.message);
    }
  }

  function addExam() {
    if (!editingStudent) return;
    if (!newExam.name || !newExam.startDate || !newExam.endDate) {
      alert("모든 필드를 입력해주세요");
      return;
    }

    const exams = editingStudent.examSchedules || [];
    const color = examColors[exams.length % examColors.length];
    exams.push({ ...newExam, color });

    setEditingStudent({ ...editingStudent, examSchedules: exams });
    setNewExam({ name: "", startDate: "", endDate: "" });
  }

  function removeExam(index: number) {
    if (!editingStudent) return;
    const exams = editingStudent.examSchedules || [];
    exams.splice(index, 1);
    setEditingStudent({ ...editingStudent, examSchedules: exams });
  }

  if (loading) return <div className="card">로딩 중...</div>;

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "#f8fafc" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
          📊 시험일정 chart
        </h2>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
          학생별 시험 일정을 Gantt chart로 시각화
        </p>
      </div>

      {/* Gantt Chart */}
      <div style={{ padding: 20, overflowX: "auto" }}>
        <div style={{ minWidth: 900 }}>
          {/* 타임라인 헤더 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", height: 30 }}>
              <div style={{ width: 150, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>
                학생명
              </div>
              <div style={{ flex: 1, position: "relative", height: 30, borderLeft: "2px solid #0891b2", paddingLeft: 10 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                  시험 일정 (일정을 클릭하면 편집 가능)
                </span>
              </div>
            </div>
          </div>

          {/* 학생 행 */}
          {roster.map(student => (
            <div
              key={student.studentCode}
              onClick={() => setEditingStudent({ ...student })}
              style={{
                display: "flex",
                alignItems: "center",
                height: 60,
                borderBottom: "1px solid #f1f5f9",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              {/* 학생명 */}
              <div style={{ width: 150, fontSize: 13, fontWeight: 600, color: "#1e293b", paddingRight: 10 }}>
                {student.name}
              </div>

              {/* 시험 바 */}
              <div style={{ flex: 1, position: "relative", height: 60, background: "#fafafa", borderLeft: "2px solid #e2e8f0" }}>
                {student.examSchedules?.map((exam, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${dateToPx(exam.startDate)}px`,
                      width: `${durationToPx(exam.startDate, exam.endDate)}px`,
                      height: 24,
                      top: `${12 + i * 28}px`,
                      background: exam.color || "#0891b2",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      paddingX: 6,
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }}
                    title={`${exam.name}: ${exam.startDate} ~ ${exam.endDate}`}
                  >
                    {exam.name}
                  </div>
                ))}
                {!student.examSchedules || student.examSchedules.length === 0 && (
                  <div style={{ padding: "8px 12px", color: "#94a3b8", fontSize: 12 }}>
                    시험 일정 없음
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 시험 일정 편집 모달 */}
      {editingStudent && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEditingStudent(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              width: "90%",
              maxWidth: 500,
              maxHeight: "80vh",
              overflow: "auto",
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
              {editingStudent.name} - 시험 일정 관리
            </h3>

            {/* 기존 시험 일정 */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 700, color: "#374151" }}>
                등록된 시험 ({editingStudent.examSchedules?.length || 0}개)
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {editingStudent.examSchedules?.map((exam, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: 10,
                      background: "#f8fafc",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: exam.color || "#0891b2",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: "#1e293b" }}>{exam.name}</span>
                      <span style={{ color: "#64748b", marginLeft: 8 }}>
                        {exam.startDate} ~ {exam.endDate}
                      </span>
                    </div>
                    <button
                      onClick={() => removeExam(i)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 12,
                        background: "#fee2e2",
                        color: "#dc2626",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 새 시험 추가 */}
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 700, color: "#374151" }}>
                새 시험 추가
              </label>
              <input
                type="text"
                placeholder="시험명 (예: 영어, 수학)"
                value={newExam.name}
                onChange={(e) => setNewExam({ ...newExam, name: e.target.value })}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  marginBottom: 8,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  type="date"
                  value={newExam.startDate}
                  onChange={(e) => setNewExam({ ...newExam, startDate: e.target.value })}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                  }}
                />
                <input
                  type="date"
                  value={newExam.endDate}
                  onChange={(e) => setNewExam({ ...newExam, endDate: e.target.value })}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                  }}
                />
              </div>
              <button
                onClick={addExam}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "#e0f2fe",
                  color: "#0891b2",
                  border: "1px solid #bae6fd",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                + 시험 추가
              </button>
            </div>

            {/* 버튼 */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={saveExamSchedules}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "#0891b2",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                저장
              </button>
              <button
                onClick={() => setEditingStudent(null)}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "#f1f5f9",
                  color: "#64748b",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
