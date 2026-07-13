import { useEffect, useMemo, useState } from "react";
import type { ExamResult } from "../../core/types";
import { WRONG_REASON_LABELS } from "../../core/types";
import { computeDashboard, toCSV, percentScore } from "../../core/logic";
import { validateLoginInput } from "../../core/authLogic";
import { parseRosterRows, type RosterEntry } from "../../core/roster";
import { useStorage } from "../../lib/useStorage";
import { createAuth } from "../../lib/authFactory";
import { OtpService } from "../../lib/otpService";
import { createSmsProvider } from "../../lib/smsFactory";
import { createRosterStore } from "../../lib/rosterStoreFactory";

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
  const [tab, setTab] = useState<"list" | "dash" | "roster">("list");

  useEffect(() => {
    storage.listResults().then(setRows);
  }, [storage]);

  return (
    <>
      <div className="tabs">
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>
          학생 목록
        </button>
        <button className={tab === "dash" ? "on" : ""} onClick={() => setTab("dash")}>
          대시보드
        </button>
        <button className={tab === "roster" ? "on" : ""} onClick={() => setTab("roster")}>
          명부 관리
        </button>
      </div>
      {tab === "list" && <ResultList rows={rows} />}
      {tab === "dash" && <DashboardView rows={rows} />}
      {tab === "roster" && <RosterManager />}
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={onLogout}>
        로그아웃
      </button>
    </>
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
    await rosterStore.saveRoster(preview);
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
        `[ASX] ${entry.name} 학생의 학생코드는 ${entry.studentCode} 입니다.`,
      );
      setNotice(`${entry.name} 학생에게 코드를 전송했습니다.`);
    } catch (e) {
      setNotice(`전송 실패: ${(e as Error).message}`);
    }
  }

  return (
    <div className="card">
      <h2>명부 관리</h2>
      <p className="sub">
        엑셀 명부를 업로드하면 학생코드·전화번호가 등록되어, 학생 전화인증 시 등록된 번호만
        허용됩니다.
      </p>

      {notice && <p className="muted">{notice}</p>}

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
                <th>문자발송</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((e) => (
                <tr key={e.studentCode}>
                  <td>{e.studentCode}</td>
                  <td>{e.name}</td>
                  <td>{e.school}</td>
                  <td>{e.phone}</td>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                      onClick={() => sendCode(e)}
                    >
                      전송
                    </button>
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
