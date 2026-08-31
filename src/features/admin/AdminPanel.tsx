import { useEffect, useMemo, useState, Fragment } from "react";
import type { ExamResult } from "../../core/types";
import { WRONG_REASON_LABELS, type WrongReason } from "../../core/types";
import { computeDashboard, toCSV, percentScore } from "../../core/logic";

import { validatePhoneNumber, normalizePhoneNumber } from "../../core/otpLogic";
import { parseRosterRows, buildManualEntry, type RosterEntry, getReminderDays, calcWeeklyTotal, type LessonDayMap, type DayOfWeek, type StudentStatus, calcMonthlySettlement } from "../../core/roster";
import { generateStudentCode } from "../../core/studentCode";
import type { PendingRegistration } from "../../core/pendingRegistration";
import { useStorage } from "../../lib/useStorage";


import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createPendingStore } from "../../lib/pendingStoreFactory";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import { createMockExamTimingStore } from "../../lib/mockExamTimingStoreFactory";
import { createWarningStore } from "../../lib/warningStoreFactory";
import { createExamCheckStore } from "../../lib/examCheckStoreFactory";
import { createSmsProvider } from "../../lib/smsFactory";
import { generateReportToken, buildReportUrl } from "../../lib/reportToken";
import { createTeacherLogStore } from "../../lib/teacherLogStoreFactory";
import {
  MAX_ASSIGNMENT_TYPES,
  computeAssignmentStatus,
  countSubmissionsForType,
  validateAssignmentTypeInput,
  isMockExamKind,
  getGeneralFieldLabels,
  isPendingReview,
  REVIEW_STATUS_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentType,
  type AssignmentSubmission,
} from "../../core/assignment";
import { DEFAULT_MOCK_EXAM_TIMING_CONFIG, type MockExamTimingConfig } from "../../core/mockExamTiming";
import { bumpWarningOnCarryOver, resetWarningCount, isRecentWarning, type WarningRecord } from "../../core/warning";
import { EXAM_CHECK_ANSWER_LABELS, type ExamCheckRecord } from "../../core/examCheck";
import { isInGracePeriod, gracePeriodDaysRemaining } from "../../core/gracePeriod";
import {
  createEmptyRows,
  getDayOfWeek,
  makeLogId,
  type TeacherLogRow,
  type ExamScoreRecord,
} from "../../core/teacherLog";

const ADMIN_SESSION_KEY = "asx.admin.ok";

export default function AdminPanel() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(ADMIN_SESSION_KEY) === "1"
  );

  function handleLogout() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setAuthed(false);
  }

  if (!authed)
    return (
      <SimpleAdminLogin
        onOk={() => {
          sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
          setAuthed(true);
        }}
      />
    );
  return <AdminHome onLogout={handleLogout} />;
}

function SimpleAdminLogin({ onOk }: { onOk: () => void }) {
  const correctCode = import.meta.env.VITE_ADMIN_ACCESS_CODE as string | undefined ?? "129712";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit() {
    if (!correctCode) {
      setError("관리자 접속 코드가 설정되지 않았습니다.");
      return;
    }
    if (code.trim() === correctCode) {
      onOk();
    } else {
      setError("접속 코드가 틀렸습니다.");
      setCode("");
    }
  }

  return (
    <div className="card" style={{ maxWidth: 360, margin: "60px auto" }}>
      <h2>관리자 로그인</h2>
      <p className="muted">관리자 접속 코드를 입력하세요.</p>
      {error && (
        <div className="errors">
          <ul><li>{error}</li></ul>
        </div>
      )}
      <label>접속 코드</label>
      <input
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="접속 코드 입력"
        autoFocus
      />
      <div style={{ height: 12 }} />
      <button className="btn" onClick={submit}>
        입장
      </button>
    </div>
  );
}

