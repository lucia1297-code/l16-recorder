import { useEffect, useMemo, useState, Fragment } from "react";
import type { ExamResult } from "../../core/types";
import { WRONG_REASON_LABELS } from "../../core/types";
import { computeDashboard, toCSV, percentScore } from "../../core/logic";
import { validateLoginInput } from "../../core/authLogic";
import { validatePhoneNumber, normalizePhoneNumber } from "../../core/otpLogic";
import { parseRosterRows, buildManualEntry, type RosterEntry } from "../../core/roster";
import { generateStudentCode } from "../../core/studentCode";
import type { PendingRegistration } from "../../core/pendingRegistration";
import { useStorage } from "../../lib/useStorage";
import { createAuth } from "../../lib/authFactory";
import { OtpService } from "../../lib/otpService";
import { createSmsProvider } from "../../lib/smsFactory";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createPendingStore } from "../../lib/pendingStoreFactory";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import { createMockExamTimingStore } from "../../lib/mockExamTimingStoreFactory";
import { createWarningStore } from "../../lib/warningStoreFactory";
import { createExamCheckStore } from "../../lib/examCheckStoreFactory";
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

const ADMIN_2FA_SESSION_KEY = "asx.admin.2fa";

export default function AdminPanel() {
  const auth = useMemo(() => createAuth(), []);
  const otp = useMemo(() => new OtpService(createSmsProvider()), []);
  const adminPhone = import.meta.env.VITE_ADMIN_PHONE as string | undefined;

  const [authed, setAuthed] = useState(() => auth.isLoggedIn());
  const [twoFactorOk, setTwoFactorOk] = useState(
    () => !adminPhone || sessionStorage.getItem(ADMIN_2FA_SESSION_KEY) === "1",
  );

  function handleLogout() {
    auth.logout();
    sessionStorage.removeItem(ADMIN_2FA_SESSION_KEY);
    setAuthed(false);
    setTwoFactorOk(!adminPhone);
  }

  if (!authed) return <Login auth={auth} onOk={() => setAuthed(true)} />;
  if (!twoFactorOk && adminPhone)
    return (
      <TwoFactorStep
        otp={otp}
        phone={adminPhone}
        onOk={() => {
          sessionStorage.setItem(ADMIN_2FA_SESSION_KEY, "1");
          setTwoFactorOk(true);
        }}
        onCancel={handleLogout}
      />
    );
  return <AdminHome onLogout={handleLogout} />;
}

function Login({ auth, onOk }: { auth: ReturnType<typeof createAuth>; onOk: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const errs = validateLoginInput({ email, password: pw }, auth.requiresEmail);
    if (errs.length) return setErrors(errs);
    setLoading(true);
    const result = await auth.login(email, pw);
    setLoading(false);
    if (result.ok) onOk();
    else setErrors([result.error ?? "로그인에 실패했습니다."]);
  }

  return (
    <div className="card">
      <h2>관리자 로그인</h2>
      <p className="sub">
        {auth.requiresEmail ? "이메일과 비밀번호를 입력하세요." : "비밀번호를 입력하세요."}
      </p>
      {errors.length > 0 && (
        <div className="errors">
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {auth.requiresEmail && (
        <>
          <label>이메일</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
        </>
      )}
      <label>비밀번호</label>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호" />
      <div style={{ height: 12 }} />
      <button className="btn" onClick={submit} disabled={loading}>
        {loading ? "확인 중…" : "로그인"}
      </button>
      {!auth.requiresEmail && (
        <p className="muted center" style={{ marginTop: 10, fontSize: 13 }}>
          (.env 의 VITE_ADMIN_PASSWORD로 설정 — 미설정 시 개발용 기본값 사용)
        </p>
      )}
    </div>
  );
}

function TwoFactorStep({
  otp,
  phone,
  onOk,
  onCancel,
}: {
  otp: OtpService;
  phone: string;
  onOk: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    // 로그인 성공 직후 자동으로 1회 발송
    requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestCode() {
    setSending(true);
    setErrors([]);
    const r = await otp.requestOtp(phone);
    setSending(false);
    if (r.ok) setSent(true);
    else setErrors([r.error ?? "인증번호 전송에 실패했습니다."]);
  }

  async function verify() {
    setVerifying(true);
    setErrors([]);
    const r = await otp.verifyOtp(phone, code);
    setVerifying(false);
    if (r.ok) onOk();
    else setErrors([r.error ?? "인증에 실패했습니다."]);
  }

  return (
    <div className="card">
      <h2>2단계 인증</h2>
      <p className="sub">관리자 등록 번호({maskPhone(phone)})로 전송된 인증번호를 입력하세요.</p>
      {errors.length > 0 && (
        <div className="errors">
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <label>인증번호 (6자리)</label>
      <input
        value={code}
        placeholder="123456"
        inputMode="numeric"
        maxLength={6}
        onChange={(e) => setCode(e.target.value)}
      />
      <div style={{ height: 12 }} />
      <button className="btn" onClick={verify} disabled={verifying || code.length !== 6}>
        {verifying ? "확인 중…" : "인증 확인"}
      </button>
      <div style={{ height: 8 }} />
      <button className="btn secondary" onClick={requestCode} disabled={sending}>
        {sending ? "전송 중…" : sent ? "재전송" : "인증번호 받기"}
      </button>
      <div style={{ height: 8 }} />
      <button className="btn ghost" onClick={onCancel}>
        취소하고 로그아웃
      </button>
    </div>
  );
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function AdminHome({ onLogout }: { onLogout: () => void }) {
  const storage = useStorage();
  const [rows, setRows] = useState<ExamResult[]>([]);
  const [tab, setTab] = useState<
    "list" | "dash" | "roster" | "pending" | "assignment" | "review" | "teacherlog"
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
          학생 목록
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
      <h2>학생 목록 ({filtered.length})</h2>
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
                  <td>
                    {r.exam.examName} ({r.exam.month}월)
                  </td>
                  <td>
                    {r.score}/{r.exam.maxScore}
                  </td>
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
    const stamped = preview.map((e) => ({ ...e, registeredAt: e.registeredAt ?? now }));
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
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((e) => (
                <tr key={e.studentCode}>
                  <td>{e.studentCode}</td>
                  <td>{e.name}</td>
                  <td>{e.school}</td>
                  <td>
                    {editingCode === e.studentCode ? (
                      <div>
                        <input
                          value={editPhone}
                          onChange={(ev) => setEditPhone(ev.target.value)}
                          placeholder="010-1234-5678"
                          style={{ padding: 6, fontSize: 13, width: 130 }}
                        />
                        {editError && (
                          <div style={{ color: "var(--red)", fontSize: 11 }}>{editError}</div>
                        )}
                      </div>
                    ) : (
                      e.phone
                    )}
                  </td>
                  <td>
                    {editingCode === e.studentCode ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => savePhone(e)}
                        >
                          저장
                        </button>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={cancelEdit}
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => startEdit(e)}
                        >
                          번호수정
                        </button>
                        <button
                          className="btn ghost"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => sendCode(e)}
                        >
                          전송
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
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
  const inGrace = useMemo(
    () => roster.filter((r) => isInGracePeriod(r.registeredAt, now)),
    [roster, now],
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
    setSaving(false);
    setNotice("저장되었습니다.");
    const logs = await logStore.listLogsForStudent(studentCode);
    setPastDates(logs.map((l) => l.date));
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
