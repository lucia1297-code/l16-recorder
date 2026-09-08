import { useEffect, useMemo, useState } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const MATERIAL_TYPES = ["모의고사", "변형문제", "워크북", "직접입력"] as const;
const STATUS_LIST    = ["제공완료", "배부예정", "수업완료", "수업진행", "직접입력"] as const;

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  제공완료: { bg: "#d1fae5", color: "#065f46" },
  배부예정: { bg: "#dbeafe", color: "#1e40af" },
  수업완료: { bg: "#ede9fe", color: "#4c1d95" },
  수업진행: { bg: "#fef3c7", color: "#713f12" },
  직접입력: { bg: "#f1f5f9", color: "#475569" },
};
const TYPE_COLOR: Record<string, { bg: string; color: string }> = {
  모의고사: { bg: "#fee2e2", color: "#991b1b" },
  변형문제: { bg: "#fce7f3", color: "#831843" },
  워크북:   { bg: "#d1fae5", color: "#065f46" },
  직접입력: { bg: "#f1f5f9", color: "#475569" },
};

interface MaterialRecord {
  id: string;
  student_code: string;
  student_name: string;
  provided_at: string;
  material_type: string;
  status: string;
  note: string;
  created_at: string;
}

export default function MaterialPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [records, setRecords] = useState<MaterialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  // 필터
  const [filterStudent, setFilterStudent] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // 폼
  const [showForm, setShowForm] = useState(false);
  const [formStudent, setFormStudent] = useState("");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formType, setFormType] = useState<string>("모의고사");
  const [formStatus, setFormStatus] = useState<string>("제공완료");
  const [formNote, setFormNote] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    rosterStore.listRoster().then(r => setRoster(r));
    loadRecords();
  }, []);

  async function loadRecords() {
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/material_records?order=provided_at.desc,created_at.desc`,
        { headers: SB_H }
      );
      if (!res.ok) throw new Error(`로드 실패 (${res.status})`);
      setRecords(await res.json());
    } catch (e) {
      setNotice("로드 실패: " + (e as Error).message);
    }
    setLoading(false);
  }

  async function saveRecord() {
    if (!formStudent) { setNotice("학생을 선택하세요."); return; }
    const student = roster.find(r => r.studentCode === formStudent);
    if (!student) return;
    setSaving(true); setNotice("");
    try {
      const body = {
        student_code: formStudent,
        student_name: student.name,
        provided_at: formDate,
        material_type: formType,
        status: formStatus,
        note: formNote,
      };
      if (editId) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/material_records?id=eq.${editId}`,
          { method: "PATCH", headers: SB_H, body: JSON.stringify(body) }
        );
        if (!res.ok) throw new Error(`수정 실패 (${res.status})`);
        setNotice("✅ 수정 완료");
      } else {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/material_records`,
          { method: "POST", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify(body) }
        );
        if (!res.ok) throw new Error(`저장 실패 (${res.status})`);
        setNotice("✅ 저장 완료");
      }
      resetForm();
      await loadRecords();
    } catch (e) {
      setNotice("저장 실패: " + (e as Error).message);
    }
    setSaving(false);
    setTimeout(() => setNotice(""), 3000);
  }

  async function deleteRecord(id: string) {
    if (!confirm("이 기록을 삭제할까요?")) return;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/material_records?id=eq.${id}`,
      { method: "DELETE", headers: SB_H }
    );
    if (res.ok) { setNotice("삭제 완료"); await loadRecords(); }
    else setNotice("삭제 실패");
    setTimeout(() => setNotice(""), 2000);
  }

  function startEdit(rec: MaterialRecord) {
    setEditId(rec.id);
    setFormStudent(rec.student_code);
    setFormDate(rec.provided_at);
    setFormType(rec.material_type);
    setFormStatus(rec.status);
    setFormNote(rec.note || "");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditId(null); setShowForm(false);
    setFormStudent(""); setFormDate(new Date().toISOString().slice(0, 10));
    setFormType("모의고사"); setFormStatus("제공완료"); setFormNote("");
  }

  const active = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");

  const filtered = records.filter(r =>
    (!filterStudent || r.student_code === filterStudent) &&
    (!filterType    || r.material_type === filterType) &&
    (!filterStatus  || r.status === filterStatus)
  );

  // 학생별 요약
  const summary = useMemo(() => {
    const m = new Map<string, { name: string; count: number; latest: string }>();
    records.forEach(r => {
      const prev = m.get(r.student_code);
      if (!prev || r.provided_at > prev.latest) {
        m.set(r.student_code, { name: r.student_name, count: (prev?.count ?? 0) + 1, latest: r.provided_at });
      } else {
        m.set(r.student_code, { ...prev, count: prev.count + 1 });
      }
    });
    return m;
  }, [records]);

  const th = (label: string) => (
    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 12,
      color: "#64748b", background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
      whiteSpace: "nowrap" as const }}>{label}</th>
  );

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, color: "#0f766e" }}>📦 학습자료 제공 기록</h2>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          style={{ marginLeft: "auto", padding: "7px 16px", borderRadius: 9, border: "none",
            background: "#0f766e", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          + 새 기록
        </button>
        <button onClick={loadRecords}
          style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid #e2e8f0",
            background: "#fff", fontSize: 13, cursor: "pointer" }}>
          🔄
        </button>
      </div>

      {notice && (
        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 12,
          color: notice.startsWith("✅") ? "#059669" : "#dc2626" }}>{notice}</p>
      )}

      {/* 입력 폼 */}
      {showForm && (
        <div style={{ border: "2px solid #0f766e", borderRadius: 12, padding: 18, marginBottom: 20, background: "#f0fdf4" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, color: "#0f766e" }}>
            {editId ? "✏️ 기록 수정" : "➕ 새 기록 추가"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* 학생 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>학생</label>
              <select value={formStudent} onChange={e => setFormStudent(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #6ee7b7",
                  fontSize: 13, fontFamily: "inherit" }}>
                <option value="">-- 선택 --</option>
                {active.map(r => (
                  <option key={r.studentCode} value={r.studentCode}>
                    {r.name} ({r.school} {r.grade}학년)
                  </option>
                ))}
              </select>
            </div>
            {/* 날짜 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>제공 일자</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #6ee7b7",
                  fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" as const }} />
            </div>
            {/* 종류 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>제공 종류</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MATERIAL_TYPES.map(t => (
                  <button key={t} onClick={() => setFormType(t)}
                    style={{ padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer",
                      fontSize: 12, fontWeight: 600,
                      background: formType === t ? TYPE_COLOR[t].bg : "#f1f5f9",
                      color: formType === t ? TYPE_COLOR[t].color : "#64748b",
                      outline: formType === t ? `2px solid ${TYPE_COLOR[t].color}` : "none" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {/* 처리 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>처리 상태</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUS_LIST.map(s => (
                  <button key={s} onClick={() => setFormStatus(s)}
                    style={{ padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer",
                      fontSize: 12, fontWeight: 600,
                      background: formStatus === s ? STATUS_COLOR[s].bg : "#f1f5f9",
                      color: formStatus === s ? STATUS_COLOR[s].color : "#64748b",
                      outline: formStatus === s ? `2px solid ${STATUS_COLOR[s].color}` : "none" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {/* 메모 */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>메모 (선택)</label>
              <input value={formNote} onChange={e => setFormNote(e.target.value)}
                placeholder="예) 9월 3일 배부, 특이사항 등"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #6ee7b7",
                  fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" as const }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={saveRecord} disabled={saving}
              style={{ flex: 1, padding: 12, borderRadius: 9, border: "none",
                background: "#0f766e", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {saving ? "저장 중…" : editId ? "수정 저장" : "저장"}
            </button>
            <button onClick={resetForm}
              style={{ flex: 1, padding: 12, borderRadius: 9, border: "1px solid #e2e8f0",
                background: "#fff", fontSize: 13, cursor: "pointer" }}>
              취소
            </button>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterStudent} onChange={e => setFilterStudent(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }}>
          <option value="">전체 학생</option>
          {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }}>
          <option value="">전체 종류</option>
          {MATERIAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }}>
          <option value="">전체 상태</option>
          {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
          {filtered.length}건
        </span>
      </div>

      {/* 요약 카드 */}
      {!filterStudent && !filterType && !filterStatus && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {active.filter(r => summary.has(r.studentCode)).map(r => {
            const s = summary.get(r.studentCode)!;
            return (
              <div key={r.studentCode}
                onClick={() => setFilterStudent(r.studentCode)}
                style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e2e8f0",
                  background: "#fff", cursor: "pointer", minWidth: 100 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {s.count}건 · 최근 {s.latest}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 테이블 */}
      {loading ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>로딩 중…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8" }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>📭</p>
          <p>기록이 없습니다.</p>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            style={{ marginTop: 12, padding: "8px 20px", borderRadius: 9, border: "none",
              background: "#0f766e", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            + 첫 기록 추가
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {th("학생")}
                {th("제공일")}
                {th("종류")}
                {th("상태")}
                {th("메모")}
                {th("관리")}
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec, i) => (
                <tr key={rec.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                  <td style={{ padding: "9px 12px", fontWeight: 700, fontSize: 13,
                    position: "sticky", left: 0, background: i % 2 === 0 ? "#fff" : "#f8fafc",
                    boxShadow: "2px 0 4px rgba(0,0,0,0.06)", whiteSpace: "nowrap" as const }}>
                    {rec.student_name}
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" as const }}>
                    {rec.provided_at}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5,
                      fontWeight: 700, whiteSpace: "nowrap" as const,
                      background: TYPE_COLOR[rec.material_type]?.bg ?? "#f1f5f9",
                      color: TYPE_COLOR[rec.material_type]?.color ?? "#475569" }}>
                      {rec.material_type}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5,
                      fontWeight: 700, whiteSpace: "nowrap" as const,
                      background: STATUS_COLOR[rec.status]?.bg ?? "#f1f5f9",
                      color: STATUS_COLOR[rec.status]?.color ?? "#475569" }}>
                      {rec.status}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: "#64748b",
                    maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {rec.note || "—"}
                  </td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" as const }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => startEdit(rec)}
                        style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
                          background: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                        수정
                      </button>
                      <button onClick={() => deleteRecord(rec.id)}
                        style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #fecaca",
                          background: "#fef2f2", color: "#dc2626", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