function AdminHome({ onLogout }: { onLogout: () => void }) {
  const storage = useStorage();
  const [rows, setRows] = useState<ExamResult[]>([]);
  const [tab, setTab] = useState<
    "list" | "dash" | "roster" | "pending" | "assignment" | "review" | "teacherlog" | "submit" | "report" | "sms" | "examprep" | "growth"
  >("list");
  const [pendingCount, setPendingCount] = useState(0);
  const pendingStore = useMemo(() => createPendingStore(), []);

  useEffect(() => {
    storage.listResults().then(setRows);
  }, [storage]);

  useEffect(() => {
    pendingStore.listPending().then((p) => setPendingCount(p.length));
  }, [pendingStore, tab]);

  return (
    <div className="admin-shell">
      <div className="tabs admin-rail">
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>
          모의고사 제출목록
        </button>
        <button className={tab === "dash" ? "on" : ""} onClick={() => setTab("dash")}>
          대시보드
        </button>
        <button className={tab === "roster" ? "on" : ""} onClick={() => setTab("roster")}>
          명부 관리
        </button>
        <button className={tab === "assignment" ? "on" : ""} onClick={() => setTab("assignment")}>
          과제 관리
        </button>
        <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
          과제 점검
        </button>
        <button className={tab === "teacherlog" ? "on" : ""} onClick={() => setTab("teacherlog")}>
          학생별 과제입력
        </button>
        <button className={tab === "submit" ? "on" : ""} onClick={() => setTab("submit")}>
          제출 현황
        </button>
        <button className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>
          학생 분석
        </button>
        <button className={tab === "sms" ? "on" : ""} onClick={() => setTab("sms")} style={{ background: tab === "sms" ? "#e74c3c" : "", color: tab === "sms" ? "#fff" : "" }}>
          문자알림
        </button>
        <button className={tab === "growth" ? "on" : ""} onClick={() => setTab("growth")} style={{ background: tab === "growth" ? "#0f766e" : "", color: tab === "growth" ? "#fff" : "" }}>
          발전기록
        </button>
        <button className={tab === "examprep" ? "on" : ""} onClick={() => setTab("examprep")} style={{ background: tab === "examprep" ? "#7c3aed" : "", color: tab === "examprep" ? "#fff" : "" }}>
          시험준비
        </button>
        <button className={tab === "pending" ? "on" : ""} onClick={() => setTab("pending")}>
          등록 신청{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </button>
        <button className="btn ghost" onClick={onLogout}>
          로그아웃
        </button>
      </div>
      <div className="admin-content" key={tab}>
        {tab === "list" && <ResultList rows={rows} />}
        {tab === "dash" && <DashboardView rows={rows} />}
        {tab === "roster" && <RosterManager />}
        {tab === "assignment" && <AssignmentManager />}
        {tab === "review" && <AssignmentReviewManager />}
        {tab === "teacherlog" && <TeacherLogManager />}
        {tab === "pending" && <PendingManager />}
        {tab === "submit" && <SubmissionStatus rows={rows} />}
        {tab === "report" && <StudentAnalysisReport rows={rows} />}
        {tab === "sms" && <SmsCenterPanel />}
        {tab === "examprep" && <ExamPrepPanel />}
        {tab === "growth" && <GrowthPanelLazy />}
      </div>
    </div>
  );
}

function ResultList({ rows }: { rows: ExamResult[] }) {
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");
  const [exam, setExam] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (q && !(`${r.student.name} ${r.student.studentCode}`.toLowerCase().includes(q.toLowerCase())))
        return false;
      if (school && !r.student.school.includes(school)) return false;
      if (grade && r.student.grade !== grade) return false;
      if (exam && !r.exam.examName.includes(exam)) return false;
      return true;
    });
  }, [rows, q, school, grade, exam]);

  function exportCSV() {
    const csv = "\uFEFF" + toCSV(filtered); // BOM for Excel Korean
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asx_results_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <h2>모의고사 제출목록 ({filtered.length})</h2>
      <div className="admin-tools">
        <input placeholder="이름/코드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="학교" value={school} onChange={(e) => setSchool(e.target.value)} />
        <input placeholder="학년" value={grade} onChange={(e) => setGrade(e.target.value)} />
        <input placeholder="시험" value={exam} onChange={(e) => setExam(e.target.value)} />
      </div>
      <button className="btn" onClick={exportCSV} disabled={filtered.length === 0}>
        CSV 내보내기
      </button>
      <div style={{ height: 12 }} />
      {filtered.length === 0 ? (
        <p className="muted center">데이터가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코드</th>
                <th>이름</th>
                <th>학교</th>
                <th>학년</th>
                <th>시험</th>
                <th>제출일</th>
                <th>점수</th>
                <th>%</th>
                <th>오답</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.student.studentCode}</td>
                  <td>{r.student.name}</td>
                  <td>{r.student.school}</td>
                  <td>{r.student.grade}</td>
                  <td>{r.exam.examName} ({r.exam.month}월)</td>
                  <td style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>
                    {new Date(r.submittedAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td>{r.score}/{r.exam.maxScore}</td>
                  <td>{percentScore(r.score, r.exam.maxScore)}</td>
                  <td>{r.wrongAnswers.map((w) => w.questionNo).join(",")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DashboardView({ rows }: { rows: ExamResult[] }) {
  const d = useMemo(() => computeDashboard(rows), [rows]);
  const maxQ = d.perQuestion[0]?.wrongCount || 1;
  const maxReason = d.perReason[0]?.count || 1;

  if (rows.length === 0)
    return (
      <div className="card">
        <h2>대시보드</h2>
        <p className="muted">아직 제출된 데이터가 없습니다.</p>
      </div>
    );

  return (
    <div className="card">
      <h2>대시보드</h2>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{d.studentCount}</div>
          <div className="l">제출 수</div>
        </div>
        <div className="stat">
          <div className="n">{d.avgScore}</div>
          <div className="l">평균 점수</div>
        </div>
        <div className="stat">
          <div className="n">{d.maxScore}</div>
          <div className="l">최고</div>
        </div>
        <div className="stat">
          <div className="n">{d.minScore}</div>
          <div className="l">최저</div>
        </div>
        <div className="stat">
          <div className="n">{d.wrongRate}%</div>
          <div className="l">전체 오답률</div>
        </div>
      </div>

      <h3>오답 많은 문항 TOP</h3>
      {d.perQuestion.slice(0, 10).map((q) => (
        <div className="bar-row" key={q.questionNo}>
          <div className="lab">{q.questionNo}번</div>
          <div className="bar">
            <div style={{ width: `${(q.wrongCount / maxQ) * 100}%` }} />
          </div>
          <div className="val">{q.wrongCount}</div>
        </div>
      ))}

      <h3>오답 원인 분포</h3>
      {d.perReason.map((r) => (
        <div className="bar-row" key={r.reason}>
          <div className="lab">{WRONG_REASON_LABELS[r.reason]}</div>
          <div className="bar">
            <div style={{ width: `${(r.count / maxReason) * 100}%` }} />
          </div>
          <div className="val">{r.count}</div>
        </div>
      ))}

      <h3>학교별 평균</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>학교</th>
              <th>인원</th>
              <th>평균</th>
            </tr>
          </thead>
          <tbody>
            {d.perSchool.map((s) => (
              <tr key={s.school}>
                <td>{s.school}</td>
                <td>{s.count}</td>
                <td>{s.avgScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RosterManager() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [preview, setPreview] = useState<RosterEntry[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editError, setEditError] = useState("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addName, setAddName] = useState("");
  const [addSchool, setAddSchool] = useState("");
  const [addGrade, setAddGrade] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addTeacher, setAddTeacher] = useState("");
  const [addErrors, setAddErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
  }, [rosterStore]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setNotice("");
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
    const existingCodes = roster.map((r) => r.studentCode);
    const { valid, errors } = parseRosterRows(rows, existingCodes);
    setPreview(valid);
    setParseErrors(errors);
  }

  async function confirmImport() {
    if (preview.length === 0) return;
    setSaving(true);
    const now = new Date().toISOString();
    // 기존 명부에 있던 학생은 registeredAt 그대로 유지, 신규 학생만 오늘 날짜
    const existingMap = new Map(roster.map((r) => [r.studentCode, r.registeredAt]));
    const stamped = preview.map((e) => ({
      ...e,
      registeredAt: e.registeredAt ?? existingMap.get(e.studentCode) ?? undefined,
    }));
    await rosterStore.saveRoster(stamped);
    const all = await rosterStore.listRoster();
    setRoster(all);
    setSaving(false);
    setNotice(`${preview.length}명 등록 완료.`);
    setPreview([]);
    setParseErrors([]);
    setFileName("");
  }

  async function clearAll() {
    if (!confirm("전체 명부를 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    await rosterStore.clearRoster();
    setRoster([]);
    setNotice("명부를 초기화했습니다.");
  }

  async function sendCode(entry: RosterEntry) {
    setNotice("");
    // 실제 발송: OtpService 가 감싸는 SmsProvider 를 직접 재사용
    const provider = createSmsProvider();
    try {
      await provider.send(
        entry.phone,
        `[L16] ${entry.name} 학생의 학생코드는 ${entry.studentCode} 입니다.`,
      );
      setNotice(`${entry.name} 학생에게 코드를 전송했습니다.`);
    } catch (e) {
      setNotice(`전송 실패: ${(e as Error).message}`);
    }
  }

  function startEdit(entry: RosterEntry) {
    setEditingCode(entry.studentCode);
    setEditPhone(entry.phone);
    setEditError("");
  }

  function cancelEdit() {
    setEditingCode(null);
    setEditPhone("");
    setEditError("");
  }

  async function savePhone(entry: RosterEntry) {
    const errs = validatePhoneNumber(editPhone);
    if (errs.length) return setEditError(errs[0]);
    const newPhone = normalizePhoneNumber(editPhone);
    await rosterStore.saveRoster([{ ...entry, phone: newPhone }]);
    const all = await rosterStore.listRoster();
    setRoster(all);
    setNotice(
      `${entry.name} 학생 번호를 변경했습니다. 기존 번호는 더 이상 사용할 수 없고, 새 번호로 바로 인증할 수 있습니다.`,
    );
    cancelEdit();
  }

  async function addStudent() {
    const { entry, errors } = buildManualEntry(
      {
        studentCode: addCode,
        name: addName,
        school: addSchool,
        grade: addGrade,
        phone: addPhone,
        teacher: addTeacher,
      },
      roster.map((r) => r.studentCode),
    );
    if (!entry) {
      setAddErrors(errors);
      return;
    }
    setAdding(true);
    setAddErrors([]);
    await rosterStore.saveRoster([{ ...entry, registeredAt: new Date().toISOString() }]);
    const all = await rosterStore.listRoster();
    setRoster(all);
    setAdding(false);
    setNotice(`${entry.name} 학생을 등록했습니다. (코드: ${entry.studentCode})`);
    setAddCode("");
    setAddName("");
    setAddSchool("");
    setAddGrade("");
    setAddPhone("");
    setAddTeacher("");
  }

  return (
    <div className="card">
      <h2>명부 관리</h2>
      <p className="sub">
        엑셀 명부를 업로드하면 학생코드·전화번호가 등록되어, 학생 전화인증 시 등록된 번호만
        허용됩니다.
      </p>

      {notice && <p className="muted">{notice}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn secondary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "학생 직접 추가 닫기" : "+ 학생 직접 추가"}
        </button>
      </div>

      {showAddForm && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>학생 직접 추가</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            엑셀 없이 학생 한 명을 바로 등록합니다. 학생코드는 비워두면 자동 생성됩니다.
          </p>
          {addErrors.length > 0 && (
            <div className="errors">
              <ul>
                {addErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <label>학생코드 (선택)</label>
          <input value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="비워두면 자동 생성" />
          <label>이름</label>
          <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="이름" />
          <div className="row">
            <div>
              <label>학교</label>
              <input value={addSchool} onChange={(e) => setAddSchool(e.target.value)} placeholder="예: 창동고" />
            </div>
            <div>
              <label>학년</label>
              <select value={addGrade} onChange={(e) => setAddGrade(e.target.value)}>
                <option value="">선택</option>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
                <option value="N">N수</option>
              </select>
            </div>
          </div>
          <label>휴대폰번호</label>
          <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="010-1234-5678" />
          <label>담당교사 (선택)</label>
          <input value={addTeacher} onChange={(e) => setAddTeacher(e.target.value)} placeholder="예: 김민수" />
          <div style={{ height: 12 }} />
          <button className="btn" onClick={addStudent} disabled={adding}>
            {adding ? "등록 중…" : "등록하기"}
          </button>
        </div>
      )}

      <div style={{ height: 20 }} />
      <label>엑셀 파일 선택 (.xlsx)</label>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
      {fileName && <p className="muted" style={{ fontSize: 13 }}>{fileName}</p>}

      {parseErrors.length > 0 && (
        <div className="errors">
          다음 행에 문제가 있어 제외되었습니다:
          <ul>
            {parseErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.length > 0 && (
        <>
          <h3>미리보기 ({preview.length}명)</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            학생코드를 비워둔 행은 자동으로 코드가 생성되었습니다.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>코드</th>
                  <th>이름</th>
                  <th>학교</th>
                  <th>학년</th>
                  <th>전화번호</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((e) => (
                  <tr key={e.studentCode}>
                    <td>{e.studentCode}</td>
                    <td>{e.name}</td>
                    <td>{e.school}</td>
                    <td>{e.grade}</td>
                    <td>{e.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 10 && (
            <p className="muted" style={{ fontSize: 13 }}>
              외 {preview.length - 10}명…
            </p>
          )}
          <div style={{ height: 10 }} />
          <button className="btn" onClick={confirmImport} disabled={saving}>
            {saving ? "등록 중…" : `${preview.length}명 등록하기`}
          </button>
        </>
      )}

      <div style={{ height: 20 }} />
      <GracePeriodNotifier roster={roster} />

      <div style={{ height: 20 }} />
      <h3>등록된 명부 ({roster.length}명)</h3>
      {roster.length === 0 ? (
        <p className="muted">아직 등록된 학생이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코드</th>
                <th>이름</th>
                <th>학교</th>
                <th>전화번호</th>
                <th>등급</th>
                <th>주간시수</th>
                <th>학부모번호</th>
                <th>독려제외</th>
                <th>수업요일</th>
                <th>수업이력</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((e) => {
                const isEditing = editingCode === e.studentCode;
                const typeColor = e.studentType === "S" ? "#9b59b6" : e.studentType === "W2" ? "#e67e22" : e.studentType === "W1" ? "#e74c3c" : "#aaa";
                return (
                  <tr key={e.studentCode} style={{ background: isEditing ? "#f8f9ff" : "transparent" }}>
                    <td style={{ fontSize: 12, color: "#666" }}>{e.studentCode}</td>
                    <td style={{ fontWeight: 600 }}>
                      {e.name}
                      {e.registeredAt && (Date.now()-new Date(e.registeredAt).getTime())/86400000 <= 30 && (
                        <span style={{ fontSize:9, fontWeight:700, color:"#fff", background:"#e74c3c",
                          borderRadius:8, padding:"1px 5px", marginLeft:4 }}>신규</span>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>{e.school}</td>

                    {/* 전화번호 - 수정 버튼 클릭 시만 편집 */}
                    <td>
                      {isEditing ? (
                        <div>
                          <input value={editPhone} onChange={(ev) => setEditPhone(ev.target.value)} placeholder="010-1234-5678" style={{ padding: 4, fontSize: 13, width: 130 }} />
                          {editError && <div style={{ color: "red", fontSize: 11 }}>{editError}</div>}
                        </div>
                      ) : (
                        <span style={{ fontSize: 13 }}>{e.phone}</span>
                      )}
                    </td>

                    {/* 등급 - 항상 바로 선택 가능 */}
                    <td style={{ textAlign: "center" }}>
                      <select
                        value={e.studentType ?? ""}
                        onChange={(ev) => {
                          const updated = roster.map((r) =>
                            r.studentCode === e.studentCode ? { ...r, studentType: ev.target.value as "S" | "W2" | "W1" | "" } : r
                          );
                          setRoster(updated);
                          rosterStore.saveRoster(updated);
                        }}
                        style={{ fontSize: 12, padding: "3px 4px", borderRadius: 4, border: `2px solid ${e.studentType ? typeColor : "#ddd"}`, background: e.studentType ? typeColor + "18" : "#fff", color: e.studentType ? typeColor : "#888", fontWeight: e.studentType ? 700 : 400, cursor: "pointer" }}
                      >
                        <option value="">미설정</option>
                        <option value="S">S - 특별관리</option>
                        <option value="W2">W2 - 주2타임</option>
                        <option value="W1">W1 - 주1타임</option>
                      </select>
                    </td>

                    {/* 주간시수 - 항상 바로 선택 가능 */}
                    <td style={{ textAlign: "center" }}>
                      <select
                        value={e.weeklySession ?? ""}
                        onChange={(ev) => {
                          const val = ev.target.value === "" ? null : Number(ev.target.value) as 1|2|3|4|5|6;
                          const updated = roster.map((r) =>
                            r.studentCode === e.studentCode ? { ...r, weeklySession: val } : r
                          );
                          setRoster(updated);
                          rosterStore.saveRoster(updated);
                        }}
                        style={{ fontSize: 12, padding: "3px 4px", borderRadius: 4, border: `2px solid ${e.weeklySession ? "#2980b9" : "#ddd"}`, background: e.weeklySession ? "#eaf4fb" : "#fff", color: e.weeklySession ? "#2980b9" : "#888", fontWeight: e.weeklySession ? 700 : 400, cursor: "pointer" }}
                      >
                        <option value="">미설정</option>
                        {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}회/주</option>)}
                      </select>
                      {e.weeklySession ? <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>기한 {getReminderDays(e.weeklySession)}일</div> : null}
                    </td>

                    {/* 학부모번호 - 항상 바로 편집, 포커스 벗어나면 저장 */}
                    <td>
                      <input
                        defaultValue={e.parentPhone ?? ""}
                        placeholder="미등록"
                        style={{ width: 115, fontSize: 12, padding: "3px 6px", borderRadius: 4, border: `1px solid ${e.parentPhone ? "#2980b9" : "#ddd"}`, color: e.parentPhone ? "#333" : "#aaa" }}
                        onBlur={async (ev) => {
                          const val = ev.target.value.trim();
                          if (val === (e.parentPhone ?? "")) return;
                          const updated = roster.map((r) =>
                            r.studentCode === e.studentCode ? { ...r, parentPhone: val || undefined } : r
                          );
                          setRoster(updated);
                          await rosterStore.saveRoster(updated);
                          setNotice(`${e.name} 학부모번호 저장`);
                          setTimeout(() => setNotice(""), 1500);
                        }}
                      />
                    </td>

                    {/* 독려제외 - 항상 바로 클릭 가능 */}
                    <td style={{ textAlign: "center" }}>
                      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", gap: 2 }}>
                        <input
                          type="checkbox"
                          checked={!!e.excludeFromReminder}
                          onChange={async (ev) => {
                            const updated = roster.map((r) =>
                              r.studentCode === e.studentCode ? { ...r, excludeFromReminder: ev.target.checked } : r
                            );
                            setRoster(updated);
                            await rosterStore.saveRoster(updated);
                          }}
                          style={{ width: 18, height: 18 }}
                        />
                        {e.excludeFromReminder && (
                          <span style={{ fontSize: 10, color: "#27ae60", fontWeight: 700 }}>제외중</span>
                        )}
                      </label>
                    </td>

                    {/* 수업 요일 */}
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {(["mon","tue","wed","thu","fri","sat","sun"] as const).map((day) => {
                          const labels: Record<string, string> = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일" };
                          const count = (e.lessonDays ?? {})[day] ?? 0;
                          return (
                            <button key={day} onClick={async () => {
                              const next: LessonDayMap = { ...(e.lessonDays ?? {}) };
                              if (count === 0) next[day] = 1;
                              else if (count === 1) next[day] = 2;
                              else delete next[day];
                              const updated = roster.map((r) => r.studentCode === e.studentCode ? { ...r, lessonDays: next } : r);
                              setRoster(updated);
                              await rosterStore.saveRoster(updated);
                            }} style={{ padding: "2px 5px", borderRadius: 4, fontSize: 11, border: "none", cursor: "pointer",
                              background: count === 2 ? "#e74c3c" : count === 1 ? "#2980b9" : "#f0f0f0",
                              color: count > 0 ? "#fff" : "#555", fontWeight: count > 0 ? 700 : 400 }}>
                              {labels[day]}{count === 2 ? "×2" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </td>

                    {/* 수업 이력 */}
                    <td>
                      <ClassSessionManager entry={e} roster={roster} setRoster={setRoster} rosterStore={rosterStore} />
                    </td>

                    {/* 관리 - 전화번호 수정/코드전송만 */}
                    <td>
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <button className="btn" style={{ padding: "4px 10px", fontSize: 12, background: "#27ae60", color: "#fff", border: "none" }} onClick={() => savePhone(e)}>저장</button>
                          <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={cancelEdit}>취소</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => startEdit(e)}>번호수정</button>
                          <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => sendCode(e)}>코드전송</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {roster.length > 0 && (
        <>
          <div style={{ height: 10 }} />
          <button className="btn secondary" onClick={clearAll}>
            명부 전체 삭제
          </button>
        </>
      )}

      {/* ── 과제 독려 발송 섹션 ── */}
      {roster.length > 0 && (
        <LessonScheduleManager roster={roster} setRoster={setRoster} rosterStore={rosterStore} />
      )}
      {roster.length > 0 && (
        <ReminderSection roster={roster} />
      )}
    </div>
  );
}

// ── 학생별 수업 요일 등록 ─────────────────────────────
const DAY_LABELS: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일"
};
const ALL_DAYS = ["mon","tue","wed","thu","fri","sat","sun"] as const;

function LessonScheduleManager({ roster, setRoster, rosterStore }: {
  roster: RosterEntry[];
  setRoster: (r: RosterEntry[]) => void;
  rosterStore: ReturnType<typeof createRosterStore>;
}) {
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [tempDays, setTempDays] = useState<LessonDayMap>({});
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [addingSession, setAddingSession] = useState<{
    date: string;
    status: "normal" | "cancelled" | "absent" | "makeup";
    makeupDate: string;
    time: string;
    reason: string;
  } | null>(null);
  const [notice, setNotice] = useState("");

  const student = roster.find((r) => r.studentCode === selectedStudent);
  const sessions = student?.classSessions ?? [];

  // 학생 선택 시 tempDays 자동 동기화
  useEffect(() => {
    setTempDays(student?.lessonDays ?? {});
  }, [selectedStudent, roster]);

  function startEdit() {
    setTempDays(student?.lessonDays ?? {});
    setEditMode(true);
  }

  async function saveDays() {
    const updated = roster.map((r) =>
      r.studentCode === selectedStudent ? { ...r, lessonDays: tempDays as any } : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
    setEditMode(false);
    setNotice("저장 완료");
    setTimeout(() => setNotice(""), 2000);
  }

  async function saveSession() {
    if (!addingSession || !student) return;
    const session: import("../../core/roster").ClassSession = {
      date: addingSession.date,
      status: addingSession.status,
      makeupDate: addingSession.makeupDate || undefined,
      makeupDone: false,
      note: [addingSession.time, addingSession.reason].filter(Boolean).join(" | ") || undefined,
    };
    const updated = roster.map((r) =>
      r.studentCode === selectedStudent
        ? { ...r, classSessions: [...(r.classSessions ?? []), session].sort((a, b) => b.date.localeCompare(a.date)) }
        : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
    setAddingSession(null);
    setNotice("수업 이력 저장 완료");
    setTimeout(() => setNotice(""), 2000);
  }

  async function deleteSession(date: string) {
    const updated = roster.map((r) =>
      r.studentCode === selectedStudent
        ? { ...r, classSessions: (r.classSessions ?? []).filter((s) => s.date !== date) }
        : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
  }

  async function toggleMakeup(date: string) {
    const updated = roster.map((r) =>
      r.studentCode === selectedStudent
        ? { ...r, classSessions: (r.classSessions ?? []).map((s) =>
            s.date === date ? { ...s, makeupDone: !s.makeupDone } : s) }
        : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
  }

  // 달력 생성
  const [year, month] = calMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const sessionDates = new Set(sessions.map((s) => s.date));

  const statusLabel: Record<string, string> = { normal: "정상", cancelled: "휴강", absent: "결강", makeup: "보충" };
  const statusColor: Record<string, string> = { cancelled: "#f39c12", absent: "#e74c3c", makeup: "#2980b9" };

  return (
    <div style={{ marginTop: 24, padding: 20, border: "2px solid #2980b9", borderRadius: 12 }}>
      <h3 style={{ margin: "0 0 16px", color: "#2980b9" }}>📅 학생별 수업 요일 등록</h3>

      {/* ── 학생 시수 현황 명단 ── */}
      <div style={{ marginBottom: 20, background: "#f8f9ff", borderRadius: 10, padding: 14 }}>
        <h4 style={{ margin: "0 0 10px", color: "#2c3e50" }}>📋 학생 시수 현황</h4>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#2980b9", color: "#fff" }}>
                <th style={{ padding: "6px 10px", textAlign: "left" }}>이름</th>
                <th style={{ padding: "6px 10px", textAlign: "left" }}>학교</th>
                <th style={{ padding: "6px 10px", textAlign: "center" }}>상태</th>
                <th style={{ padding: "6px 10px", textAlign: "center" }}>주 시수</th>
                <th style={{ padding: "6px 10px", textAlign: "left" }}>수업 요일</th>
                <th style={{ padding: "6px 10px", textAlign: "center" }}>변경</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r, i) => {
                const total = calcWeeklyTotal(r.lessonDays);
                const status = r.studentStatus ?? "active";
                const statusConfig = {
                  active: { label: "수강중", color: "#27ae60", bg: "#e8f8f5" },
                  paused: { label: "중단", color: "#f39c12", bg: "#fef9e7" },
                  withdrawn: { label: "퇴원", color: "#e74c3c", bg: "#fdecea" },
                };
                const sc = statusConfig[status];
                return (
                  <tr key={r.studentCode} style={{ background: status === "active" ? (i % 2 === 0 ? "#fff" : "#f5f5f5") : sc.bg, opacity: status === "withdrawn" ? 0.6 : 1 }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600, color: status !== "active" ? sc.color : "#333" }}>
                      {r.name}
                      {r.registeredAt && (Date.now()-new Date(r.registeredAt).getTime())/86400000 <= 30 && (
                        <span style={{ fontSize:9, fontWeight:700, color:"#fff", background:"#e74c3c",
                          borderRadius:8, padding:"1px 5px", marginLeft:4 }}>신규</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 10px", color: "#666" }}>{r.school}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: sc.bg, color: sc.color, border: `1px solid ${sc.color}` }}>
                        {sc.label}
                      </span>
                      {r.pausedAt && <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{r.pausedAt.slice(0, 10)}~</div>}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      {total > 0 ? (
                        <span style={{ fontWeight: 700, color: "#2980b9", background: "#eaf4fb", padding: "2px 10px", borderRadius: 12 }}>
                          주 {total}회
                        </span>
                      ) : <span style={{ color: "#ccc", fontSize: 12 }}>미설정</span>}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {r.lessonDays && Object.keys(r.lessonDays).length > 0 ? (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {Object.entries(r.lessonDays).map(([d, n]) => (
                            <span key={d} style={{ padding: "1px 7px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: n === 2 ? "#e74c3c" : "#2980b9", color: "#fff" }}>
                              {DAY_LABELS[d]}{n === 2 ? "×2" : ""}
                            </span>
                          ))}
                        </div>
                      ) : <span style={{ color: "#ccc", fontSize: 12 }}>-</span>}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      <select
                        value={status}
                        onChange={async (e) => {
                          const newStatus = e.target.value as StudentStatus;
                          const updated = roster.map((s) =>
                            s.studentCode === r.studentCode ? {
                              ...s,
                              studentStatus: newStatus,
                              pausedAt: newStatus === "paused" ? new Date().toISOString().slice(0, 10) : s.pausedAt,
                            } : s
                          );
                          setRoster(updated);
                          await rosterStore.saveRoster(updated);
                        }}
                        style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4, border: `1px solid ${sc.color}`, color: sc.color, background: sc.bg }}
                      >
                        <option value="active">수강중</option>
                        <option value="paused">중단</option>
                        <option value="withdrawn">퇴원</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 학생 선택 */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 600, marginRight: 8 }}>학생 선택:</label>
        <select
          value={selectedStudent}
          onChange={(e) => { setSelectedStudent(e.target.value); setEditMode(false); setShowCalendar(false); }}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
        >
          <option value="">-- 학생 선택 --</option>
          {roster.map((r) => (
            <option key={r.studentCode} value={r.studentCode}>{r.name} ({r.school})</option>
          ))}
        </select>
      </div>

      {student && (
        <>
          {notice && <p style={{ color: "#27ae60", fontWeight: 600, marginBottom: 8 }}>{notice}</p>}

          {/* ── 수업 요일 ── */}
          <div style={{ background: "#f8f9ff", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>수업 요일</span>
              <button onClick={saveDays} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 13, border: "none", background: "#27ae60", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                저장
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {ALL_DAYS.map((day) => {
                const count = tempDays[day] ?? 0;
                return (
                  <div key={day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <button
                      onClick={() => {
                        const next: LessonDayMap = { ...tempDays };
                        if (count === 0) next[day] = 1;
                        else if (count === 1) next[day] = 2;
                        else delete next[day];
                        setTempDays(next);
                      }}
                      style={{
                        width: 44, height: 44, borderRadius: "50%", fontWeight: 700, fontSize: 16, cursor: "pointer",
                        background: count === 2 ? "#e74c3c" : count === 1 ? "#2980b9" : "#f0f0f0",
                        color: count > 0 ? "#fff" : "#888",
                        border: count === 2 ? "2px solid #e74c3c" : count === 1 ? "2px solid #2980b9" : "2px solid #ddd",
                        position: "relative",
                      }}
                    >
                      {DAY_LABELS[day]}
                    </button>
                    <span style={{ fontSize: 10, fontWeight: 700,
                      color: count === 2 ? "#e74c3c" : count === 1 ? "#2980b9" : "#ccc" }}>
                      {count === 2 ? "연강" : count === 1 ? "1회" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: "#888", margin: "0 0 10px" }}>
              1번 클릭 = 1회(파랑) · 2번 클릭 = 연강(빨강) · 3번 클릭 = 해제
            </p>

            {/* 주 n회 표시 */}
            <div style={{ fontSize: 15, fontWeight: 700, color: "#2c3e50" }}>
              주&nbsp;
              <span style={{ fontSize: 22, color: "#2980b9" }}>{calcWeeklyTotal(tempDays)}</span>
              &nbsp;회
              {Object.keys(tempDays).length > 0 && (
                <span style={{ fontSize: 13, color: "#888", marginLeft: 8 }}>
                  ({Object.entries(tempDays).map(([d, n]) =>
                    `${DAY_LABELS[d]}${n === 2 ? "(연강)" : ""}`
                  ).join(", ")})
                </span>
              )}
            </div>
          </div>

          {/* ── 수업 이력 + 달력 ── */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>

            {/* 달력 */}
            <div style={{ flex: "1 1 300px", background: "#f9f9f9", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <button onClick={() => {
                  const d = new Date(year, month - 2, 1);
                  setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}>‹</button>
                <span style={{ fontWeight: 700 }}>{year}년 {month}월</span>
                <button onClick={() => {
                  const d = new Date(year, month, 1);
                  setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}>›</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
                {["일","월","화","수","목","금","토"].map((d) => (
                  <div key={d} style={{ fontSize: 11, color: "#888", fontWeight: 600, padding: "2px 0" }}>{d}</div>
                ))}
                {Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const dateStr = `${calMonth}-${String(i + 1).padStart(2, "0")}`;
                  const session = sessions.find((s) => s.date === dateStr);
                  const isLesson = !!(student.lessonDays ?? {})[
                    ["sun","mon","tue","wed","thu","fri","sat"][new Date(dateStr).getDay()] as DayOfWeek
                  ];
                  const isNormalAttended = session?.status === "normal" && session.attended === true;
                  const isNormalUnchecked = session?.status === "normal" && session.attended === undefined;
                  const bgColor = session
                    ? (session.status === "cancelled" ? "#f39c12"
                      : session.status === "absent" ? "#e74c3c"
                      : session.status === "makeup" ? "#2980b9"
                      : isNormalAttended ? "#27ae60"
                      : "#95a5a6")
                    : isLesson ? "#eaf4fb" : "transparent";
                  const textColor = session ? "#fff" : isLesson ? "#2980b9" : "#333";
                  return (
                    <div key={i} onClick={async () => {
                      if (!isLesson && !session) return;
                      if (session?.status === "normal") {
                        // 출석 체크 토글: undefined → true → false → undefined
                        const next = session.attended === undefined ? true : session.attended ? false : undefined;
                        const updated = roster.map((r) =>
                          r.studentCode === selectedStudent
                            ? { ...r, classSessions: (r.classSessions ?? []).map((s) =>
                                s.date === dateStr ? { ...s, attended: next } : s) }
                            : r
                        );
                        setRoster(updated);
                        await rosterStore.saveRoster(updated);
                      } else if (!session) {
                        // 새 이력 추가 (정상 수업일로 기본)
                        setAddingSession({ date: dateStr, status: "normal" as any, makeupDate: "", time: "", reason: "" });
                      }
                    }}
                      style={{
                        padding: "4px 2px", borderRadius: 6, fontSize: 12,
                        cursor: (isLesson || session) ? "pointer" : "default",
                        background: bgColor, color: textColor,
                        fontWeight: session || isLesson ? 700 : 400,
                        border: "1px solid transparent",
                        minHeight: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      }}
                      title={session
                        ? `${statusLabel[session.status]}${session.attended === true ? " ✅출석" : session.attended === false ? " ❌결석" : ""}${session.note ? " | " + session.note : ""}`
                        : isLesson ? "클릭: 이력 추가" : ""}
                    >
                      {i + 1}
                      {session && (
                        <div style={{ fontSize: 8, lineHeight: 1 }}>
                          {session.status === "normal"
                            ? (session.attended === true ? "✅" : session.attended === false ? "❌" : "?")
                            : statusLabel[session.status]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>파란 날짜 = 수업일 · 클릭하면 이력 추가</p>
            </div>

            {/* 수업 이력 목록 */}
            <div style={{ flex: "1 1 280px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>수업 이력</span>
                <button
                  onClick={() => setAddingSession({ date: new Date().toISOString().slice(0, 10), status: "cancelled", makeupDate: "", time: "", reason: "" })}
                  style={{ padding: "4px 12px", borderRadius: 6, fontSize: 13, border: "none", background: "#e74c3c", color: "#fff", cursor: "pointer" }}
                >
                  ⚡ 긴급 보충일 추가
                </button>
              </div>

              {sessions.length === 0 ? (
                <p className="muted">수업 이력이 없습니다.</p>
              ) : (
                <div style={{ maxHeight: 260, overflowY: "auto" }}>
                  {sessions.map((s) => (
                    <div key={s.date} style={{ padding: "8px 10px", borderRadius: 8, marginBottom: 6, background: "#fff", border: `1px solid ${statusColor[s.status] ?? "#eee"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <span style={{ fontWeight: 700, color: statusColor[s.status], fontSize: 13 }}>{statusLabel[s.status]}</span>
                          <span style={{ marginLeft: 8, fontSize: 13, color: "#555" }}>{s.date}</span>
                          {s.makeupDate && (
                            <span style={{ marginLeft: 6, fontSize: 12, color: "#888" }}>→ 보충: {s.makeupDate}</span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {s.makeupDate && (
                            <button onClick={() => toggleMakeup(s.date)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #ddd", cursor: "pointer", background: s.makeupDone ? "#e8f8f5" : "#fef9e7" }}>
                              {s.makeupDone ? "✅완료" : "미완"}
                            </button>
                          )}
                          <button onClick={() => deleteSession(s.date)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #e74c3c", color: "#e74c3c", cursor: "pointer", background: "#fff" }}>삭제</button>
                        </div>
                      </div>
                      {s.note && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{s.note}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 월별 정산 ── */}
          <div style={{ marginTop: 16, background: "#f0f9f0", borderRadius: 10, padding: 14, border: "2px solid #27ae60" }}>
            <h4 style={{ margin: "0 0 12px", color: "#27ae60" }}>📊 {calMonth.replace("-", "년 ")}월 정산</h4>
            {(() => {
              const s = calcMonthlySettlement(student, year, month);
              const attendRate = s.possibleCount > 0 ? Math.round(s.actualCount / s.possibleCount * 100) : 0;
              return (
                <div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                    {[
                      { label: "가능 수업수", value: s.possibleCount, color: "#2c3e50", unit: "회" },
                      { label: "실제 수업수", value: s.actualCount, color: "#27ae60", unit: "회" },
                      { label: "보충 수업수", value: s.makeupCount, color: "#2980b9", unit: "회" },
                      { label: "휴강수", value: s.cancelledCount, color: "#f39c12", unit: "회" },
                      { label: "결강수", value: s.absentCount, color: "#e74c3c", unit: "회" },
                      { label: "미확인", value: s.uncheckedCount, color: "#95a5a6", unit: "회" },
                    ].map((item) => (
                      <div key={item.label} style={{ background: "#fff", borderRadius: 8, padding: "8px 14px", textAlign: "center", border: `1px solid ${item.color}22` }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>{item.value}{item.unit}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: "#fff", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>출석률</span>
                    <div style={{ flex: 1, background: "#eee", borderRadius: 4, height: 12 }}>
                      <div style={{ width: `${attendRate}%`, background: attendRate >= 80 ? "#27ae60" : attendRate >= 60 ? "#f39c12" : "#e74c3c", height: 12, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontWeight: 700, color: attendRate >= 80 ? "#27ae60" : "#e74c3c" }}>{attendRate}%</span>
                  </div>
                  {s.uncheckedCount > 0 && (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#95a5a6" }}>
                      ⚠️ 출석 미확인 {s.uncheckedCount}회 — 달력에서 날짜를 클릭하여 출석 확인하세요.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ── 전체 학생 월별 정산 ── */}
          <div style={{ marginTop: 16, background: "#fafafa", borderRadius: 10, padding: 14, border: "1px solid #ddd" }}>
            <h4 style={{ margin: "0 0 12px", color: "#2c3e50" }}>📋 전체 학생 {calMonth.replace("-", "년 ")}월 정산</h4>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#2c3e50", color: "#fff" }}>
                    <th style={{ padding: "5px 8px", textAlign: "left" }}>이름</th>
                    <th style={{ padding: "5px 8px", textAlign: "center" }}>가능</th>
                    <th style={{ padding: "5px 8px", textAlign: "center", color: "#2ecc71" }}>실제</th>
                    <th style={{ padding: "5px 8px", textAlign: "center", color: "#3498db" }}>보충</th>
                    <th style={{ padding: "5px 8px", textAlign: "center", color: "#f39c12" }}>휴강</th>
                    <th style={{ padding: "5px 8px", textAlign: "center", color: "#e74c3c" }}>결강</th>
                    <th style={{ padding: "5px 8px", textAlign: "center" }}>출석률</th>
                  </tr>
                </thead>
                <tbody>
                  {roster
                    .filter((r) => (r.studentStatus ?? "active") !== "withdrawn")
                    .map((r, i) => {
                      const s = calcMonthlySettlement(r, year, month);
                      const rate = s.possibleCount > 0 ? Math.round(s.actualCount / s.possibleCount * 100) : 0;
                      const isPaused = r.studentStatus === "paused";
                      return (
                        <tr key={r.studentCode} style={{ background: isPaused ? "#fff8f0" : i % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                          <td style={{ padding: "5px 8px", fontWeight: 600, color: isPaused ? "#f39c12" : "#333" }}>
                            {r.name}{isPaused ? " (중단)" : ""}
                          </td>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>{s.possibleCount}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 700, color: "#27ae60" }}>{s.actualCount}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#2980b9" }}>{s.makeupCount}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#f39c12" }}>{s.cancelledCount}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#e74c3c" }}>{s.absentCount}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>
                            <span style={{ fontWeight: 700, color: rate >= 80 ? "#27ae60" : rate >= 60 ? "#f39c12" : "#e74c3c" }}>
                              {s.possibleCount > 0 ? `${rate}%` : "-"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#2c3e50", color: "#fff", fontWeight: 700 }}>
                    <td style={{ padding: "5px 8px" }}>합계</td>
                    {(() => {
                      const all = roster
                        .filter((r) => (r.studentStatus ?? "active") !== "withdrawn")
                        .map((r) => calcMonthlySettlement(r, year, month));
                      return (
                        <>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>{all.reduce((s, r) => s + r.possibleCount, 0)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#2ecc71" }}>{all.reduce((s, r) => s + r.actualCount, 0)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#3498db" }}>{all.reduce((s, r) => s + r.makeupCount, 0)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#f39c12" }}>{all.reduce((s, r) => s + r.cancelledCount, 0)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center", color: "#e74c3c" }}>{all.reduce((s, r) => s + r.absentCount, 0)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "center" }}>-</td>
                        </>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {addingSession && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 340, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
                <h3 style={{ margin: "0 0 16px" }}>수업 이력 추가 — {student.name}</h3>

                <label style={{ fontSize: 13, fontWeight: 600 }}>날짜</label>
                <input type="date" value={addingSession.date}
                  onChange={(e) => setAddingSession({ ...addingSession, date: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, marginBottom: 10 }} />

                <label style={{ fontSize: 13, fontWeight: 600 }}>구분</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, marginTop: 4 }}>
                  {(["normal","cancelled","absent","makeup"] as const).map((st) => (
                    <button key={st} onClick={() => setAddingSession({ ...addingSession, status: st as any })}
                      style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer",
                        background: addingSession.status === st ? statusColor[st] : "#f5f5f5",
                        color: addingSession.status === st ? "#fff" : "#555",
                        border: `1px solid ${addingSession.status === st ? statusColor[st] : "#ddd"}` }}>
                      {statusLabel[st]}
                    </button>
                  ))}
                </div>

                {addingSession.status === "cancelled" && (
                  <>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>보충 날짜 (선택)</label>
                    <input type="date" value={addingSession.makeupDate}
                      onChange={(e) => setAddingSession({ ...addingSession, makeupDate: e.target.value })}
                      style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, marginBottom: 10 }} />
                  </>
                )}

                <label style={{ fontSize: 13, fontWeight: 600 }}>시간 (예: 14:00)</label>
                <input type="time" value={addingSession.time}
                  onChange={(e) => setAddingSession({ ...addingSession, time: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, marginBottom: 10 }} />

                <label style={{ fontSize: 13, fontWeight: 600 }}>사유 / 메모</label>
                <textarea value={addingSession.reason}
                  onChange={(e) => setAddingSession({ ...addingSession, reason: e.target.value })}
                  rows={2} placeholder="예) 학교 시험 / 개인 사정 / 긴급 보충"
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, resize: "none", boxSizing: "border-box", marginBottom: 14 }} />

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveSession} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>저장</button>
                  <button onClick={() => setAddingSession(null)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, cursor: "pointer" }}>취소</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 과제 독려 발송 섹션 ─────────────────────────────
function ReminderSection({ roster }: { roster: RosterEntry[] }) {
  const assignmentStore = useMemo(() => createAssignmentStore(), []);
  const storage = useStorage();
  const smsProvider = useMemo(() => createSmsProvider(), []);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [examRows, setExamRows] = useState<ExamResult[]>([]);
  const [assignmentTypes, setAssignmentTypes] = useState<{ id: string; name: string }[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    Promise.all([
      assignmentStore.listSubmissions(),
      assignmentStore.listTypes(),
      storage.listResults(),
    ]).then(([subs, types, exams]) => {
      setSubmissions(subs);
      setAssignmentTypes(types as { id: string; name: string }[]);
      setExamRows(exams);
    });
  }, [assignmentStore, storage]);

  // 학생별 마지막 제출일 — 일반과제 OR 모의고사 중 최신
  const lastSubmitMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of submissions) {
      const prev = map.get(s.studentCode);
      if (!prev || s.submittedAt > prev) map.set(s.studentCode, s.submittedAt);
    }
    for (const r of examRows) {
      const prev = map.get(r.student.studentCode);
      if (!prev || r.submittedAt > prev) map.set(r.student.studentCode, r.submittedAt);
    }
    return map;
  }, [submissions, examRows]);

  // 학생별 제출한 과제 ID 목록
  const submittedByStudent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of submissions) {
      if (!map.has(s.studentCode)) map.set(s.studentCode, new Set());
      map.get(s.studentCode)!.add(s.typeId);
    }
    return map;
  }, [submissions]);

  // 과제 미저장 학생 (lastAssignmentSavedAt 없거나 1일 초과)
  const unSavedStudents = useMemo(() => {
    const now = Date.now();
    return roster.filter((r) => {
      if (!r.lastAssignmentSavedAt) return true;
      const diff = (now - new Date(r.lastAssignmentSavedAt).getTime()) / 86400000;
      return diff > 1;
    });
  }, [roster]);

  function daysSince(isoDate: string) {
    return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
  }

  const reminderTargets = useMemo(() => {
    const now = new Date();
    return roster
      .filter((r) => !r.excludeFromReminder)
      .filter((r) => !isInGracePeriod(r.registeredAt, now))
      .map((r) => {
        const lastDate = lastSubmitMap.get(r.studentCode);
        const baseDate = lastDate ?? r.registeredAt;
        if (!baseDate) return null;
        const days = daysSince(baseDate);
        const threshold = getReminderDays(r.weeklySession);
        const submitted = submittedByStudent.get(r.studentCode) ?? new Set();
        const unsubmitted = assignmentTypes.filter((t) => !submitted.has(t.id));
        return { ...r, days, lastDate: lastDate ?? null, threshold, neverSubmitted: !lastDate, unsubmitted };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.days >= r.threshold)
      .sort((a, b) => b.days - a.days);
  }, [roster, lastSubmitMap, submittedByStudent, assignmentTypes]);

  const autoTargets = reminderTargets.filter((r) => r.weeklySession === 1 || r.weeklySession === 2);
  const otherTargets = reminderTargets.filter((r) => r.weeklySession !== 1 && r.weeklySession !== 2);

  async function sendReminder(student: typeof reminderTargets[0]) {
    setSending(student.studentCode);
    setNotice("");
    try {
      const unsubNames = student.unsubmitted.map((t) => t.name).join(", ");
      const msg = unsubNames
        ? `[L16] ${student.name} 학생, 미제출 과제: ${unsubNames}. 빠른 제출 부탁드립니다.`
        : `[L16] ${student.name} 학생, 과제 제출이 ${student.days}일 경과됐습니다. 빠른 제출 부탁드립니다.`;
      await smsProvider.send(student.phone, msg);
      setNotice(`${student.name} 학생에게 독려 문자를 발송했습니다.`);
    } catch {
      setNotice(`${student.name} 학생 발송 실패`);
    }
    setSending(null);
  }

  async function sendAllAuto() {
    setSending("__all__");
    setNotice("");
    let ok = 0;
    for (const s of autoTargets) {
      try {
        const unsubNames = s.unsubmitted.map((t) => t.name).join(", ");
        const msg = unsubNames
          ? `[L16] ${s.name} 학생, 미제출 과제: ${unsubNames}. 빠른 제출 부탁드립니다.`
          : `[L16] ${s.name} 학생, 과제 제출이 ${s.days}일 경과됐습니다. 빠른 제출 부탁드립니다.`;
        await smsProvider.send(s.phone, msg);
        ok++;
      } catch { /* 계속 */ }
    }
    setNotice(`${ok}명에게 독려 문자 발송 완료`);
    setSending(null);
  }

  if (reminderTargets.length === 0 && unSavedStudents.length === 0)
    return (
      <div style={{ marginTop: 24, padding: 16, background: "#f0f9f0", borderRadius: 10, border: "1px solid #2ecc71" }}>
        <p style={{ margin: 0, color: "#27ae60", fontWeight: 600 }}>✅ 독려 대상 없음 · 과제 미저장 학생 없음</p>
      </div>
    );

  return (
    <div style={{ marginTop: 24 }}>
      {/* ── 과제 미저장 알림 ── */}
      {unSavedStudents.length > 0 && (
        <div style={{ background: "#fdecea", border: "2px solid #e74c3c", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700, color: "#e74c3c", fontSize: 15 }}>
            ⚠️ 과제 미저장 학생 ({unSavedStudents.length}명) — 1일 이상 경과
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unSavedStudents.map((s) => (
              <span key={s.studentCode} style={{ padding: "2px 10px", background: "#fff", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "1px solid #e74c3c" }}>
                {s.name}
                {s.lastAssignmentSavedAt ? ` (D+${daysSince(s.lastAssignmentSavedAt)})` : " (미등록)"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 독려 대상 ── */}
      {reminderTargets.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0, color: "#e74c3c" }}>⚠️ 과제 독려 대상 ({reminderTargets.length}명)</h3>
            {autoTargets.length > 0 && (
              <button className="btn" style={{ background: "#e74c3c", fontSize: 13, padding: "6px 14px" }}
                onClick={sendAllAuto} disabled={sending === "__all__"}>
                {sending === "__all__" ? "발송 중…" : `전체 자동 발송 (${autoTargets.length}명)`}
              </button>
            )}
          </div>
          {notice && <p style={{ color: "#27ae60", fontSize: 13, marginBottom: 8 }}>{notice}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>등급</th>
                  <th>시수</th>
                  <th>학교</th>
                  <th>경과일</th>
                  <th>마지막 제출</th>
                  <th>미제출 과제</th>
                  <th>발송</th>
                </tr>
              </thead>
              <tbody>
                {[...autoTargets, ...otherTargets].map((s) => (
                  <tr key={s.studentCode}>
                    <td style={{ fontWeight: 700 }}>{s.name}</td>
                    <td>
                      {s.studentType && (
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                          background: s.studentType === "W1" ? "#fdecea" : s.studentType === "W2" ? "#fff3e0" : "#f3e8ff",
                          color: s.studentType === "W1" ? "#e74c3c" : s.studentType === "W2" ? "#e67e22" : "#9b59b6" }}>
                          {s.studentType}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>{s.weeklySession ? `${s.weeklySession}회` : "-"}</td>
                    <td>{s.school}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: s.days >= s.threshold * 2 ? "#e74c3c" : "#f39c12",
                        background: s.days >= s.threshold * 2 ? "#fdecea" : "#fef9e7",
                        padding: "2px 8px", borderRadius: 6, fontSize: 13 }}>
                        {s.neverSubmitted ? "미제출" : `D+${s.days}`}
                      </span>
                      <span style={{ fontSize: 11, color: "#aaa", marginLeft: 4 }}>(기한:{s.threshold}일)</span>
                    </td>
                    <td style={{ fontSize: 12, color: "#888" }}>
                      {s.lastDate ? new Date(s.lastDate).toLocaleDateString("ko-KR") : "한 번도 미제출"}
                    </td>
                    <td style={{ fontSize: 12, color: s.unsubmitted.length > 0 ? "#e74c3c" : "#27ae60" }}>
                      {s.unsubmitted.length > 0 ? s.unsubmitted.map((t) => t.name).join(", ") : "전체 제출"}
                    </td>
                    <td>
                      {(s.weeklySession === 1 || s.weeklySession === 2) ? (
                        <button onClick={() => sendReminder(s)} disabled={sending === s.studentCode}
                          style={{ padding: "3px 10px", fontSize: 12, borderRadius: 6, background: "#e74c3c", color: "#fff", border: "none", cursor: "pointer" }}>
                          {sending === s.studentCode ? "발송중…" : "독려 발송"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "#aaa" }}>수동 확인</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
            * 1회/주: 5일 초과 · 2회/주: 2일 초과 시 독려 · 미제출 과제 자동 표시
          </p>
        </>
      )}
    </div>
  );
}


// ── 수업 이력 관리 컴포넌트 ─────────────────────────
function ClassSessionManager({ entry, roster, setRoster, rosterStore }: {
  entry: RosterEntry;
  roster: RosterEntry[];
  setRoster: (r: RosterEntry[]) => void;
  rosterStore: ReturnType<typeof createRosterStore>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newStatus, setNewStatus] = useState<"cancelled" | "absent" | "makeup">("cancelled");
  const [makeupDate, setMakeupDate] = useState("");

  const sessions = entry.classSessions ?? [];

  async function addSession() {
    const session: import("../../core/roster").ClassSession = {
      date: newDate,
      status: newStatus,
      makeupDate: makeupDate || undefined,
      makeupDone: false,
    };
    const updated = roster.map((r) =>
      r.studentCode === entry.studentCode
        ? { ...r, classSessions: [...(r.classSessions ?? []), session].sort((a, b) => b.date.localeCompare(a.date)) }
        : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
    setAdding(false);
    setMakeupDate("");
  }

  async function toggleMakeupDone(sessionDate: string) {
    const updated = roster.map((r) =>
      r.studentCode === entry.studentCode
        ? { ...r, classSessions: (r.classSessions ?? []).map((s) =>
            s.date === sessionDate ? { ...s, makeupDone: !s.makeupDone } : s) }
        : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
  }

  async function deleteSession(sessionDate: string) {
    const updated = roster.map((r) =>
      r.studentCode === entry.studentCode
        ? { ...r, classSessions: (r.classSessions ?? []).filter((s) => s.date !== sessionDate) }
        : r
    );
    setRoster(updated);
    await rosterStore.saveRoster(updated);
  }

  const statusLabel: Record<string, string> = { normal: "정상", cancelled: "휴강", absent: "결강", makeup: "보충" };
  const statusColor: Record<string, string> = { normal: "#27ae60", cancelled: "#f39c12", absent: "#e74c3c", makeup: "#2980b9" };

  return (
    <div style={{ minWidth: 120 }}>
      {sessions.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {sessions.slice(0, 2).map((s) => (
            <div key={s.date} style={{ fontSize: 11, marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: statusColor[s.status] ?? "#333", fontWeight: 700 }}>{statusLabel[s.status]}</span>
              <span style={{ color: "#888" }}>{s.date.slice(5)}</span>
              {s.status === "cancelled" && s.makeupDate && (
                <span style={{ color: s.makeupDone ? "#27ae60" : "#e74c3c", fontSize: 10 }}>
                  {s.makeupDone ? "✅보충완" : `보충${s.makeupDate.slice(5)}`}
                </span>
              )}
            </div>
          ))}
          {sessions.length > 2 && <span style={{ fontSize: 11, color: "#aaa" }}>+{sessions.length - 2}건</span>}
        </div>
      )}
      <button onClick={() => setOpen(!open)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #ddd", cursor: "pointer", background: "#f9f9f9" }}>
        {open ? "닫기" : sessions.length > 0 ? "수정" : "+ 추가"}
      </button>

      {open && (
        <div style={{ position: "absolute", zIndex: 100, background: "#fff", border: "2px solid #2980b9", borderRadius: 10, padding: 12, minWidth: 260, boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13 }}>{entry.name} — 수업 이력</p>

          {sessions.map((s) => (
            <div key={s.date} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: statusColor[s.status], fontWeight: 700, minWidth: 28 }}>{statusLabel[s.status]}</span>
              <span style={{ color: "#666" }}>{s.date}</span>
              {s.makeupDate && (
                <span style={{ color: "#888" }}>→ {s.makeupDate}</span>
              )}
              {s.makeupDate && (
                <button onClick={() => toggleMakeupDone(s.date)} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, border: "1px solid #ddd", cursor: "pointer", background: s.makeupDone ? "#e8f8f5" : "#fef9e7" }}>
                  {s.makeupDone ? "✅완료" : "미완"}
                </button>
              )}
              <button onClick={() => deleteSession(s.date)} style={{ marginLeft: "auto", fontSize: 10, padding: "1px 5px", borderRadius: 3, border: "1px solid #e74c3c", color: "#e74c3c", cursor: "pointer", background: "#fff" }}>삭제</button>
            </div>
          ))}

          {!adding ? (
            <button onClick={() => setAdding(true)} style={{ width: "100%", padding: "6px", fontSize: 12, borderRadius: 6, border: "1px dashed #2980b9", cursor: "pointer", background: "#eaf4fb", color: "#2980b9", marginTop: 8 }}>
              + 새 이력 추가
            </button>
          ) : (
            <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #ddd" }} />
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as any)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #ddd" }}>
                  <option value="cancelled">휴강</option>
                  <option value="absent">결강</option>
                  <option value="makeup">보충</option>
                </select>
              </div>
              {newStatus === "cancelled" && (
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: "#888" }}>보충 날짜 (선택)</label>
                  <input type="date" value={makeupDate} onChange={(e) => setMakeupDate(e.target.value)} style={{ width: "100%", fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid #ddd", marginTop: 2 }} />
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={addSession} style={{ flex: 1, padding: "5px", fontSize: 12, borderRadius: 5, border: "none", background: "#2980b9", color: "#fff", cursor: "pointer" }}>저장</button>
                <button onClick={() => setAdding(false)} style={{ flex: 1, padding: "5px", fontSize: 12, borderRadius: 5, border: "1px solid #ddd", cursor: "pointer" }}>취소</button>
              </div>
            </div>
          )}
          <button onClick={() => setOpen(false)} style={{ width: "100%", marginTop: 8, padding: "4px", fontSize: 11, borderRadius: 5, border: "1px solid #ddd", cursor: "pointer", color: "#888" }}>닫기</button>
        </div>
      )}
    </div>
  );
}

function PendingManager() {
  const pendingStore = useMemo(() => createPendingStore(), []);
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [pending, setPending] = useState<PendingRegistration[]>([]);
  const [notice, setNotice] = useState("");
  const [busyPhone, setBusyPhone] = useState<string | null>(null);

  async function refresh() {
    setPending(await pendingStore.listPending());
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStore]);

  async function approve(p: PendingRegistration) {
    setBusyPhone(p.phone);
    setNotice("");
    try {
      const existing = await rosterStore.listRoster();
      const code = generateStudentCode(existing.map((e) => e.studentCode));
      const entry = await pendingStore.approve(p.phone, code);
      if (entry) {
        await rosterStore.saveRoster([{ ...entry, registeredAt: new Date().toISOString() }]);
        // 승인 즉시 학생코드를 문자로 안내 (실패해도 승인 자체는 유지)
        try {
          const provider = createSmsProvider();
          await provider.send(
            entry.phone,
            `[L16] 등록이 승인되었습니다. 학생코드는 ${entry.studentCode} 입니다.`,
          );
          setNotice(`${p.name} 승인 완료 (코드: ${code}) — 문자로 안내했습니다.`);
        } catch {
          setNotice(`${p.name} 승인 완료 (코드: ${code}) — 문자 발송은 실패했습니다.`);
        }
      }
    } finally {
      setBusyPhone(null);
      refresh();
    }
  }

  async function reject(p: PendingRegistration) {
    if (!confirm(`${p.name} (${p.phone}) 신청을 거부할까요?`)) return;
    setBusyPhone(p.phone);
    await pendingStore.reject(p.phone);
    setBusyPhone(null);
    setNotice(`${p.name} 신청을 거부했습니다.`);
    refresh();
  }

  return (
    <div className="card">
      <h2>등록 신청</h2>
      <p className="sub">
        명부에 없는 번호로 학생이 직접 등록을 신청하면 여기에 표시됩니다. 승인하면 학생코드가
        자동 생성되어 명부에 등록되고, 문자로 코드가 안내됩니다.
      </p>
      {notice && <p className="muted">{notice}</p>}
      {pending.length === 0 ? (
        <p className="muted">대기 중인 신청이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>학교</th>
                <th>학년</th>
                <th>전화번호</th>
                <th>신청시각</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.phone}>
                  <td>{p.name}</td>
                  <td>{p.school}</td>
                  <td>{p.grade}</td>
                  <td>{p.phone}</td>
                  <td style={{ fontSize: 12 }}>
                    {new Date(p.requestedAt).toLocaleString("ko-KR")}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn ghost"
                        style={{ padding: "4px 8px", fontSize: 12 }}
                        onClick={() => approve(p)}
                        disabled={busyPhone === p.phone}
                      >
                        승인
                      </button>
                      <button
                        className="btn ghost"
                        style={{ padding: "4px 8px", fontSize: 12 }}
                        onClick={() => reject(p)}
                        disabled={busyPhone === p.phone}
                      >
                        거부
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

function AssignmentManager() {
  const assignmentStore = useMemo(() => createAssignmentStore(), []);
  const rosterStore = useMemo(() => createRosterStore(), []);
  const warningStore = useMemo(() => createWarningStore(), []);
  const examCheckStore = useMemo(() => createExamCheckStore(), []);
  const [types, setTypes] = useState<AssignmentType[]>([]);
  const [submissions, setSubmissions] = useState<
    Awaited<ReturnType<typeof assignmentStore.listSubmissions>>
  >([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [warnings, setWarnings] = useState<WarningRecord[]>([]);
  const [examChecks, setExamChecks] = useState<ExamCheckRecord[]>([]);
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("5");
  const [newKind, setNewKind] = useState<"mock_exam" | "general">("general");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newScopeLabel, setNewScopeLabel] = useState("");
  const [newCompletedLabel, setNewCompletedLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editKind, setEditKind] = useState<"mock_exam" | "general">("general");
  const [editItemLabel, setEditItemLabel] = useState("");
  const [editScopeLabel, setEditScopeLabel] = useState("");
  const [editCompletedLabel, setEditCompletedLabel] = useState("");

  async function refresh() {
    const [t, s, r, w, e] = await Promise.all([
      assignmentStore.listTypes(),
      assignmentStore.listSubmissions(),
      rosterStore.listRoster(),
      warningStore.listAll(),
      examCheckStore.listAll(),
    ]);
    setTypes(t);
    setSubmissions(s);
    setRoster(r);
    setWarnings(w);
    setExamChecks(e);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentStore, rosterStore, warningStore, examCheckStore]);

  async function addType() {
    const errs = validateAssignmentTypeInput(
      { name: newName, targetCount: Number(newTarget) || 0 },
      types,
    );
    if (errs.length) return setErrors(errs);
    setErrors([]);
    await assignmentStore.saveType({
      id: crypto.randomUUID(),
      name: newName.trim(),
      targetCount: Number(newTarget),
      kind: newKind,
      itemLabel: newKind === "general" ? newItemLabel : undefined,
      scopeLabel: newKind === "general" ? newScopeLabel : undefined,
      completedLabel: newKind === "general" ? newCompletedLabel : undefined,
    });
    setNewName("");
    setNewTarget("5");
    setNewKind("general");
    setNewItemLabel("");
    setNewScopeLabel("");
    setNewCompletedLabel("");
    refresh();
  }

  function startEdit(t: AssignmentType) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditTarget(String(t.targetCount));
    setEditKind(isMockExamKind(t) ? "mock_exam" : "general");
    setEditItemLabel(t.itemLabel ?? "");
    setEditScopeLabel(t.scopeLabel ?? "");
    setEditCompletedLabel(t.completedLabel ?? "");
  }

  async function saveEdit(t: AssignmentType) {
    const errs = validateAssignmentTypeInput(
      { name: editName, targetCount: Number(editTarget) || 0 },
      types,
      t.id,
    );
    if (errs.length) return setErrors(errs);
    setErrors([]);
    const newTargetCount = Number(editTarget);

    // 지정 개수를 늘리는 경우("이월") — 계도기간이 아니면서 여전히 경고 상태인 학생의 누적 횟수를 갱신
    if (newTargetCount > t.targetCount) {
      const now = new Date();
      let updatedWarnings = warnings;
      for (const student of roster) {
        if (isInGracePeriod(student.registeredAt, now)) continue; // 계도기간 학생은 경고 대상 제외
        const count = countSubmissionsForType(submissions, student.studentCode, t.id);
        const status = computeAssignmentStatus(count, t.targetCount); // 변경 전 지정개수 기준으로 판단
        updatedWarnings = bumpWarningOnCarryOver(updatedWarnings, student.studentCode, t.id, status, now);
      }
      await warningStore.saveAll(updatedWarnings);
      setWarnings(updatedWarnings);
    }

    await assignmentStore.saveType({
      ...t,
      name: editName.trim(),
      targetCount: newTargetCount,
      kind: editKind,
      itemLabel: editKind === "general" ? editItemLabel : undefined,
      scopeLabel: editKind === "general" ? editScopeLabel : undefined,
      completedLabel: editKind === "general" ? editCompletedLabel : undefined,
    });
    setEditingId(null);
    refresh();
  }

  async function resetWarning(studentCode: string, typeId: string) {
    const updated = resetWarningCount(warnings, studentCode, typeId);
    await warningStore.saveAll(updated);
    setWarnings(updated);
  }

  async function removeType(id: string) {
    if (!confirm("이 과제 유형을 삭제할까요? 기존 제출 기록은 남아있지만 유형 이름은 사라집니다.")) return;
    await assignmentStore.deleteType(id);
    refresh();
  }

  return (
    <div className="card">
      <h2>과제 관리</h2>
      <p className="sub">
        과제 유형은 최대 {MAX_ASSIGNMENT_TYPES}개까지 만들 수 있습니다 ({types.length}/
        {MAX_ASSIGNMENT_TYPES}).
      </p>
      {notice && <p className="muted">{notice}</p>}
      {errors.length > 0 && (
        <div className="errors">
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>과제 유형</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>과제 이름</th>
              <th>지정 개수</th>
              <th>형식</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <Fragment key={t.id}>
              <tr>
                <td>
                  {editingId === t.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ padding: 6, fontSize: 13, width: 140 }}
                    />
                  ) : (
                    t.name
                  )}
                </td>
                <td>
                  {editingId === t.id ? (
                    <input
                      type="number"
                      value={editTarget}
                      onChange={(e) => setEditTarget(e.target.value)}
                      style={{ padding: 6, fontSize: 13, width: 60 }}
                    />
                  ) : (
                    `${t.targetCount}회`
                  )}
                </td>
                <td>
                  {editingId === t.id ? (
                    <div className="chips">
                      <div
                        className={"chip" + (editKind === "mock_exam" ? " on" : "")}
                        onClick={() => setEditKind("mock_exam")}
                        style={{ padding: "4px 10px", fontSize: 11 }}
                      >
                        모의고사형
                      </div>
                      <div
                        className={"chip" + (editKind === "general" ? " on" : "")}
                        onClick={() => setEditKind("general")}
                        style={{ padding: "4px 10px", fontSize: 11 }}
                      >
                        일반과제
                      </div>
                    </div>
                  ) : isMockExamKind(t) ? (
                    "모의고사형"
                  ) : (
                    "일반과제"
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    {editingId === t.id ? (
                      <>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => saveEdit(t)}
                        >
                          저장
                        </button>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => setEditingId(null)}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => startEdit(t)}
                        >
                          수정
                        </button>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => removeType(t.id)}
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {editingId === t.id && editKind === "general" && (
                <tr>
                  <td colSpan={4} style={{ background: "var(--paper)" }}>
                    <div style={{ padding: "8px 0" }}>
                      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                        학생 화면에 보일 필드 이름 (비워두면 기본값 사용)
                      </p>
                      <div className="row">
                        <div>
                          <label style={{ fontSize: 12 }}>필드1 (기본: 분야명)</label>
                          <input
                            value={editItemLabel}
                            onChange={(e) => setEditItemLabel(e.target.value)}
                            style={{ padding: 6, fontSize: 13 }}
                            placeholder="분야명"
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 12 }}>필드2 (기본: 학습내용)</label>
                          <input
                            value={editScopeLabel}
                            onChange={(e) => setEditScopeLabel(e.target.value)}
                            style={{ padding: 6, fontSize: 13 }}
                            placeholder="학습내용"
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 12 }}>필드3 (기본: 완수여부)</label>
                          <input
                            value={editCompletedLabel}
                            onChange={(e) => setEditCompletedLabel(e.target.value)}
                            style={{ padding: 6, fontSize: 13 }}
                            placeholder="완수여부"
                          />
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {types.length < MAX_ASSIGNMENT_TYPES && (
        <div style={{ marginTop: 14, border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
          <label>새 과제 이름</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 모의고사 풀이" />
          <label>지정 개수 (예: 3회)</label>
          <input
            type="number"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
          />
          <label>형식</label>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            모의고사형: 학생이 회차·점수·틀린문항을 직접 입력하고, 관리자가 켜두면 세부풀이시간도
            입력. 일반과제: 회차 자동 계산 + 관리자가 정한 필드 3개.
          </p>
          <div className="chips">
            <div
              className={"chip" + (newKind === "mock_exam" ? " on" : "")}
              onClick={() => setNewKind("mock_exam")}
            >
              모의고사형
            </div>
            <div
              className={"chip" + (newKind === "general" ? " on" : "")}
              onClick={() => setNewKind("general")}
            >
              일반과제
            </div>
          </div>

          {newKind === "general" && (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ fontSize: 12 }}>
                학생 화면에 보일 필드 이름을 정하세요 (비워두면 기본값 사용).
              </p>
              <label>필드1 이름 (기본: 분야명)</label>
              <input
                value={newItemLabel}
                onChange={(e) => setNewItemLabel(e.target.value)}
                placeholder="분야명"
              />
              <label>필드2 이름 (기본: 학습내용)</label>
              <input
                value={newScopeLabel}
                onChange={(e) => setNewScopeLabel(e.target.value)}
                placeholder="학습내용"
              />
              <label>필드3 이름 (기본: 완수여부)</label>
              <input
                value={newCompletedLabel}
                onChange={(e) => setNewCompletedLabel(e.target.value)}
                placeholder="완수여부"
              />
            </div>
          )}

          <div style={{ height: 10 }} />
          <button className="btn" onClick={addType}>
            과제 유형 추가
          </button>
        </div>
      )}

      <MockExamTimingSettings />

      <h3>학생별 과제 현황</h3>
      {roster.length === 0 ? (
        <p className="muted">등록된 학생이 없습니다.</p>
      ) : types.length === 0 ? (
        <p className="muted">과제 유형을 먼저 추가하세요.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>학생</th>
                {types.map((t) => (
                  <th key={t.id}>{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((student) => (
                <tr key={student.studentCode}>
                  <td>{student.name}</td>
                  {types.map((t) => {
                    const count = countSubmissionsForType(submissions, student.studentCode, t.id);
                    const status = computeAssignmentStatus(count, t.targetCount);
                    const inGrace = isInGracePeriod(student.registeredAt, new Date());
                    const color =
                      inGrace
                        ? "var(--mark)"
                        : status === "good"
                          ? "var(--correct)"
                          : status === "not_bad"
                            ? "var(--amber)"
                            : status === "warning"
                              ? "var(--incorrect)"
                              : "var(--ink-faint)";
                    const warningRec = warnings.find(
                      (w) => w.studentCode === student.studentCode && w.typeId === t.id,
                    );
                    const isNew = warningRec && isRecentWarning(warningRec.lastWarnedAt, new Date());
                    return (
                      <td key={t.id}>
                        <div style={{ color, fontWeight: 700 }}>
                          {inGrace
                            ? `계도기간 D-${gracePeriodDaysRemaining(student.registeredAt, new Date())} (${count}/${t.targetCount})`
                            : `${ASSIGNMENT_STATUS_LABELS[status]} (${count}/${t.targetCount})`}
                        </div>
                        {warningRec && warningRec.count > 0 && (
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: "var(--incorrect)" }}>
                              누적경고 {warningRec.count}회{isNew ? " 🆕" : ""}
                            </span>
                            <button
                              className="btn ghost"
                              style={{ padding: "2px 6px", fontSize: 10 }}
                              onClick={() => resetWarning(student.studentCode, t.id)}
                            >
                              초기화
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>모의고사 성적 접수 확인 이력</h3>
      {examChecks.length === 0 ? (
        <p className="muted">아직 확인된 응답이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>학생</th>
                <th>응답</th>
                <th>응답시각</th>
              </tr>
            </thead>
            <tbody>
              {examChecks.slice(0, 50).map((c) => (
                <tr key={c.id}>
                  <td>{c.studentName}</td>
                  <td>{EXAM_CHECK_ANSWER_LABELS[c.answer]}</td>
                  <td style={{ fontSize: 12 }}>{new Date(c.answeredAt).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MockExamTimingSettings() {
  const store = useMemo(() => createMockExamTimingStore(), []);
  const [config, setConfig] = useState<MockExamTimingConfig>(DEFAULT_MOCK_EXAM_TIMING_CONFIG);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    store
      .getConfig()
      .then(setConfig)
      .catch((e) =>
        setNotice(`설정 불러오기 실패: ${(e as Error).message} — Supabase에 mock_exam_timing_config 테이블이 있는지 확인하세요.`),
      );
  }, [store]);

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      await store.saveConfig(config);
      setNotice("저장되었습니다.");
    } catch (e) {
      setNotice(`저장 실패: ${(e as Error).message} — Supabase에 mock_exam_timing_config 테이블이 있는지 확인하세요.`);
    } finally {
      setSaving(false);
    }
  }

  function updateStep(step: "step1" | "step2" | "step3", field: "label" | "range" | "targetMinutes", value: string) {
    setConfig((c) => ({
      ...c,
      [step]: {
        ...c[step],
        [field]: field === "targetMinutes" ? Number(value) || 0 : value,
      },
    }));
  }

  return (
    <div style={{ marginTop: 20, border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
      <h3 style={{ marginTop: 0 }}>모의고사 세부풀이시간</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        켜두면 "모의고사형"으로 지정된 과제 제출 시, 학생이 전체·단계별 소요시간을 입력할 수
        있고 목표시간과 비교한 결과를 바로 보여줍니다.
      </p>
      {notice && <p className="muted">{notice}</p>}

      <label>세부내용 첨부</label>
      <div className="chips">
        <div
          className={"chip" + (config.enabled ? " on" : "")}
          onClick={() => setConfig((c) => ({ ...c, enabled: true }))}
        >
          Yes
        </div>
        <div
          className={"chip" + (!config.enabled ? " on" : "")}
          onClick={() => setConfig((c) => ({ ...c, enabled: false }))}
        >
          No
        </div>
      </div>

      {(["step1", "step2", "step3"] as const).map((step) => (
        <div key={step} style={{ marginTop: 14 }}>
          <label>{step.toUpperCase()} 이름</label>
          <input
            value={config[step].label}
            onChange={(e) => updateStep(step, "label", e.target.value)}
          />
          <div className="row">
            <div>
              <label>문항 범위</label>
              <input
                value={config[step].range}
                onChange={(e) => updateStep(step, "range", e.target.value)}
                placeholder="예: 18~28번"
              />
            </div>
            <div>
              <label>목표 시간(분)</label>
              <input
                type="number"
                value={config[step].targetMinutes}
                onChange={(e) => updateStep(step, "targetMinutes", e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}

      <div style={{ height: 12 }} />
      <button className="btn" onClick={save} disabled={saving}>
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}

function AssignmentReviewManager() {
  const assignmentStore = useMemo(() => createAssignmentStore(), []);
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [submissions, setSubmissions] = useState<
    Awaited<ReturnType<typeof assignmentStore.listSubmissions>>
  >([]);
  const [types, setTypes] = useState<AssignmentType[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  async function refresh() {
    const [s, t, r] = await Promise.all([
      assignmentStore.listSubmissions(),
      assignmentStore.listTypes(),
      rosterStore.listRoster(),
    ]);
    setSubmissions(s);
    setTypes(t);
    setRoster(r);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentStore, rosterStore]);

  const visible = showAll ? submissions : submissions.filter(isPendingReview);

  async function judge(submissionId: string, status: "pass" | "fail") {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    const student = roster.find((r) => r.studentCode === sub.studentCode);
    const type = types.find((t) => t.id === sub.typeId);
    setBusyId(submissionId);
    setNotice("");

    await assignmentStore.updateSubmission(submissionId, {
      reviewStatus: status,
      reviewedAt: new Date().toISOString(),
      reviewNote: noteDrafts[submissionId] ?? "",
    });

    if (student) {
      const verdict = REVIEW_STATUS_LABELS[status];
      const note = noteDrafts[submissionId]?.trim();
      const message =
        `[L16] ${student.name} 학생, "${type?.name ?? "과제"}" ${sub.round}회차 점검 결과: ${verdict}` +
        (note ? ` (${note})` : "");
      try {
        await createSmsProvider().send(student.phone, message);
        setNotice(`${student.name} 학생에게 결과를 문자로 안내했습니다.`);
      } catch (e) {
        setNotice(`판정은 저장됐지만 문자 발송에 실패했습니다: ${(e as Error).message}`);
      }
    }

    setBusyId(null);
    refresh();
  }

  function renderContent(sub: AssignmentSubmission) {
    const type = types.find((t) => t.id === sub.typeId);
    if (!type) return "-";
    if (isMockExamKind(type)) {
      const parts = [`점수 ${sub.score ?? "-"}`];
      if (sub.wrongNumbers?.length) parts.push(`틀림 ${sub.wrongNumbers.join(",")}`);
      return parts.join(" · ");
    }
    const labels = getGeneralFieldLabels(type);
    return `${labels.itemLabel}: ${sub.item ?? "-"} · ${labels.scopeLabel}: ${sub.scope ?? "-"} · ${labels.completedLabel}: ${sub.completed ? "완료" : "미완료"}`;
  }

  return (
    <div className="card">
      <h2>과제 점검</h2>
      <p className="sub">
        학생이 제출한 과제를 확인하고 승인/재제출 판정을 내리면, 그 결과가 학생에게 문자로
        자동 발송됩니다.
      </p>
      {notice && <p className="muted">{notice}</p>}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button className={showAll ? "btn secondary" : "btn"} onClick={() => setShowAll(false)}>
          점검 대기만 보기
        </button>
        <button className={showAll ? "btn" : "btn secondary"} onClick={() => setShowAll(true)}>
          전체 보기
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="muted">
          {showAll ? "제출된 과제가 없습니다." : "점검 대기 중인 과제가 없습니다."}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>학생</th>
                <th>과제</th>
                <th>회차</th>
                <th>제출일</th>
                <th>내용</th>
                <th>상태</th>
                <th>메모</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((sub) => {
                const student = roster.find((r) => r.studentCode === sub.studentCode);
                const type = types.find((t) => t.id === sub.typeId);
                const status = sub.reviewStatus ?? "pending";
                return (
                  <tr key={sub.id}>
                    <td>{student?.name ?? sub.studentCode}</td>
                    <td>{type?.name ?? "-"}</td>
                    <td>{sub.round}</td>
                    <td style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>
                      {new Date(sub.submittedAt).toLocaleDateString("ko-KR")}
                    </td>
                    <td style={{ fontSize: 12 }}>{renderContent(sub)}</td>
                    <td
                      style={{
                        fontWeight: 700,
                        color:
                          status === "pass"
                            ? "var(--correct)"
                            : status === "fail"
                              ? "var(--incorrect)"
                              : "var(--ink-faint)",
                      }}
                    >
                      {REVIEW_STATUS_LABELS[status]}
                    </td>
                    <td>
                      <input
                        value={noteDrafts[sub.id] ?? sub.reviewNote ?? ""}
                        onChange={(e) =>
                          setNoteDrafts((d) => ({ ...d, [sub.id]: e.target.value }))
                        }
                        placeholder="선택 메모"
                        style={{ padding: 6, fontSize: 12, width: 120 }}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => judge(sub.id, "pass")}
                          disabled={busyId === sub.id}
                        >
                          승인
                        </button>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => judge(sub.id, "fail")}
                          disabled={busyId === sub.id}
                        >
                          재제출요청
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GracePeriodNotifier({ roster }: { roster: RosterEntry[] }) {
  const now = useMemo(() => new Date(), []);
  const storage = useStorage();
  const assignmentStore = useMemo(() => createAssignmentStore(), []);
  const [examRows, setExamRows] = useState<ExamResult[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);

  useEffect(() => {
    Promise.all([storage.listResults(), assignmentStore.listSubmissions()])
      .then(([exams, subs]) => { setExamRows(exams); setSubmissions(subs); });
  }, [storage, assignmentStore]);

  // 한 번이라도 제출한 학생 코드 + 이름 모두 체크
  const submittedCodes = useMemo(() => {
    const set = new Set<string>();
    examRows.forEach((r) => {
      set.add(r.student.studentCode);
      set.add(r.student.name); // 이름으로도 매칭
    });
    submissions.forEach((s) => {
      set.add(s.studentCode);
      // 이름 매칭을 위해 roster에서 찾기
      const rosterEntry = roster.find((r) => r.studentCode === s.studentCode);
      if (rosterEntry) set.add(rosterEntry.name);
    });
    return set;
  }, [examRows, submissions, roster]);

  // 계도기간이면서 아직 한 번도 제출 안 한 학생만
  const inGrace = useMemo(
    () => roster.filter((r) =>
      isInGracePeriod(r.registeredAt, now) &&
      !submittedCodes.has(r.studentCode) &&
      !submittedCodes.has(r.name)
    ),
    [roster, now, submittedCodes],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(
    "[L16] 안내: 신규 등록 후 계도기간입니다. 과제를 완료해 주세요.",
  );
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function sendToSelected() {
    if (selected.size === 0) return;
    setSending(true);
    setNotice("");
    const provider = createSmsProvider();
    let successCount = 0;
    for (const code of selected) {
      const student = roster.find((r) => r.studentCode === code);
      if (!student) continue;
      try {
        await provider.send(student.phone, message.replace("{이름}", student.name));
        successCount++;
      } catch {
        // 개별 발송 실패는 넘어가고 계속 진행
      }
    }
    setSending(false);
    setNotice(`${successCount}/${selected.size}명에게 문자를 발송했습니다.`);
    setSelected(new Set());
  }

  if (inGrace.length === 0) {
    return (
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>계도기간 학생 안내문자</h3>
        <p className="muted">현재 계도기간(신규등록 후 2주) 중인 학생이 없습니다.</p>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
      <h3 style={{ marginTop: 0 }}>계도기간 학생 안내문자</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        신규 등록 후 2주 이내인 학생 목록입니다. 안내가 필요한 학생만 선택해서 문자를 보낼 수
        있습니다. 메시지의 "{"{이름}"}"은 학생 이름으로 자동 치환됩니다.
      </p>
      {notice && <p className="muted">{notice}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>이름</th>
              <th>학교</th>
              <th>남은 계도기간</th>
            </tr>
          </thead>
          <tbody>
            {inGrace.map((s) => (
              <tr key={s.studentCode}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(s.studentCode)}
                    onChange={() => toggle(s.studentCode)}
                  />
                </td>
                <td>{s.name}</td>
                <td>{s.school}</td>
                <td>D-{gracePeriodDaysRemaining(s.registeredAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ height: 10 }} />
      <label>안내 메시지</label>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn" onClick={sendToSelected} disabled={sending || selected.size === 0}>
        {sending ? "발송 중…" : `선택한 ${selected.size}명에게 문자 발송`}
      </button>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function TeacherLogManager() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const logStore = useMemo(() => createTeacherLogStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [studentCode, setStudentCode] = useState("");
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<TeacherLogRow[]>(createEmptyRows());
  const [examRecords, setExamRecords] = useState<ExamScoreRecord[]>([]);
  const [notes, setNotes] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [classContent, setClassContent] = useState("");
  const [pastDates, setPastDates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
  }, [rosterStore]);

  async function loadForStudentAndDate(code: string, d: string) {
    if (!code) return;
    const existing = await logStore.getLog(code, d);
    if (existing) {
      setRows(existing.rows);
      setExamRecords(existing.examRecords);
      setNotes(existing.notes);
      setNextPlan(existing.nextPlan);
      setClassContent(existing.classContent);
    } else {
      setRows(createEmptyRows());
      setExamRecords([]);
      setNotes("");
      setNextPlan("");
      setClassContent("");
    }
    const logs = await logStore.listLogsForStudent(code);
    setPastDates(logs.map((l) => l.date));
  }

  function selectStudent(code: string) {
    setStudentCode(code);
    loadForStudentAndDate(code, date);
  }

  function selectDate(d: string) {
    setDate(d);
    loadForStudentAndDate(studentCode, d);
  }

  function updateRow(no: number, field: keyof TeacherLogRow, value: string) {
    setRows((prev) => prev.map((r) => (r.no === no ? { ...r, [field]: value } : r)));
  }

  function addExamRecord() {
    setExamRecords((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: "",
        mission: null,
        myScore: null,
        lc: null,
        st1: null,
        st2: null,
        st3: null,
        wrongNumbers: "",
      },
    ]);
  }

  function updateExamRecord(id: string, field: keyof ExamScoreRecord, value: string) {
    setExamRecords((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              [field]: ["mission", "myScore", "lc", "st1", "st2", "st3"].includes(field)
                ? value === ""
                  ? null
                  : Number(value)
                : value,
            }
          : e,
      ),
    );
  }

  function removeExamRecord(id: string) {
    setExamRecords((prev) => prev.filter((e) => e.id !== id));
  }

  async function save() {
    if (!studentCode) return setNotice("학생을 먼저 선택하세요.");
    setSaving(true);
    try {
      const log = {
        id: makeLogId(studentCode, date),
        studentCode,
        date,
        rows,
        examRecords,
        notes,
        nextPlan,
        classContent,
      };
      await logStore.saveLog(log);

      // lastAssignmentSavedAt 갱신 (실패해도 저장은 완료)
      try {
        const updatedRoster = roster.map((r) =>
          r.studentCode === studentCode
            ? { ...r, lastAssignmentSavedAt: new Date().toISOString() }
            : r
        );
        setRoster(updatedRoster);
        await rosterStore.saveRoster(updatedRoster);
      } catch (e2) {
        console.warn("lastAssignmentSavedAt 갱신 실패:", e2);
      }

      setNotice("저장되었습니다.");
      const logs = await logStore.listLogsForStudent(studentCode);
      setPastDates(logs.map((l) => l.date));
    } catch (e) {
      setNotice(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const student = roster.find((r) => r.studentCode === studentCode);

  return (
    <div className="card">
      <h2>학생별 과제입력</h2>
      <p className="sub">
        선생님만 보는 개인 관리용 표입니다 — 학생 화면과는 무관하고, 여기 입력한 내용은 학생에게
        보이지 않습니다.
      </p>
      {notice && <p className="muted">{notice}</p>}

      <div className="row">
        <div>
          <label>학생 선택</label>
          <select value={studentCode} onChange={(e) => selectStudent(e.target.value)}>
            <option value="">선택하세요</option>
            {roster.map((r) => (
              <option key={r.studentCode} value={r.studentCode}>
                {r.name} ({r.school})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>날짜</label>
          <input type="date" value={date} onChange={(e) => selectDate(e.target.value)} />
        </div>
      </div>

      {studentCode && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            {student?.name} · {date} ({getDayOfWeek(date)})
          </p>

          {pastDates.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12 }}>지난 기록 바로가기</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {pastDates.map((d) => (
                  <button
                    key={d}
                    className={d === date ? "btn ghost" : "btn secondary"}
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => selectDate(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>번호</th>
                  <th>교재</th>
                  <th>교재 세부</th>
                  <th>범위</th>
                  <th>수행</th>
                  <th>틀린문항</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.no}>
                    <td>{row.no}</td>
                    <td>
                      <input
                        value={row.material}
                        onChange={(e) => updateRow(row.no, "material", e.target.value)}
                        style={{ padding: 6, fontSize: 12, width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.materialDetail}
                        onChange={(e) => updateRow(row.no, "materialDetail", e.target.value)}
                        style={{ padding: 6, fontSize: 12, width: 130 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.scope}
                        onChange={(e) => updateRow(row.no, "scope", e.target.value)}
                        style={{ padding: 6, fontSize: 12, width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.completion}
                        onChange={(e) => updateRow(row.no, "completion", e.target.value)}
                        style={{ padding: 6, fontSize: 12, width: 80 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.wrongNumbers}
                        onChange={(e) => updateRow(row.no, "wrongNumbers", e.target.value)}
                        style={{ padding: 6, fontSize: 12, width: 130 }}
                        placeholder="예: 24,30,32"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ height: 16 }} />
          <h3>모의고사 성적 기록</h3>
          {examRecords.map((ex) => (
            <div
              key={ex.id}
              style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginBottom: 8 }}
            >
              <div className="row">
                <div>
                  <label style={{ fontSize: 12 }}>라벨 (예: 22년 7월)</label>
                  <input
                    value={ex.label}
                    onChange={(e) => updateExamRecord(ex.id, "label", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>Mission</label>
                  <input
                    type="number"
                    value={ex.mission ?? ""}
                    onChange={(e) => updateExamRecord(ex.id, "mission", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>My Score</label>
                  <input
                    type="number"
                    value={ex.myScore ?? ""}
                    onChange={(e) => updateExamRecord(ex.id, "myScore", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>L/C</label>
                  <input
                    type="number"
                    value={ex.lc ?? ""}
                    onChange={(e) => updateExamRecord(ex.id, "lc", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label style={{ fontSize: 12 }}>st(1)</label>
                  <input
                    type="number"
                    value={ex.st1 ?? ""}
                    onChange={(e) => updateExamRecord(ex.id, "st1", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>st(2)</label>
                  <input
                    type="number"
                    value={ex.st2 ?? ""}
                    onChange={(e) => updateExamRecord(ex.id, "st2", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>st(3)</label>
                  <input
                    type="number"
                    value={ex.st3 ?? ""}
                    onChange={(e) => updateExamRecord(ex.id, "st3", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>틀린문항</label>
                  <input
                    value={ex.wrongNumbers}
                    onChange={(e) => updateExamRecord(ex.id, "wrongNumbers", e.target.value)}
                    style={{ padding: 6, fontSize: 12 }}
                    placeholder="예: 29,30,31"
                  />
                </div>
              </div>
              <button
                className="btn ghost"
                style={{ padding: "4px 8px", fontSize: 11, marginTop: 6 }}
                onClick={() => removeExamRecord(ex.id)}
              >
                이 기록 삭제
              </button>
            </div>
          ))}
          <button className="btn secondary" onClick={addExamRecord}>
            + 모의고사 성적 기록 추가
          </button>

          <div style={{ height: 16 }} />
          <label>처리 (비고)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label>다음계획</label>
          <textarea value={nextPlan} onChange={(e) => setNextPlan(e.target.value)} />
          <label>수업내용</label>
          <textarea value={classContent} onChange={(e) => setClassContent(e.target.value)} />

          <div style={{ height: 14 }} />
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 제출 현황 탭
// ═══════════════════════════════════════════════════


// ═══════════════════════════════════════════════════
// 제출 현황 탭
// ═══════════════════════════════════════════════════

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

function dayBadge(days: number) {
  const color = days === 0 ? "#2ecc71" : days <= 3 ? "#f39c12" : "#e74c3c";
  return (
    <span style={{
      fontWeight: "bold", color,
      background: color + "22",
      borderRadius: 6, padding: "2px 10px", fontSize: 13,
    }}>
      D+{days}
    </span>
  );
}

function SubmissionStatus({ rows: initialRows }: { rows: ExamResult[] }) {
  const storage = useStorage();
  const rosterStore = useMemo(() => createRosterStore(), []);
  const assignmentStore = useMemo(() => createAssignmentStore(), []);

  const [rows, setRows] = useState<ExamResult[]>(initialRows);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      storage.listResults(),
      rosterStore.listRoster(),
      assignmentStore.listSubmissions(),
    ]).then(([results, r, subs]) => {
      setRows(results);
      setRoster(r);
      setSubmissions(subs);
      setLoading(false);
    });
  }, [storage, rosterStore, assignmentStore]);

  // 제출한 학생 코드 집합 — 모의고사 + 일반과제 모두 포함
  const allSubmittedCodes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { set.add(r.student.studentCode); set.add(r.student.name); });
    submissions.forEach((s) => {
      set.add(s.studentCode);
      const entry = roster.find((r) => r.studentCode === s.studentCode);
      if (entry) set.add(entry.name);
    });
    return set;
  }, [rows, submissions, roster]);

  // 학생별 마지막 제출일 집계 (모의고사 기준)
  const submittedMap = useMemo(() => {
    const map = new Map<string, {
      name: string; school: string; grade: string; lastDate: string; count: number;
    }>();
    for (const r of rows) {
      const prev = map.get(r.student.studentCode);
      if (!prev || r.submittedAt > prev.lastDate) {
        map.set(r.student.studentCode, {
          name: r.student.name,
          school: r.student.school,
          grade: r.student.grade,
          lastDate: r.submittedAt,
          count: (prev?.count ?? 0) + 1,
        });
      } else {
        map.set(r.student.studentCode, { ...prev, count: prev.count + 1 });
      }
    }
    return map;
  }, [rows]);

  const submitted = useMemo(() =>
    Array.from(submittedMap.entries())
      .map(([code, v]) => ({ code, ...v, days: daysSince(v.lastDate) }))
      .sort((a, b) => b.days - a.days),
    [submittedMap]);

  // 미제출 학생: 모의고사도 일반과제도 한 번도 제출 안 한 학생
  const notSubmitted = useMemo(() =>
    roster.filter((r) =>
      !allSubmittedCodes.has(r.studentCode) && !allSubmittedCodes.has(r.name)
    ),
    [roster, allSubmittedCodes]);

  // CSV 다운로드
  function exportSubmittedCSV() {
    const header = "이름,학생코드,학교,학년,경과일(D+),마지막제출일,총제출횟수";
    const body = submitted.map((s) =>
      `${s.name},${s.code},${s.school},${s.grade},${s.days},${new Date(s.lastDate).toLocaleDateString("ko-KR")},${s.count}`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `제출현황_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportNotSubmittedCSV() {
    const header = "이름,학생코드,학교,학년,선생님,비고";
    const body = notSubmitted.map((s) =>
      `${s.name},${s.studentCode},${s.school},${s.grade},${s.teacher},${s.note}`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `미제출학생_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="card"><p className="muted center">불러오는 중…</p></div>;

  return (
    <div className="card">

      {/* ── 섹션 1: 제출 학생 경과일 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>✅ 제출 학생 경과일 ({submitted.length}명)</h2>
        <button className="btn" style={{ padding: "4px 12px", fontSize: 13 }}
          onClick={exportSubmittedCSV} disabled={submitted.length === 0}>
          CSV 저장
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        마지막 제출 후 경과일 &nbsp;·&nbsp;
        <span style={{ color: "#2ecc71" }}>●</span> 당일 &nbsp;
        <span style={{ color: "#f39c12" }}>●</span> 3일 이내 &nbsp;
        <span style={{ color: "#e74c3c" }}>●</span> 4일 이상
      </p>
      {submitted.length === 0 ? (
        <p className="muted center">제출된 데이터가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>경과일</th>
                <th>이름</th>
                <th>학교</th>
                <th>학년</th>
                <th>총제출</th>
                <th>마지막 제출일</th>
                <th>리포트 링크</th>
              </tr>
            </thead>
            <tbody>
              {submitted.map((s) => (
                <tr key={s.code}>
                  <td>{dayBadge(s.days)}</td>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.school}</td>
                  <td>{s.grade}</td>
                  <td style={{ textAlign: "center" }}>{s.count}회</td>
                  <td style={{ fontSize: 12, color: "#888" }}>
                    {new Date(s.lastDate).toLocaleDateString("ko-KR")}
                  </td>
                  <td>
                    <ReportLinkButton studentCode={s.code} studentName={s.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ height: 28 }} />

      {/* ── 섹션 2: 미제출 학생 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ color: "#e74c3c" }}>❌ 미제출 학생 ({notSubmitted.length}명)</h2>
        <button className="btn" style={{ padding: "4px 12px", fontSize: 13 }}
          onClick={exportNotSubmittedCSV} disabled={notSubmitted.length === 0}>
          CSV 저장
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        명부에 등록됐지만 아직 한 번도 제출하지 않은 학생입니다.
        {roster.length === 0 && " (명부 관리 탭에서 학생을 등록하면 자동 표시됩니다)"}
      </p>
      {notSubmitted.length === 0 ? (
        <p className="muted center" style={{ color: "#2ecc71", fontWeight: 600 }}>
          {roster.length === 0 ? "명부가 비어 있습니다." : "🎉 전원 제출 완료!"}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>이름</th>
                <th>학생코드</th>
                <th>학교</th>
                <th>학년</th>
                <th>담당교사</th>
              </tr>
            </thead>
            <tbody>
              {notSubmitted.map((s, i) => (
                <tr key={s.studentCode}>
                  <td style={{ color: "#aaa" }}>{i + 1}</td>
                  <td style={{ fontWeight: 700, color: "#e74c3c" }}>{s.name}</td>
                  <td style={{ fontSize: 12, color: "#888" }}>{s.studentCode}</td>
                  <td>{s.school}</td>
                  <td>{s.grade}</td>
                  <td>{s.teacher}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 학생 분석 리포트
// ═══════════════════════════════════════════════════

const REPORT_NOTE_KEY = "asx.report.note";

function StudentAnalysisReport({ rows }: { rows: ExamResult[] }) {
  const [note, setNote] = useState(() => localStorage.getItem(REPORT_NOTE_KEY) ?? "");
  const [saved, setSaved] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<string>("__all__");

  function saveNote() {
    localStorage.setItem(REPORT_NOTE_KEY, note);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // ── 학생 목록 ──
  const studentList = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.student.studentCode, r.student.name);
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // ── 월 추출 ──
  function getYearMonth(isoDate: string) {
    const d = new Date(isoDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // ── 학생별 × 월별 데이터 집계 ──
  const studentMonthlyData = useMemo(() => {
    // { studentCode → { name, months → { ym → data } } }
    const studentMap = new Map<string, {
      name: string;
      months: Map<string, {
        submissions: {
          examName: string;
          score: number;
          maxScore: number;
          date: string;
          wrongNos: number[];
          wrongWithReasons: { no: number; reasons: string[]; isThreePoint: boolean }[];
        }[];
        reasons: Map<string, number>;
        reflections: { examName: string; hardestReason: string; nextGoal: string; satisfaction: number | string }[];
      }>;
    }>();

    for (const r of rows) {
      const code = r.student.studentCode;
      const ym = getYearMonth(r.submittedAt);

      if (!studentMap.has(code)) {
        studentMap.set(code, { name: r.student.name, months: new Map() });
      }
      const student = studentMap.get(code)!;

      if (!student.months.has(ym)) {
        student.months.set(ym, { submissions: [], reasons: new Map(), reflections: [] });
      }
      const month = student.months.get(ym)!;

      // 제출 기록
      month.submissions.push({
        examName: r.exam.examName,
        score: r.score,
        maxScore: r.exam.maxScore,
        date: new Date(r.submittedAt).toLocaleDateString("ko-KR"),
        wrongNos: r.wrongAnswers.map((w) => w.questionNo).sort((a, b) => a - b),
        wrongWithReasons: r.wrongAnswers.map((w) => ({
          no: w.questionNo,
          reasons: w.reasons.map((reason) => WRONG_REASON_LABELS[reason as WrongReason] ?? reason),
          isThreePoint: w.isThreePoint ?? false,
        })),
      });

      // 오답 원인 집계
      for (const w of r.wrongAnswers) {
        for (const reason of w.reasons) {
          const label = WRONG_REASON_LABELS[reason as WrongReason] ?? reason;
          month.reasons.set(label, (month.reasons.get(label) ?? 0) + 1);
        }
      }

      // 회고
      if (r.reflection?.hardestReason || r.reflection?.nextGoal) {
        month.reflections.push({
          examName: r.exam.examName,
          hardestReason: r.reflection?.hardestReason ?? "",
          nextGoal: r.reflection?.nextGoal ?? "",
          satisfaction: r.reflection?.satisfaction ?? "-",
        });
      }
    }

    // 필터링
    const filtered = selectedStudent === "__all__"
      ? Array.from(studentMap.entries())
      : Array.from(studentMap.entries()).filter(([code]) => code === selectedStudent);

    return filtered
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([code, data]) => ({
        code,
        name: data.name,
        months: Array.from(data.months.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([ym, mdata]) => {
            // 월 전체 틀린 번호 빈도
            const wrongFreqMap = new Map<number, { cnt: number; reasons: string[]; isThreePoint: boolean }>();
            for (const sub of mdata.submissions) {
              for (const w of sub.wrongWithReasons) {
                const prev = wrongFreqMap.get(w.no);
                if (prev) {
                  prev.cnt++;
                  prev.reasons = [...new Set([...prev.reasons, ...w.reasons])];
                } else {
                  wrongFreqMap.set(w.no, { cnt: 1, reasons: w.reasons, isThreePoint: w.isThreePoint });
                }
              }
            }
            const wrongFreq = Array.from(wrongFreqMap.entries())
              .map(([no, v]) => ({ no, ...v }))
              .sort((a, b) => b.cnt - a.cnt || a.no - b.no);

            const avgScore = mdata.submissions.length > 0
              ? Math.round(mdata.submissions.reduce((s, x) => s + x.score, 0) / mdata.submissions.length)
              : 0;
            const avgPct = mdata.submissions.length > 0
              ? Math.round(mdata.submissions.reduce((s, x) => s + (x.score / x.maxScore) * 100, 0) / mdata.submissions.length)
              : 0;

            const topReasons = Array.from(mdata.reasons.entries())
              .map(([label, cnt]) => ({ label, cnt }))
              .sort((a, b) => b.cnt - a.cnt);
            const totalReasonCnt = topReasons.reduce((s, r) => s + r.cnt, 0);

            return { ym, avgScore, avgPct, submissions: mdata.submissions, wrongFreq, topReasons, totalReasonCnt, reflections: mdata.reflections };
          }),
      }));
  }, [rows, selectedStudent]);

  if (rows.length === 0)
    return <div className="card"><h2>학생 분석 리포트</h2><p className="muted center">제출 데이터가 없습니다.</p></div>;

  return (
    <div className="card">
      <h2>📊 학생별 월간 분석 리포트</h2>

      {/* ── 학생 선택 ── */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 600, marginRight: 8 }}>학생 선택:</label>
        <select
          value={selectedStudent}
          onChange={(e) => setSelectedStudent(e.target.value)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
        >
          <option value="__all__">전체 학생</option>
          {studentList.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* ── 학생별 카드 ── */}
      {studentMonthlyData.map(({ code, name, months }) => (
        <div key={code} style={{ marginBottom: 32, border: "3px solid #2c3e50", borderRadius: 14 }}>

          {/* 학생 헤더 */}
          <div style={{ background: "#2c3e50", color: "#fff", padding: "10px 18px", borderRadius: "11px 11px 0 0" }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>👤 {name}</span>
            <span style={{ marginLeft: 12, fontSize: 13, opacity: 0.7 }}>{months.length}개월 데이터</span>
          </div>

          {/* 월별 카드 */}
          {months.map(({ ym, avgScore, avgPct, submissions, wrongFreq, topReasons, totalReasonCnt, reflections }) => (
            <div key={ym} style={{ padding: 16, borderBottom: "1px solid #eee" }}>

              {/* 월 헤더 */}
              <div style={{ background: "#ecf0f1", borderRadius: 8, padding: "6px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>📅 {ym.replace("-", "년 ")}월</span>
                <span style={{ fontSize: 13, color: "#666" }}>{submissions.length}회 제출</span>
              </div>

              {/* 1. 점수 */}
              <h4 style={{ margin: "0 0 8px", color: "#2980b9" }}>① 점수</h4>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ background: "#eaf4fb", borderRadius: 8, padding: "6px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#2980b9" }}>{avgScore}점</div>
                  <div style={{ fontSize: 11, color: "#888" }}>월평균</div>
                </div>
                <div style={{ background: "#eaf4fb", borderRadius: 8, padding: "6px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#2980b9" }}>{avgPct}%</div>
                  <div style={{ fontSize: 11, color: "#888" }}>정답률</div>
                </div>
                {submissions.map((sub, i) => (
                  <div key={i} style={{ background: "#f9f9f9", borderRadius: 8, padding: "6px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{sub.score}/{sub.maxScore}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{sub.examName}</div>
                    <div style={{ fontSize: 10, color: "#aaa" }}>{sub.date}</div>
                  </div>
                ))}
              </div>

              {/* 2. 틀린 번호 */}
              <h4 style={{ margin: "0 0 8px", color: "#e74c3c" }}>② 틀린 번호 분석</h4>
              {wrongFreq.length === 0 ? (
                <p className="muted" style={{ marginBottom: 10 }}>오답 없음 (만점)</p>
              ) : (
                <>
                  {/* 번호 시각화 */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {wrongFreq.map((w) => (
                      <div
                        key={w.no}
                        title={`원인: ${w.reasons.join(", ") || "미입력"}`}
                        style={{
                          padding: "4px 10px", borderRadius: 6, fontWeight: 700, fontSize: 13,
                          background: w.cnt > 1 ? "#e74c3c" : w.isThreePoint ? "#e67e22" : "#f0f0f0",
                          color: w.cnt > 1 || w.isThreePoint ? "#fff" : "#333",
                          border: w.isThreePoint ? "2px solid #e67e22" : "2px solid transparent",
                        }}
                      >
                        {w.no}번{w.isThreePoint ? "★" : ""}{w.cnt > 1 ? ` ×${w.cnt}` : ""}
                      </div>
                    ))}
                  </div>
                  {/* 번호별 원인 표 */}
                  <div className="table-wrap" style={{ marginBottom: 10 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>문항</th>
                          <th>3점</th>
                          <th>반복</th>
                          <th>오답 원인</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wrongFreq.map((w) => (
                          <tr key={w.no}>
                            <td style={{ fontWeight: 700, color: "#e74c3c" }}>{w.no}번</td>
                            <td style={{ textAlign: "center" }}>{w.isThreePoint ? "★" : ""}</td>
                            <td style={{ textAlign: "center", color: w.cnt > 1 ? "#e74c3c" : "#aaa" }}>
                              {w.cnt > 1 ? `${w.cnt}회` : "-"}
                            </td>
                            <td style={{ fontSize: 12 }}>{w.reasons.join(", ") || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* 3. 오답 원인 분포 */}
              <h4 style={{ margin: "0 0 8px", color: "#8e44ad" }}>③ 오답 원인 분포</h4>
              {topReasons.length === 0 ? (
                <p className="muted" style={{ marginBottom: 10 }}>원인 데이터 없음</p>
              ) : (
                <div style={{ marginBottom: 10 }}>
                  {topReasons.map((r) => (
                    <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ minWidth: 70, fontSize: 13 }}>{r.label}</span>
                      <div style={{ flex: 1, background: "#eee", borderRadius: 4, height: 10 }}>
                        <div style={{
                          width: `${Math.round(r.cnt / totalReasonCnt * 100)}%`,
                          background: "#8e44ad", height: 10, borderRadius: 4
                        }} />
                      </div>
                      <span style={{ fontSize: 12, minWidth: 40 }}>{r.cnt}건 ({Math.round(r.cnt / totalReasonCnt * 100)}%)</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 4. 회고 */}
              <h4 style={{ margin: "0 0 8px", color: "#27ae60" }}>④ 회고 기록</h4>
              {reflections.length === 0 ? (
                <p className="muted">회고 기록 없음</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>시험</th>
                        <th>어려웠던 점</th>
                        <th>다음 목표</th>
                        <th>만족도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reflections.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 12 }}>{r.examName}</td>
                          <td style={{ fontSize: 12 }}>{r.hardestReason}</td>
                          <td style={{ fontSize: 12 }}>{r.nextGoal}</td>
                          <td style={{ textAlign: "center" }}>{r.satisfaction}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* ── 대책 메모 ── */}
      <h3>📝 대책 메모 (선생님 전용)</h3>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={6}
        style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd", fontSize: 14, resize: "vertical", boxSizing: "border-box" }}
        placeholder="예) 어휘 오답이 많으므로 매주 단어 테스트 강화..."
      />
      <div style={{ height: 8 }} />
      <button className="btn" onClick={saveNote}>
        {saved ? "✅ 저장됨" : "저장"}
      </button>
    </div>
  );
}

// ── 리포트 링크 버튼 ──────────────────────────────
function ReportLinkButton({ studentCode, studentName }: { studentCode: string; studentName: string }) {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    const token = await generateReportToken(studentCode);
    const url = buildReportUrl(studentCode, token);
    setLink(url);
    setLoading(false);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function sendSms() {
    const msg = `[L16] ${studentName}님의 학습 리포트: ${link}`;
    // 솔라피 문자 발송은 관리자 서버 필요 — 클립보드 복사로 대체
    window.open(`sms:?body=${encodeURIComponent(msg)}`);
  }

  if (!link) {
    return (
      <button
        onClick={generate}
        disabled={loading}
        style={{ padding: "3px 10px", fontSize: 12, borderRadius: 6, background: "#3498db", color: "#fff", border: "none", cursor: "pointer" }}
      >
        {loading ? "생성중…" : "링크 생성"}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={copyLink}
          style={{ padding: "3px 8px", fontSize: 11, borderRadius: 6, background: copied ? "#27ae60" : "#2ecc71", color: "#fff", border: "none", cursor: "pointer" }}
        >
          {copied ? "복사됨 ✓" : "복사"}
        </button>
        <button
          onClick={sendSms}
          style={{ padding: "3px 8px", fontSize: 11, borderRadius: 6, background: "#f39c12", color: "#fff", border: "none", cursor: "pointer" }}
        >
          문자
        </button>
      </div>
      <input
        readOnly
        value={link}
        style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "1px solid #ddd", width: 160 }}
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 문자알림 코너
// ═══════════════════════════════════════════════════

type SmsMode = "urgent" | "regular" | "individual" | "parent";


function GrowthPanelLazy() {
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    import("./GrowthPanel")
      .then(m => setComp(() => m.default))
      .catch(e => {
        console.error("GrowthPanel 로드 실패:", e);
        setErr(String(e?.message ?? e));
      });
  }, []);
  if (err) return (
    <div className="card">
      <p style={{color:"#ef4444", fontWeight:600}}>발전기록 로드 실패</p>
      <pre style={{fontSize:11, color:"#64748b", whiteSpace:"pre-wrap"}}>{err}</pre>
      <button onClick={() => { setErr(null); setComp(null);
        import("./GrowthPanel").then(m => setComp(() => m.default)).catch(e => setErr(String(e))); }}
        style={{marginTop:8, padding:"6px 14px", borderRadius:8, border:"none",
          background:"#0f766e", color:"#fff", cursor:"pointer", fontWeight:600}}>
        다시 시도
      </button>
    </div>
  );
  if (!Comp) return <div className="card"><p style={{color:"#94a3b8"}}>로딩 중…</p></div>;
  return <Comp />;
}
function SmsCenterPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const smsProvider = useMemo(() => createSmsProvider(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [mode, setMode] = useState<SmsMode>("urgent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parentTarget, setParentTarget] = useState<"both" | "father" | "mother">("both");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean }[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    rosterStore.listRoster().then((r) => {
      setRoster(r);
      setSelected(new Set(r.map((s) => s.studentCode)));
    });
  }, [rosterStore]);

  // 기본 메시지 템플릿
  const templates: Record<SmsMode, string> = {
    urgent: "[긴급] ",
    regular: "[안내] ",
    individual: "",
    parent: "[학부모 안내] ",
  };

  function toggleAll() {
    if (selected.size === roster.length) setSelected(new Set());
    else setSelected(new Set(roster.map((s) => s.studentCode)));
  }

  function toggleOne(code: string) {
    const next = new Set(selected);
    next.has(code) ? next.delete(code) : next.add(code);
    setSelected(next);
  }

  async function sendAll() {
    if (!message.trim()) { setNotice("메시지를 입력하세요."); return; }
    if (selected.size === 0) { setNotice("대상을 선택하세요."); return; }
    setSending(true);
    setResults([]);
    const targets = roster.filter((r) => selected.has(r.studentCode));
    const log: { name: string; ok: boolean }[] = [];

    for (const s of targets) {
      if (mode === "parent") {
        // 학부모에게 발송
        const hasParent = !!s.parentPhone;
        if (hasParent) {
          try {
            const msg = message.replace("{이름}", s.name);
            await smsProvider.send(s.parentPhone!, msg);
            log.push({ name: `${s.name}(학부모)`, ok: true });
          } catch {
            log.push({ name: `${s.name}(학부모)`, ok: false });
          }
        } else {
          log.push({ name: `${s.name}(학부모 번호 없음)`, ok: false });
        }
      } else {
        // 학생에게 발송
        try {
          const msg = message.replace("{이름}", s.name);
          await smsProvider.send(s.phone, msg);
          log.push({ name: s.name, ok: true });
        } catch {
          log.push({ name: s.name, ok: false });
        }
      }
    }
    setResults(log);
    setSending(false);
    const okCount = log.filter((l) => l.ok).length;
    setNotice(`발송 완료: ${okCount}명 성공 / ${log.length - okCount}명 실패`);
  }

  const modeConfig: Record<SmsMode, { label: string; color: string; desc: string }> = {
    urgent:     { label: "긴급 알림", color: "#e74c3c", desc: "긴급 공지 — 즉시 전송" },
    regular:    { label: "상시 알림", color: "#2980b9", desc: "정기 안내 — 일반 공지" },
    individual: { label: "개별 문자", color: "#27ae60", desc: "개인별 메시지 — 학생 선택 후 전송" },
    parent:     { label: "학부모 알림", color: "#8e44ad", desc: "학부모 번호로 발송" },
  };

  return (
    <div className="card">
      <h2>📱 문자알림 코너</h2>

      {/* 발송 유형 선택 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {(Object.keys(modeConfig) as SmsMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setMessage(templates[m]); setResults([]); setNotice(""); }}
            style={{
              padding: "10px 18px", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
              background: mode === m ? modeConfig[m].color : "#f5f5f5",
              color: mode === m ? "#fff" : "#555",
              border: `2px solid ${mode === m ? modeConfig[m].color : "#ddd"}`,
            }}
          >
            {modeConfig[m].label}
          </button>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        {modeConfig[mode].desc} · <code style={{ fontSize: 12 }}>{"{이름}"}</code> 입력 시 학생 이름으로 자동 치환
      </p>

      {/* 학부모 알림 옵션 */}
      {mode === "parent" && (
        <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>발송 대상:</span>
          {(["both", "father", "mother"] as const).map((t) => (
            <button key={t} onClick={() => setParentTarget(t)}
              style={{ padding: "4px 12px", borderRadius: 6, fontSize: 13, cursor: "pointer",
                background: parentTarget === t ? "#8e44ad" : "#f5f5f5",
                color: parentTarget === t ? "#fff" : "#555",
                border: `1px solid ${parentTarget === t ? "#8e44ad" : "#ddd"}`,
              }}>
              {t === "both" ? "전체" : t === "father" ? "부" : "모"}
            </button>
          ))}
        </div>
      )}

      {/* 메시지 입력 */}
      <label style={{ fontWeight: 700, fontSize: 14 }}>메시지</label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        style={{ width: "100%", padding: 10, borderRadius: 8, border: `2px solid ${modeConfig[mode].color}`, fontSize: 14, resize: "vertical", boxSizing: "border-box", marginTop: 6 }}
        placeholder="발송할 메시지를 입력하세요."
      />
      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16, textAlign: "right" }}>
        {message.length}자
      </div>

      {/* 대상 선택 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>발송 대상 ({selected.size}/{roster.length}명)</h3>
        <button onClick={toggleAll} style={{ fontSize: 13, padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer", background: "#f5f5f5" }}>
          {selected.size === roster.length ? "전체 해제" : "전체 선택"}
        </button>
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
              <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 12, width: 36 }}></th>
              <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 12 }}>이름</th>
              <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 12 }}>학교</th>
              <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 12 }}>등급</th>
              {mode === "parent" && <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 12 }}>학부모번호</th>}
            </tr>
          </thead>
          <tbody>
            {roster.map((s) => {
              const isSelected = selected.has(s.studentCode);
              const noParent = mode === "parent" && !s.parentPhone;
              return (
                <tr key={s.studentCode}
                  onClick={() => !noParent && toggleOne(s.studentCode)}
                  style={{ background: isSelected ? "#f0f9f0" : "#fff", cursor: noParent ? "not-allowed" : "pointer", opacity: noParent ? 0.4 : 1, borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "6px 10px" }}>
                    <input type="checkbox" checked={isSelected && !noParent} readOnly style={{ width: 16, height: 16 }} />
                  </td>
                  <td style={{ padding: "6px 10px", fontWeight: 600, fontSize: 14 }}>{s.name}</td>
                  <td style={{ padding: "6px 10px", fontSize: 13, color: "#666" }}>{s.school}</td>
                  <td style={{ padding: "6px 10px" }}>
                    {s.studentType ? (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                        background: s.studentType === "S" ? "#f3e8ff" : s.studentType === "W2" ? "#fff3e0" : "#fdecea",
                        color: s.studentType === "S" ? "#9b59b6" : s.studentType === "W2" ? "#e67e22" : "#e74c3c" }}>
                        {s.studentType}
                      </span>
                    ) : <span style={{ color: "#ccc", fontSize: 12 }}>-</span>}
                  </td>
                  {mode === "parent" && (
                    <td style={{ padding: "6px 10px", fontSize: 12, color: s.parentPhone ? "#333" : "#e74c3c" }}>
                      {s.parentPhone || "미등록"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 발송 버튼 */}
      {notice && (
        <p style={{ color: notice.includes("실패") ? "#e74c3c" : "#27ae60", fontWeight: 600, marginBottom: 8 }}>{notice}</p>
      )}
      <button
        onClick={sendAll}
        disabled={sending || selected.size === 0 || !message.trim()}
        style={{
          width: "100%", padding: "14px", fontSize: 16, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer",
          background: modeConfig[mode].color, color: "#fff", opacity: (sending || selected.size === 0 || !message.trim()) ? 0.5 : 1,
        }}
      >
        {sending ? "발송 중…" : `${modeConfig[mode].label} 발송 (${selected.size}명)`}
      </button>

      {/* 발송 결과 */}
      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>발송 결과</h3>
          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            {results.map((r, i) => (
              <div key={i} style={{ padding: "6px 12px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ color: r.ok ? "#27ae60" : "#e74c3c", fontWeight: 700 }}>{r.ok ? "✅" : "❌"}</span>
                <span>{r.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 수강확인 현황판
// ═══════════════════════════════════════════════════

function getWeeksInMonth(year: number, month: number): { start: Date; end: Date; label: string }[] {
  const weeks: { start: Date; end: Date; label: string }[] = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  let cur = new Date(firstDay);
  let weekNum = 1;
  while (cur <= lastDay) {
    const start = new Date(cur);
    const end = new Date(cur);
    end.setDate(end.getDate() + 6);
    if (end > lastDay) end.setTime(lastDay.getTime());
    weeks.push({
      start,
      end,
      label: `${weekNum}주 (${month}/${start.getDate()}~${end.getDate()})`,
    });
    cur.setDate(cur.getDate() + 7);
    weekNum++;
  }
  return weeks;
}

// ═══════════════════════════════════════════════════════
// 시험 준비 패널
// ═══════════════════════════════════════════════════════

interface ExamSchedule {
  id: string;
  studentCode: string;
  semester: "1" | "2";               // 1학기 / 2학기
  examType: "midterm" | "final";     // 중간 / 기말
  subject: string;                   // 과목명
  examStart: string;                 // 시험 시작일
  examEnd: string;                   // 시험 종료일
  englishExamDate: string;           // 영어 시험일
  examRange: string;                 // 시험 범위
  reportDeadline: string;            // 직보일 (성적 보고 기한)
  nextLessonDate: string;            // 시험 후 다음 수업 예정일
  score: number | null;              // 시험 결과 점수
  examPaperReceived: boolean;        // 시험지 수령 여부
  completed: boolean;                // 시험 완료 여부
  memo: string;
}

function examId() {
  return Math.random().toString(36).slice(2, 10);
}

const EMPTY_EXAM: Omit<ExamSchedule, "id" | "studentCode"> = {
  semester: "1",
  examType: "midterm",
  subject: "영어",
  examStart: "",
  examEnd: "",
  englishExamDate: "",
  examRange: "",
  reportDeadline: "",
  nextLessonDate: "",
  score: null,
  examPaperReceived: false,
  completed: false,
  memo: "",
};

// ── Supabase 시험지 업로드 헬퍼 ─────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

async function uploadExamPaper(file: File, examId: string, studentCode: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${examId}/${studentCode}_${Date.now()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/exam-papers/${path}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    body: file,
  });
  if (!res.ok) throw new Error("업로드 실패: " + await res.text());
  return `${SUPABASE_URL}/storage/v1/object/public/exam-papers/${path}`;
}

async function saveExamPaperRecord(examId: string, studentCode: string, studentName: string, imageUrl: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/exam_papers`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ exam_id: examId, student_code: studentCode, student_name: studentName, image_url: imageUrl }),
  });
}

async function fetchExamPapers(examId: string): Promise<{id:string;student_code:string;student_name:string;image_url:string;submitted_at:string}[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/exam_papers?exam_id=eq.${examId}&order=submitted_at.desc`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
  });
  return res.ok ? res.json() : [];
}

// ── SMS 시험지 제출 요청 발송 ─────────────────────────
async function sendExamPaperRequestSMS(phone: string, studentName: string, subject: string): Promise<void> {
  const { SolapiSmsProvider } = await import("../../lib/sms.solapi");
  const sms = new SolapiSmsProvider(
    import.meta.env.VITE_SOLAPI_API_KEY,
    import.meta.env.VITE_SOLAPI_API_SECRET,
    import.meta.env.VITE_SOLAPI_SENDER,
  );
  await sms.send(phone, `[L16] ${studentName} 학생, ${subject} 시험지 촬영 후 앱에서 제출해주세요. https://l16-academy.surge.sh`);
}


function ExamPrepPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamSchedule | null>(null);
  const [form, setForm] = useState<Omit<ExamSchedule, "id" | "studentCode">>(EMPTY_EXAM);
  const [viewFilter, setViewFilter] = useState<"all" | "upcoming" | "completed">("upcoming");
  const [viewMode, setViewMode] = useState<"admin" | "student" | "consult">("admin");
  const [studentExams, setStudentExams] = useState<any[]>([]);
  const [consultMsgs, setConsultMsgs] = useState<any[]>([]);
  const [replyId, setReplyId] = useState<string|null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [paperModal, setPaperModal] = useState<ExamSchedule | null>(null);
  const [papers, setPapers] = useState<{id:string;student_code:string;student_name:string;image_url:string;submitted_at:string}[]>([]);
  const [papersLoading, setPapersLoading] = useState(false);
  const [smsSending, setSmsSending] = useState<string | null>(null);

  const SB_H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    const saved = localStorage.getItem("l16.examSchedules");
    if (saved) setExams(JSON.parse(saved));
    // 학생이 직접 등록한 시험 + 상담 메시지 로딩
    fetch(`${SUPABASE_URL}/rest/v1/student_exams?order=submitted_at.desc`, { headers: SB_H })
      .then(r => r.json()).then(d => setStudentExams(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${SUPABASE_URL}/rest/v1/consultation_messages?order=created_at.desc`, { headers: SB_H })
      .then(r => r.json()).then(d => setConsultMsgs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [rosterStore]);

  function saveExams(newExams: ExamSchedule[]) {
    setExams(newExams);
    localStorage.setItem("l16.examSchedules", JSON.stringify(newExams));
  }

  async function sendReply(msgId: string) {
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/consultation_messages?id=eq.${msgId}`, {
        method: "PATCH",
        headers: { ...SB_H, "Content-Type": "application/json" },
        body: JSON.stringify({ admin_reply: replyText, replied_at: new Date().toISOString(), is_read: true }),
      });
      setConsultMsgs(prev => prev.map(m => m.id === msgId
        ? { ...m, admin_reply: replyText, replied_at: new Date().toISOString() } : m));
      setReplyId(null); setReplyText("");
      setNotice("답변을 전송했습니다."); setTimeout(() => setNotice(""), 3000);
    } catch { setNotice("답변 전송 실패"); }
    setReplying(false);
  }

  async function confirmStudentExam(id: string) {
    await fetch(`${SUPABASE_URL}/rest/v1/student_exams?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SB_H, "Content-Type": "application/json" },
      body: JSON.stringify({ admin_confirmed: true }),
    });
    setStudentExams(prev => prev.map(e => e.id === id ? { ...e, admin_confirmed: true } : e));
    setNotice("확인 처리됐습니다."); setTimeout(() => setNotice(""), 3000);
  }

  function daysUntil(dateStr: string): number {
    if (!dateStr) return 999;
    return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  }

  function addOrUpdateExam() {
    if (!selectedStudent) return;
    if (editingExam) {
      saveExams(exams.map(e => e.id === editingExam.id ? { ...editingExam, ...form } : e));
    } else {
      saveExams([...exams, { id: examId(), studentCode: selectedStudent, ...form }]);
    }
    setShowForm(false); setEditingExam(null); setForm(EMPTY_EXAM);
    setNotice("저장됐습니다."); setTimeout(() => setNotice(""), 2000);
  }

  function deleteExam(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    saveExams(exams.filter(e => e.id !== id));
  }

  function updateResult(id: string, field: "score" | "examPaperReceived" | "completed", value: any) {
    saveExams(exams.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  // 시험지 모달 열기
  async function openPaperModal(ex: ExamSchedule) {
    setPaperModal(ex);
    setPapersLoading(true);
    const result = await fetchExamPapers(ex.id);
    setPapers(result);
    setPapersLoading(false);
  }

  // SMS 발송
  async function sendSmsRequest(ex: ExamSchedule) {
    const student = roster.find(r => r.studentCode === ex.studentCode);
    if (!student?.phone) return alert("학생 전화번호가 없습니다.");
    setSmsSending(ex.id);
    try {
      await sendExamPaperRequestSMS(student.phone, student.name, ex.subject);
      setNotice(`${student.name} 학생에게 시험지 제출 요청 SMS 발송 완료`);
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      alert("SMS 발송 실패: " + (e as Error).message);
    } finally {
      setSmsSending(null);
    }
  }

  const activeRoster = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");
  const filteredExams = exams.filter(ex => {
    if (selectedStudent && ex.studentCode !== selectedStudent) return false;
    if (viewFilter === "upcoming") return !ex.completed;
    if (viewFilter === "completed") return ex.completed;
    return true;
  }).sort((a, b) => (a.englishExamDate || "z").localeCompare(b.englishExamDate || "z"));

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <h2 style={{ margin:0, color:"#7c3aed" }}>📝 시험 준비 현황판</h2>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2 }}>
            {([
              {key:"admin", label:"📋 내 관리"},
              {key:"student", label:`📩 학생등록 ${studentExams.length > 0 ? `(${studentExams.length})` : ""}`},
              {key:"consult", label:`💬 상담 ${consultMsgs.filter(m=>!m.admin_reply).length > 0 ? `(${consultMsgs.filter(m=>!m.admin_reply).length})` : ""}`},
            ] as const).map(t => (
              <button key={t.key} onClick={() => setViewMode(t.key)}
                style={{ padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
                  background: viewMode===t.key ? "#7c3aed" : "transparent",
                  color: viewMode===t.key ? "#fff" : "#64748b" }}>
                {t.label}
              </button>
            ))}
          </div>
          {viewMode === "admin" && (
            <button onClick={() => { setShowForm(true); setEditingExam(null); setForm(EMPTY_EXAM); }}
              style={{ padding:"7px 16px", background:"#7c3aed", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer" }}>
              + 시험 일정 추가
            </button>
          )}
        </div>
      </div>

      {notice && <p style={{ color:"#7c3aed", fontWeight:600, marginBottom:10 }}>{notice}</p>}

      {/* ── 학생 직접 등록 시험 ── */}
      {viewMode === "student" && (
        <div>
          <p style={{ fontSize:13, color:"#64748b", marginBottom:12 }}>학생이 직접 등록한 시험 일정입니다. 확인 후 처리해주세요.</p>
          {studentExams.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>학생이 등록한 시험이 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {studentExams
                .filter(e => !selectedStudent || e.student_code === selectedStudent)
                .map((ex, i) => {
                  const dl = ex.english_exam_date
                    ? Math.ceil((new Date(ex.english_exam_date).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <div key={i} style={{ border:`1.5px solid ${ex.admin_confirmed?"#86efac":"#fbbf24"}`,
                      borderRadius:12, overflow:"hidden", background: ex.admin_confirmed?"#f0fdf4":"#fffbeb" }}>
                      <div style={{ padding:"10px 14px", background: ex.admin_confirmed?"#d1fae5":"#fef3c7",
                        borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between",
                        alignItems:"center", flexWrap:"wrap", gap:8 }}>
                        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                          <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{ex.student_name}</span>
                          <span style={{ fontSize:11, background:"#ede9fe", color:"#7c3aed", padding:"1px 7px", borderRadius:8, fontWeight:600 }}>
                            {ex.semester}학기 {ex.exam_type==="midterm"?"중간":"기말"}
                          </span>
                          <span style={{ fontSize:11, background:"#f1f5f9", color:"#475569", padding:"1px 7px", borderRadius:8 }}>{ex.subject}</span>
                          {dl !== null && dl >= 0 && <span style={{ fontSize:12, fontWeight:700, color: dl<=7?"#dc2626":"#f97316" }}>D-{dl}</span>}
                          {ex.admin_confirmed
                            ? <span style={{ fontSize:11, color:"#059669", fontWeight:600 }}>✅ 확인완료</span>
                            : <span style={{ fontSize:11, color:"#d97706", fontWeight:600 }}>⏳ 미확인</span>}
                        </div>
                        {!ex.admin_confirmed && (
                          <button onClick={() => confirmStudentExam(ex.id)}
                            style={{ padding:"4px 12px", borderRadius:7, border:"none", background:"#7c3aed",
                              color:"#fff", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                            ✅ 확인 처리
                          </button>
                        )}
                      </div>
                      <div style={{ padding:"10px 14px", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:"6px 12px", fontSize:12 }}>
                        {[
                          { label:"시험 기간", value: ex.exam_start && ex.exam_end ? `${ex.exam_start.slice(5)} ~ ${ex.exam_end.slice(5)}` : "-" },
                          { label:"영어 시험일", value: ex.english_exam_date?.slice(5) ?? "-" },
                          { label:"직보일", value: ex.report_deadline?.slice(5) ?? "-" },
                          { label:"다음 수업", value: ex.next_lesson_date?.slice(5) ?? "-" },
                          { label:"시험 범위", value: ex.exam_range || "-" },
                          { label:"시험지 제출", value: ex.exam_paper_submitted ? "✅ 완료" : "❌ 미제출" },
                        ].map(it => (
                          <div key={it.label}>
                            <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600 }}>{it.label}</div>
                            <div style={{ color:"#374151" }}>{it.value}</div>
                          </div>
                        ))}
                      </div>
                      {ex.memo && <div style={{ padding:"6px 14px 10px", fontSize:12, color:"#64748b" }}>메모: {ex.memo}</div>}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ── 상담 메시지 ── */}
      {viewMode === "consult" && (
        <div>
          <p style={{ fontSize:13, color:"#64748b", marginBottom:12 }}>학생들이 보낸 상담 메시지입니다. 답변 후 학생 앱에 표시됩니다.</p>
          {consultMsgs.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>상담 메시지가 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {consultMsgs
                .filter(m => !selectedStudent || m.student_code === selectedStudent)
                .map((m, i) => (
                  <div key={i} style={{ border:`1.5px solid ${m.admin_reply?"#d1fae5":"#fbbf24"}`,
                    borderRadius:12, overflow:"hidden", background: m.admin_reply?"#f0fdf4":"#fff" }}>
                    <div style={{ padding:"10px 14px", background: m.admin_reply?"#d1fae5":"#fef3c7",
                      borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between",
                      alignItems:"center" }}>
                      <div>
                        <span style={{ fontWeight:700, fontSize:13 }}>{m.student_name}</span>
                        <span style={{ fontSize:11, color:"#94a3b8", marginLeft:8 }}>{m.created_at?.slice(0,10)}</span>
                        {m.admin_reply
                          ? <span style={{ fontSize:11, color:"#059669", marginLeft:8, fontWeight:600 }}>✅ 답변완료</span>
                          : <span style={{ fontSize:11, color:"#d97706", marginLeft:8, fontWeight:600 }}>⏳ 답변 필요</span>}
                      </div>
                    </div>
                    <div style={{ padding:"12px 14px" }}>
                      <p style={{ fontSize:13, color:"#374151", margin:"0 0 10px", whiteSpace:"pre-wrap" }}>{m.message}</p>
                      {m.admin_reply ? (
                        <div style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 12px", border:"1px solid #86efac" }}>
                          <p style={{ fontSize:11, color:"#059669", fontWeight:600, marginBottom:4 }}>내 답변</p>
                          <p style={{ fontSize:13, color:"#166534", margin:0, whiteSpace:"pre-wrap" }}>{m.admin_reply}</p>
                        </div>
                      ) : replyId === m.id ? (
                        <div>
                          <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                            placeholder="답변을 입력하세요" rows={3}
                            style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #7c3aed",
                              fontSize:13, resize:"none" as const, boxSizing:"border-box" as const, marginBottom:8 }} />
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={() => sendReply(m.id)} disabled={replying}
                              style={{ flex:1, padding:"8px", borderRadius:7, border:"none",
                                background:"#7c3aed", color:"#fff", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                              {replying ? "전송 중…" : "📨 답변 전송"}
                            </button>
                            <button onClick={() => { setReplyId(null); setReplyText(""); }}
                              style={{ padding:"8px 14px", borderRadius:7, border:"1px solid #e2e8f0",
                                background:"#fff", fontSize:13, cursor:"pointer" }}>취소</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setReplyId(m.id); setReplyText(""); }}
                          style={{ padding:"7px 16px", borderRadius:8, border:"1.5px solid #7c3aed",
                            background:"#fff", color:"#7c3aed", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                          ✏️ 답변하기
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── 기존 관리자 등록 탭 ── */}
      {viewMode === "admin" && (
      <div>
      {/* 필터 */}
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
          <option value="">전체 학생</option>
          {activeRoster.map(r => (
            <option key={r.studentCode} value={r.studentCode}>{r.name} ({r.school})</option>
          ))}
        </select>
        <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2 }}>
          {(["upcoming","all","completed"] as const).map(f => (
            <button key={f} onClick={() => setViewFilter(f)}
              style={{ padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
                background: viewFilter === f ? "#7c3aed" : "transparent",
                color: viewFilter === f ? "#fff" : "#64748b" }}>
              {f === "upcoming" ? "진행중" : f === "completed" ? "완료" : "전체"}
            </button>
          ))}
        </div>
      </div>

      {/* 시험 카드 목록 */}
      {filteredExams.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
          <p style={{ fontSize:32, marginBottom:8 }}>📅</p>
          <p>등록된 시험 일정이 없습니다.</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {filteredExams.map(ex => {
            const student = roster.find(r => r.studentCode === ex.studentCode);
            const daysLeft = daysUntil(ex.englishExamDate);
            const isUrgent = daysLeft >= 0 && daysLeft <= 7;
            return (
              <div key={ex.id} style={{
                border: `1.5px solid ${ex.completed ? "#d1fae5" : isUrgent ? "#fca5a5" : "#e2e8f0"}`,
                borderRadius:12, overflow:"hidden",
                background: ex.completed ? "#f0fdf4" : isUrgent ? "#fff5f5" : "#fff",
              }}>
                {/* 카드 헤더 */}
                <div style={{ padding:"10px 14px", background: ex.completed ? "#d1fae5" : isUrgent ? "#fee2e2" : "#f8fafc",
                  borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{student?.name ?? "?"}</span>
                    <span style={{ fontSize:11, color:"#64748b" }}>{student?.school}</span>
                    <span style={{ fontSize:11, background:"#ede9fe", color:"#7c3aed", padding:"1px 7px", borderRadius:10, fontWeight:600 }}>
                      {ex.semester}학기 {ex.examType === "midterm" ? "중간" : "기말"}
                    </span>
                    <span style={{ fontSize:11, background:"#f1f5f9", color:"#475569", padding:"1px 7px", borderRadius:10 }}>{ex.subject}</span>
                    {ex.completed
                      ? <span style={{ fontSize:11, background:"#d1fae5", color:"#166534", padding:"1px 7px", borderRadius:10, fontWeight:700 }}>✅ 완료</span>
                      : isUrgent
                        ? <span style={{ fontSize:12, background:"#ef4444", color:"#fff", padding:"2px 8px", borderRadius:10, fontWeight:700 }}>D-{daysLeft}</span>
                        : daysLeft < 30 && daysLeft >= 0
                          ? <span style={{ fontSize:11, color:"#f97316", fontWeight:700 }}>D-{daysLeft}</span>
                          : null}
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={() => sendSmsRequest(ex)} disabled={smsSending === ex.id}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #f97316", borderRadius:6, cursor:"pointer", background:"#fff7ed", color:"#c2410c", fontWeight:600 }}>
                      {smsSending === ex.id ? "발송 중…" : "📱 시험지 요청 SMS"}
                    </button>
                    <button onClick={() => openPaperModal(ex)}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #7c3aed", borderRadius:6, cursor:"pointer", background:"#ede9fe", color:"#7c3aed", fontWeight:600 }}>
                      🗂 시험지 보기
                    </button>
                    <button onClick={() => { setEditingExam(ex); setForm({...ex}); setShowForm(true); setSelectedStudent(ex.studentCode); }}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #e2e8f0", borderRadius:6, cursor:"pointer", background:"#fff" }}>수정</button>
                    <button onClick={() => deleteExam(ex.id)}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #fca5a5", borderRadius:6, cursor:"pointer", background:"#fff", color:"#ef4444" }}>삭제</button>
                  </div>
                </div>

                {/* 시험 정보 */}
                <div style={{ padding:"12px 14px", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:"8px 16px" }}>
                  {[
                    { label:"시험기간", value: ex.examStart && ex.examEnd ? `${ex.examStart} ~ ${ex.examEnd}` : "-" },
                    { label:"영어 시험일", value: ex.englishExamDate || "-" },
                    { label:"직보일", value: ex.reportDeadline || "-" },
                    { label:"남은 날짜", value: ex.englishExamDate ? (daysLeft < 0 ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`) : "-",
                      color: daysLeft <= 3 ? "#ef4444" : daysLeft <= 7 ? "#f97316" : "#2563eb" },
                    { label:"시험 범위", value: ex.examRange || "-" },
                    { label:"다음 수업", value: ex.nextLessonDate || "-" },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:2 }}>{item.label}</div>
                      <div style={{ fontSize:13, fontWeight:500, color: item.color ?? "#1e293b" }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* 결과 섹션 */}
                <div style={{ padding:"10px 14px", borderTop:"1px solid #f1f5f9", background:"#fafafa",
                  display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, fontWeight:600, color:"#475569" }}>시험 결과:</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:12, color:"#64748b" }}>점수</span>
                    <input type="number" placeholder="점수" value={ex.score ?? ""}
                      onChange={e => updateResult(ex.id, "score", e.target.value ? Number(e.target.value) : null)}
                      style={{ width:65, padding:"4px 8px", borderRadius:6, border:"1px solid #e2e8f0", fontSize:13, fontWeight:700, textAlign:"center" }} />
                  </div>
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:12 }}>
                    <input type="checkbox" checked={ex.examPaperReceived}
                      onChange={e => updateResult(ex.id, "examPaperReceived", e.target.checked)}
                      style={{ width:15, height:15 }} />
                    <span style={{ color: ex.examPaperReceived ? "#166534" : "#ef4444", fontWeight:600 }}>
                      {ex.examPaperReceived ? "✅ 시험지 수령" : "❌ 시험지 미수령"}
                    </span>
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:12 }}>
                    <input type="checkbox" checked={ex.completed}
                      onChange={e => updateResult(ex.id, "completed", e.target.checked)}
                      style={{ width:15, height:15 }} />
                    <span style={{ color: ex.completed ? "#166534" : "#64748b", fontWeight:600 }}>시험 완료</span>
                  </label>
                  {ex.completed && !ex.examPaperReceived && (
                    <span style={{ fontSize:11, background:"#fef3c7", color:"#d97706", padding:"2px 8px", borderRadius:8, fontWeight:600, border:"1px solid #fde68a" }}>
                      ⚠️ 시험지 등록 요청 필요
                    </span>
                  )}
                </div>
                {ex.memo && (
                  <div style={{ padding:"6px 14px 10px", borderTop:"1px solid #f1f5f9" }}>
                    <span style={{ fontSize:11, color:"#94a3b8" }}>메모: </span>
                    <span style={{ fontSize:12, color:"#475569" }}>{ex.memo}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 시험지 모달 ── */}
      {paperModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:400,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:14, width:"100%", maxWidth:560,
            maxHeight:"90vh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.25)" }}>
            {/* 모달 헤더 */}
            <div style={{ padding:"16px 20px", borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <h3 style={{ margin:0, color:"#7c3aed" }}>🗂 시험지 관리</h3>
                <p style={{ margin:"4px 0 0", fontSize:12, color:"#64748b" }}>
                  {roster.find(r => r.studentCode === paperModal.studentCode)?.name} — {paperModal.subject} {paperModal.examType === "midterm" ? "중간" : "기말"}고사
                </p>
              </div>
              <button onClick={() => setPaperModal(null)}
                style={{ border:"none", background:"none", fontSize:20, cursor:"pointer", color:"#94a3b8" }}>✕</button>
            </div>

            <div style={{ padding:"16px 20px" }}>
              {/* 제출 현황 */}
              <div style={{ marginBottom:16, padding:"10px 14px", borderRadius:10,
                background: papers.length > 0 ? "#f0fdf4" : "#fff5f5",
                border: `1px solid ${papers.length > 0 ? "#86efac" : "#fca5a5"}` }}>
                <p style={{ margin:0, fontWeight:700, color: papers.length > 0 ? "#166534" : "#ef4444" }}>
                  {papers.length > 0 ? `✅ 시험지 ${papers.length}장 제출됨` : "❌ 시험지 미제출"}
                </p>
              </div>

              {/* SMS 발송 버튼 */}
              <button onClick={() => sendSmsRequest(paperModal)} disabled={smsSending === paperModal.id}
                style={{ width:"100%", padding:"10px", marginBottom:16, borderRadius:8, border:"1.5px solid #f97316",
                  background:"#fff7ed", color:"#c2410c", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                📱 시험지 제출 요청 SMS 발송
              </button>

              {/* 제출된 시험지 목록 */}
              {papersLoading ? (
                <p style={{ textAlign:"center", color:"#94a3b8" }}>로딩 중…</p>
              ) : papers.length === 0 ? (
                <p style={{ textAlign:"center", color:"#94a3b8", padding:"20px 0" }}>제출된 시험지가 없습니다.</p>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {papers.map(p => (
                    <div key={p.id} style={{ border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ padding:"8px 12px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0",
                        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>{p.student_name}</span>
                        <span style={{ fontSize:11, color:"#94a3b8" }}>{new Date(p.submitted_at).toLocaleString("ko-KR")}</span>
                      </div>
                      <img src={p.image_url} alt="시험지"
                        style={{ width:"100%", display:"block", cursor:"pointer" }}
                        onClick={() => window.open(p.image_url, "_blank")} />
                      <div style={{ padding:"6px 12px", fontSize:11, color:"#94a3b8", textAlign:"center" }}>
                        클릭하면 원본 이미지가 열립니다
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 시험 일정 입력 모달 ── */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:300,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:14, padding:24, width:"100%", maxWidth:520,
            maxHeight:"90vh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.2)" }}>
            <h3 style={{ margin:"0 0 16px", color:"#7c3aed" }}>
              {editingExam ? "✏️ 시험 일정 수정" : "📅 시험 일정 추가"}
            </h3>
            <label style={{ fontSize:13, fontWeight:600 }}>학생</label>
            <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, marginBottom:10 }}>
              <option value="">학생 선택</option>
              {activeRoster.map(r => (
                <option key={r.studentCode} value={r.studentCode}>{r.name} ({r.school})</option>
              ))}
            </select>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>학기</label>
                <select value={form.semester} onChange={e => setForm({...form, semester: e.target.value as "1"|"2"})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
                  <option value="1">1학기</option>
                  <option value="2">2학기</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>시험 종류</label>
                <select value={form.examType} onChange={e => setForm({...form, examType: e.target.value as "midterm"|"final"})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
                  <option value="midterm">중간고사</option>
                  <option value="final">기말고사</option>
                </select>
              </div>
            </div>
            <label style={{ fontSize:13, fontWeight:600 }}>과목명</label>
            <input value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} placeholder="영어"
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, marginBottom:10, boxSizing:"border-box" as const }} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>시험 시작일</label>
                <input type="date" value={form.examStart} onChange={e => setForm({...form, examStart: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>시험 종료일</label>
                <input type="date" value={form.examEnd} onChange={e => setForm({...form, examEnd: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
            </div>
            <label style={{ fontSize:13, fontWeight:600 }}>영어 시험일 ★</label>
            <input type="date" value={form.englishExamDate} onChange={e => setForm({...form, englishExamDate: e.target.value})}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #7c3aed", fontSize:13, marginBottom:10, boxSizing:"border-box" as const }} />
            <label style={{ fontSize:13, fontWeight:600 }}>시험 범위</label>
            <textarea value={form.examRange} onChange={e => setForm({...form, examRange: e.target.value})}
              placeholder="예) 교과서 1~3과, 부교재 Unit 1-5" rows={2}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, resize:"none" as const, marginBottom:10, boxSizing:"border-box" as const }} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>직보일</label>
                <input type="date" value={form.reportDeadline} onChange={e => setForm({...form, reportDeadline: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>다음 수업 예정일</label>
                <input type="date" value={form.nextLessonDate} onChange={e => setForm({...form, nextLessonDate: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
            </div>
            <label style={{ fontSize:13, fontWeight:600 }}>메모</label>
            <textarea value={form.memo} onChange={e => setForm({...form, memo: e.target.value})} placeholder="추가 메모" rows={2}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, resize:"none" as const, marginBottom:16, boxSizing:"border-box" as const }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={addOrUpdateExam}
                style={{ flex:1, padding:11, borderRadius:8, border:"none", background:"#7c3aed", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                {editingExam ? "수정 저장" : "추가"}
              </button>
              <button onClick={() => { setShowForm(false); setEditingExam(null); }}
                style={{ flex:1, padding:11, borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", fontSize:14, cursor:"pointer" }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

