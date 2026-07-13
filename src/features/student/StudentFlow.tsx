import { useEffect, useMemo, useState } from "react";
import type {
  DraftResult,
  ExamResult,
  StudentInfo,
  ExamInfo,
  Reflection,
  WrongReason,
} from "../../core/types";
import { WRONG_REASONS, WRONG_REASON_LABELS } from "../../core/types";
import {
  validateStudentInfo,
  validateExamInfo,
  validateReflection,
  percentScore,
} from "../../core/logic";
import { validatePhoneNumber, normalizePhoneNumber } from "../../core/otpLogic";
import type { RosterEntry } from "../../core/roster";
import { validatePendingRegistration } from "../../core/pendingRegistration";
import type { PendingStore } from "../../lib/pendingStore";
import { useStorage } from "../../lib/useStorage";
import { OtpService } from "../../lib/otpService";
import { createSmsProvider } from "../../lib/smsFactory";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createPendingStore } from "../../lib/pendingStoreFactory";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import {
  validateSubmissionInput,
  type AssignmentType,
} from "../../core/assignment";

const EMPTY_DRAFT: DraftResult = {
  student: {},
  exam: { year: new Date().getFullYear(), totalQuestions: 45, maxScore: 100 },
  teacher: "",
  score: null,
  wrongAnswers: [],
  reflection: {},
  step: 0,
};

const STEPS = ["전화인증", "학생", "학교·학년", "시험", "총점", "오답번호", "오답원인", "회고", "제출"];

export default function StudentFlow() {
  const storage = useStorage();
  const otp = useMemo(() => new OtpService(createSmsProvider()), []);
  const rosterStore = useMemo(() => createRosterStore(), []);
  const pendingStore = useMemo(() => createPendingStore(), []);
  const [draft, setDraft] = useState<DraftResult>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [matched, setMatched] = useState(false);
  const [mode, setMode] = useState<"select" | "exam" | "assignment">("select");

  function refreshRoster() {
    return rosterStore.listRoster().then((r) => {
      setRoster(r);
      return r;
    });
  }

  useEffect(() => {
    refreshRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterStore]);

  // 최초 로드: 저장된 draft 복구
  useEffect(() => {
    storage.loadDraft().then((d) => {
      if (d) {
        setDraft(d);
        if (d.phone) setPhone(d.phone);
      }
      setLoaded(true);
    });
  }, [storage]);

  // 자동 저장 (변경 시마다)
  useEffect(() => {
    if (loaded) storage.saveDraft(draft);
  }, [draft, loaded, storage]);

  function canProceedStep0(): boolean {
    if (!phoneVerified) return false;
    if (roster.length === 0) return true; // 명부 미등록 상태 = 자유 진행 허용
    return matched;
  }

  useEffect(() => {
    if (phone) setPhoneVerified(otp.isVerified(phone));
    if (loaded && phone !== draft.phone) set({ phone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, otp, loaded]);

  // 새로고침 또는 관리자 승인 이후 명부를 다시 불러왔을 때 자동으로 매칭 상태 갱신
  useEffect(() => {
    if (!phoneVerified || !phone || roster.length === 0) return;
    const digits = normalizePhoneNumber(phone);
    const match = roster.find((r) => r.phone === digits);
    if (match) {
      setMatched(true);
      setDraft((d) => ({
        ...d,
        student: {
          studentCode: match.studentCode,
          name: match.name,
          school: match.school,
          grade: match.grade,
        },
        teacher: match.teacher || d.teacher,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneVerified, phone, roster]);

  const step = draft.step;
  const set = (patch: Partial<DraftResult>) =>
    setDraft((d) => ({ ...d, ...patch }));

  function next() {
    if (step === 0) {
      if (!canProceedStep0()) {
        setErrors(["전화번호 인증(및 승인)을 완료하세요."]);
        return;
      }
    } else {
      const errs = validateStep(step, draft);
      if (errs.length) {
        setErrors(errs);
        return;
      }
    }
    setErrors([]);
    set({ step: Math.min(step + 1, STEPS.length - 1) });
  }
  function back() {
    setErrors([]);
    set({ step: Math.max(step - 1, 0) });
  }

  async function submit() {
    const errs = validateStep(7, draft);
    if (errs.length) return setErrors(errs);
    const result: ExamResult = {
      id: crypto.randomUUID(),
      student: draft.student as StudentInfo,
      exam: draft.exam as ExamInfo,
      teacher: draft.teacher,
      date: new Date().toISOString().slice(0, 10),
      score: draft.score ?? 0,
      wrongAnswers: draft.wrongAnswers,
      reflection: draft.reflection as Reflection,
      submittedAt: new Date().toISOString(),
    };
    await storage.saveResult(result);
    await storage.clearDraft();
    setDone(true);
  }

  function restart() {
    setDraft(EMPTY_DRAFT);
    setDone(false);
    setPhone("");
    setPhoneVerified(false);
    setMatched(false);
  }

  if (!loaded) return <div className="card">불러오는 중…</div>;

  if (done) {
    return (
      <div className="card done">
        <div className="stamp-wrap">
          <div className="stamp-ring" />
          <div className="stamp">
            <span className="stamp-text">제출완료</span>
            <span className="stamp-sub">ASX RECORDER</span>
          </div>
        </div>
        <h2>제출이 완료됐습니다</h2>
        <p className="muted">시험 결과가 저장되었습니다.</p>
        <button className="btn" onClick={restart}>
          새로 입력하기
        </button>
      </div>
    );
  }

  if (mode === "assignment") {
    const rosterEntry = roster.find((r) => r.studentCode === draft.student.studentCode);
    return (
      <AssignmentSubmitForm
        studentCode={draft.student.studentCode ?? ""}
        studentName={draft.student.name ?? ""}
        parentPhone={rosterEntry?.parentPhone}
        onBack={() => setMode("select")}
      />
    );
  }

  return (
    <div className="card">
      <div className="progress">
        <div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <h2>{STEPS[step]}</h2>
      <p className="sub">
        {step + 1} / {STEPS.length} 단계
      </p>

      {errors.length > 0 && (
        <div className="errors">
          입력을 확인하세요:
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div key={step} className="step-fade">
        {step === 0 && (
          <StepPhoneVerify
            otp={otp}
            pendingStore={pendingStore}
            phone={phone}
            setPhone={setPhone}
            verified={phoneVerified}
            setVerified={setPhoneVerified}
            setErrors={setErrors}
            roster={roster}
            matched={matched}
            onMatched={(entry) => {
              setMatched(true);
              set({
                student: {
                  studentCode: entry.studentCode,
                  name: entry.name,
                  school: entry.school,
                  grade: entry.grade,
                },
                teacher: entry.teacher || draft.teacher,
              });
            }}
            onCheckApproval={refreshRoster}
            onChooseExam={() => {
              setMode("exam");
              next();
            }}
            onChooseAssignment={() => setMode("assignment")}
          />
        )}
        {step === 1 && <StepStudent draft={draft} set={set} />}
        {step === 2 && <StepSchool draft={draft} set={set} />}
        {step === 3 && <StepExam draft={draft} set={set} />}
        {step === 4 && <StepScore draft={draft} set={set} />}
        {step === 5 && <StepWrongNumbers draft={draft} set={set} />}
        {step === 6 && <StepWrongReasons draft={draft} set={set} />}
        {step === 7 && <StepReflection draft={draft} set={set} />}
        {step === 8 && <StepReview draft={draft} />}
      </div>

      {step > 0 && (
        <div className="nav-buttons">
          <button className="btn secondary" onClick={back}>
            이전
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn" onClick={next}>
              다음
            </button>
          ) : (
            <button className="btn" onClick={submit}>
              제출하기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function validateStep(step: number, d: DraftResult): string[] {
  switch (step) {
    case 1:
      return validateStudentInfo({
        ...d.student,
        school: d.student.school ?? "placeholder",
        grade: d.student.grade ?? "placeholder",
      }).filter((e) => e.includes("학생코드") || e.includes("이름"));
    case 2:
      return validateStudentInfo({
        ...d.student,
        studentCode: d.student.studentCode ?? "x",
        name: d.student.name ?? "x",
      }).filter((e) => e.includes("학교") || e.includes("학년"));
    case 3:
      return validateExamInfo(d.exam);
    case 4:
      return d.score == null || d.score < 0 ? ["총점을 입력하세요."] : [];
    case 5:
      return []; // 오답 0개 허용 (만점)
    case 6:
      return [];
    case 7:
      return validateReflection(d.reflection);
    default:
      return [];
  }
}

// ---------- Step components ----------
type StepProps = { draft: DraftResult; set: (p: Partial<DraftResult>) => void };

function StepPhoneVerify({
  otp,
  pendingStore,
  phone,
  setPhone,
  verified,
  setVerified,
  setErrors,
  roster,
  matched,
  onMatched,
  onCheckApproval,
  onChooseExam,
  onChooseAssignment,
}: {
  otp: OtpService;
  pendingStore: PendingStore;
  phone: string;
  setPhone: (v: string) => void;
  verified: boolean;
  setVerified: (v: boolean) => void;
  setErrors: (e: string[]) => void;
  roster: RosterEntry[];
  matched: boolean;
  onMatched: (entry: RosterEntry) => void;
  onCheckApproval: () => Promise<RosterEntry[]>;
  onChooseExam: () => void;
  onChooseAssignment: () => void;
}) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [checkingPending, setCheckingPending] = useState(false);
  const [regName, setRegName] = useState("");
  const [regSchool, setRegSchool] = useState("");
  const [regGrade, setRegGrade] = useState("");
  const [submittingReg, setSubmittingReg] = useState(false);

  function findRosterMatch(p: string): RosterEntry | null {
    if (roster.length === 0) return null;
    const digits = normalizePhoneNumber(p);
    return roster.find((r) => r.phone === digits) ?? null;
  }

  async function requestCode() {
    const errs = validatePhoneNumber(phone);
    if (errs.length) return setErrors(errs);
    setSending(true);
    setErrors([]);
    const r = await otp.requestOtp(phone);
    setSending(false);
    if (r.ok) {
      setSent(true);
      setNotice("인증번호를 전송했습니다. 5분 이내에 입력하세요.");
    } else {
      setErrors([r.error ?? "인증번호 전송에 실패했습니다."]);
    }
  }

  async function verifyCode() {
    setVerifying(true);
    setErrors([]);
    const r = await otp.verifyOtp(phone, code);
    setVerifying(false);
    if (!r.ok) {
      setErrors([r.error ?? "인증에 실패했습니다."]);
      return;
    }
    setVerified(true);
    setNotice("전화번호 인증이 완료되었습니다.");
    const match = findRosterMatch(phone);
    if (match) {
      onMatched(match);
      return;
    }
    if (roster.length > 0) {
      const p = await pendingStore.findByPhone(normalizePhoneNumber(phone));
      setIsPending(Boolean(p));
    }
  }

  async function submitRegistration() {
    const errs = validatePendingRegistration({
      name: regName,
      school: regSchool,
      grade: regGrade,
      phone,
    });
    if (errs.length) return setErrors(errs);
    setSubmittingReg(true);
    setErrors([]);
    await pendingStore.submit({
      phone: normalizePhoneNumber(phone),
      name: regName,
      school: regSchool,
      grade: regGrade,
      requestedAt: new Date().toISOString(),
    });
    setSubmittingReg(false);
    setIsPending(true);
  }

  async function checkApproval() {
    setCheckingPending(true);
    const updatedRoster = await onCheckApproval();
    setCheckingPending(false);
    const digits = normalizePhoneNumber(phone);
    const match = updatedRoster.find((r) => r.phone === digits);
    if (match) {
      onMatched(match);
    } else {
      setNotice("아직 승인 대기 중입니다. 잠시 후 다시 확인해 주세요.");
    }
  }

  if (verified && matched) {
    return (
      <div>
        <p className="muted">
          ✅ <b>{phone}</b> 인증 완료
        </p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          무엇을 하시겠어요?
        </p>
        <button className="btn" onClick={onChooseExam} style={{ marginBottom: 10 }}>
          시험 결과 제출하기
        </button>
        <button className="btn secondary" onClick={onChooseAssignment}>
          과제 제출하기
        </button>
      </div>
    );
  }

  // 자유 입력 모드(명부 미등록) — 과제 제출은 학생코드 확인이 안 되므로 시험 결과만 진행
  if (verified && roster.length === 0) {
    return (
      <div>
        <p className="muted">
          ✅ <b>{phone}</b> 인증 완료
        </p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          시험 결과 제출을 진행하세요. (과제 제출은 명부 등록 후 이용 가능합니다.)
        </p>
        <button className="btn" onClick={onChooseExam}>
          시험 결과 제출하기
        </button>
      </div>
    );
  }

  // 인증은 됐지만 명부에 없는 번호 → 등록 신청 또는 승인 대기
  if (verified && roster.length > 0 && !matched) {
    if (isPending) {
      return (
        <div>
          <p className="muted">
            ⏳ <b>{phone}</b> 등록 신청이 접수되었습니다.
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            선생님(관리자)의 승인 후 다음 단계로 진행할 수 있습니다. 시간이 걸릴 수 있으니
            잠시 후 아래 버튼으로 다시 확인해 주세요.
          </p>
          <div style={{ height: 10 }} />
          <button className="btn secondary" onClick={checkApproval} disabled={checkingPending}>
            {checkingPending ? "확인 중…" : "승인 확인하기"}
          </button>
          {notice && (
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              {notice}
            </p>
          )}
        </div>
      );
    }
    return (
      <div>
        <p className="muted">
          ✅ <b>{phone}</b> 전화번호 인증 완료 — 아직 등록된 학생이 아닙니다.
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          아래 정보를 입력해 등록을 신청하면 선생님(관리자) 승인 후 이용할 수 있습니다.
        </p>
        <label>이름</label>
        <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="이름" />
        <label>학교</label>
        <input
          value={regSchool}
          onChange={(e) => setRegSchool(e.target.value)}
          placeholder="예: 창동고"
        />
        <label>학년</label>
        <select value={regGrade} onChange={(e) => setRegGrade(e.target.value)}>
          <option value="">선택</option>
          <option value="1">1학년</option>
          <option value="2">2학년</option>
          <option value="3">3학년</option>
          <option value="N">N수</option>
        </select>
        <div style={{ height: 12 }} />
        <button className="btn" onClick={submitRegistration} disabled={submittingReg}>
          {submittingReg ? "신청 중…" : "등록 신청하기"}
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="muted">본인 확인을 위해 휴대폰 번호 인증이 필요합니다.</p>
      <label>휴대폰 번호</label>
      <input
        value={phone}
        placeholder="010-1234-5678"
        onChange={(e) => {
          setPhone(e.target.value);
          setSent(false);
        }}
      />
      <div style={{ height: 10 }} />
      <button className="btn secondary" onClick={requestCode} disabled={sending || !phone}>
        {sending ? "전송 중…" : sent ? "인증번호 재전송" : "인증번호 받기"}
      </button>

      {sent && (
        <>
          <label>인증번호 (6자리)</label>
          <input
            value={code}
            placeholder="123456"
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setCode(e.target.value)}
          />
          <div style={{ height: 10 }} />
          <button className="btn" onClick={verifyCode} disabled={verifying || code.length !== 6}>
            {verifying ? "확인 중…" : "인증 확인"}
          </button>
        </>
      )}
      {notice && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {notice}
        </p>
      )}
    </>
  );
}

function StepStudent({ draft, set }: StepProps) {
  const s = draft.student;
  return (
    <>
      <label>학생코드</label>
      <input
        value={s.studentCode ?? ""}
        placeholder="예: S1023"
        onChange={(e) => set({ student: { ...s, studentCode: e.target.value } })}
      />
      <label>이름</label>
      <input
        value={s.name ?? ""}
        placeholder="이름 확인"
        onChange={(e) => set({ student: { ...s, name: e.target.value } })}
      />
      <label>담당 선생님</label>
      <input
        value={draft.teacher}
        placeholder="예: 김민수"
        onChange={(e) => set({ teacher: e.target.value })}
      />
    </>
  );
}

function StepSchool({ draft, set }: StepProps) {
  const s = draft.student;
  return (
    <>
      <label>학교</label>
      <input
        value={s.school ?? ""}
        placeholder="예: 창동고"
        onChange={(e) => set({ student: { ...s, school: e.target.value } })}
      />
      <label>학년</label>
      <select
        value={s.grade ?? ""}
        onChange={(e) => set({ student: { ...s, grade: e.target.value } })}
      >
        <option value="">선택</option>
        <option value="1">1학년</option>
        <option value="2">2학년</option>
        <option value="3">3학년</option>
        <option value="N">N수</option>
      </select>
    </>
  );
}

function StepExam({ draft, set }: StepProps) {
  const x = draft.exam;
  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <>
      <label>시험명</label>
      <input
        value={x.examName ?? ""}
        placeholder="예: 3월 전국연합학력평가"
        onChange={(e) => set({ exam: { ...x, examName: e.target.value } })}
      />
      <div className="row">
        <div>
          <label>연도</label>
          <input
            type="number"
            value={x.year ?? ""}
            onChange={(e) => set({ exam: { ...x, year: num(e.target.value) } })}
          />
        </div>
        <div>
          <label>월</label>
          <input
            type="number"
            value={x.month ?? ""}
            onChange={(e) => set({ exam: { ...x, month: num(e.target.value) } })}
          />
        </div>
        <div>
          <label>회차</label>
          <input
            type="number"
            value={x.round ?? ""}
            onChange={(e) => set({ exam: { ...x, round: num(e.target.value) } })}
          />
        </div>
      </div>
      <div className="row">
        <div>
          <label>총문항수</label>
          <input
            type="number"
            value={x.totalQuestions ?? ""}
            onChange={(e) =>
              set({ exam: { ...x, totalQuestions: num(e.target.value) } })
            }
          />
        </div>
        <div>
          <label>총점(만점)</label>
          <input
            type="number"
            value={x.maxScore ?? ""}
            onChange={(e) =>
              set({ exam: { ...x, maxScore: num(e.target.value) } })
            }
          />
        </div>
      </div>
    </>
  );
}

function StepScore({ draft, set }: StepProps) {
  return (
    <>
      <label>내 총점</label>
      <input
        type="number"
        value={draft.score ?? ""}
        placeholder={`만점 ${draft.exam.maxScore ?? "?"}점 중`}
        onChange={(e) =>
          set({ score: e.target.value === "" ? null : Number(e.target.value) })
        }
      />
      {draft.score != null && draft.exam.maxScore ? (
        <p className="muted">
          → {percentScore(draft.score, draft.exam.maxScore)}점 (백분율)
        </p>
      ) : null}
    </>
  );
}

function StepWrongNumbers({ draft, set }: StepProps) {
  const total = draft.exam.totalQuestions ?? 45;
  const wrongSet = new Set(draft.wrongAnswers.map((w) => w.questionNo));

  function toggle(n: number) {
    if (wrongSet.has(n)) {
      set({ wrongAnswers: draft.wrongAnswers.filter((w) => w.questionNo !== n) });
    } else {
      set({
        wrongAnswers: [...draft.wrongAnswers, { questionNo: n, reasons: [] }].sort(
          (a, b) => a.questionNo - b.questionNo,
        ),
      });
    }
  }

  return (
    <>
      <p className="muted">틀린 문항 번호를 모두 탭하세요.</p>
      <div className="qgrid">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={"qbox" + (wrongSet.has(n) ? " on" : "")}
            onClick={() => toggle(n)}
          >
            {n}
          </div>
        ))}
      </div>
      <p className="muted center" style={{ marginTop: 12 }}>
        선택 {wrongSet.size}개
      </p>
    </>
  );
}

function StepWrongReasons({ draft, set }: StepProps) {
  if (draft.wrongAnswers.length === 0)
    return <p className="muted">틀린 문항이 없습니다. 다음으로 넘어가세요.</p>;

  function toggleReason(qno: number, reason: WrongReason) {
    set({
      wrongAnswers: draft.wrongAnswers.map((w) => {
        if (w.questionNo !== qno) return w;
        const has = w.reasons.includes(reason);
        return {
          ...w,
          reasons: has
            ? w.reasons.filter((r) => r !== reason)
            : [...w.reasons, reason],
        };
      }),
    });
  }

  return (
    <>
      <p className="muted">문항별 오답 원인을 선택하세요 (복수 선택 가능).</p>
      {draft.wrongAnswers.map((w) => (
        <div className="reason-block" key={w.questionNo}>
          <div className="qno">{w.questionNo}번</div>
          <div className="chips">
            {WRONG_REASONS.map((r) => (
              <div
                key={r}
                className={"chip" + (w.reasons.includes(r) ? " on" : "")}
                onClick={() => toggleReason(w.questionNo, r)}
              >
                {WRONG_REASON_LABELS[r]}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function StepReflection({ draft, set }: StepProps) {
  const r = draft.reflection;
  return (
    <>
      <label>가장 어려웠던 이유</label>
      <textarea
        value={r.hardestReason ?? ""}
        onChange={(e) => set({ reflection: { ...r, hardestReason: e.target.value } })}
      />
      <label>다음 시험 목표</label>
      <textarea
        value={r.nextGoal ?? ""}
        onChange={(e) => set({ reflection: { ...r, nextGoal: e.target.value } })}
      />
      <label>오늘 시험 만족도</label>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={"star" + ((r.satisfaction ?? 0) >= n ? " on" : "")}
            onClick={() => set({ reflection: { ...r, satisfaction: n } })}
          >
            ★
          </span>
        ))}
      </div>
    </>
  );
}

function StepReview({ draft }: { draft: DraftResult }) {
  const wrongNums = draft.wrongAnswers.map((w) => w.questionNo).join(", ") || "없음";
  return (
    <div>
      <p>
        <b>{draft.student.name}</b> ({draft.student.studentCode}) ·{" "}
        {draft.student.school} {draft.student.grade}학년
      </p>
      <p>
        {draft.exam.examName} — {draft.exam.year}년 {draft.exam.month}월{" "}
        {draft.exam.round}회
      </p>
      <p>
        점수: <b>{draft.score}</b> / {draft.exam.maxScore}
      </p>
      <p>틀린 번호: {wrongNums}</p>
      <p>만족도: {"★".repeat(draft.reflection.satisfaction ?? 0)}</p>
      <p className="muted">아래 버튼을 눌러 제출하세요.</p>
    </div>
  );
}

function AssignmentSubmitForm({
  studentCode,
  studentName,
  parentPhone,
  onBack,
}: {
  studentCode: string;
  studentName: string;
  parentPhone?: string;
  onBack: () => void;
}) {
  const assignmentStore = useMemo(() => createAssignmentStore(), []);
  const [types, setTypes] = useState<AssignmentType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [round, setRound] = useState("");
  const [score, setScore] = useState("");
  const [wrongNumbersText, setWrongNumbersText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    assignmentStore.listTypes().then((t) => {
      setTypes(t);
      if (t.length > 0) setTypeId(t[0].id);
    });
  }, [assignmentStore]);

  function parseWrongNumbers(text: string): number[] {
    return text
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  async function submit() {
    const input = {
      round: Number(round) || 0,
      score: score.trim() === "" ? null : Number(score),
      wrongNumbers: parseWrongNumbers(wrongNumbersText),
    };
    const errs = validateSubmissionInput(input);
    if (!typeId) errs.push("과제 유형을 선택하세요.");
    if (errs.length) return setErrors(errs);

    setSubmitting(true);
    setErrors([]);
    await assignmentStore.submit({
      id: crypto.randomUUID(),
      studentCode,
      typeId,
      round: input.round,
      score: input.score,
      wrongNumbers: input.wrongNumbers,
      submittedAt: new Date().toISOString(),
    });

    // 관리자 + 학부모에게 문자 알림 (실패해도 제출 자체는 유지)
    const typeName = types.find((t) => t.id === typeId)?.name ?? "과제";
    const message = `[ASX] ${studentName} 학생이 "${typeName}" ${input.round}회차 과제를 제출했습니다.`;
    const adminPhone = import.meta.env.VITE_ADMIN_PHONE as string | undefined;
    const provider = createSmsProvider();
    try {
      if (adminPhone) await provider.send(adminPhone, message);
      if (parentPhone) await provider.send(parentPhone, message);
    } catch {
      // 알림 발송 실패는 조용히 무시 — 제출 자체는 이미 저장됨
    }

    setSubmitting(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="card done">
        <div className="stamp-wrap">
          <div className="stamp-ring" />
          <div className="stamp">
            <span className="stamp-text">제출완료</span>
            <span className="stamp-sub">ASX RECORDER</span>
          </div>
        </div>
        <h2>과제가 제출됐습니다</h2>
        <p className="muted">관리자와 학부모님께 알림이 발송되었습니다.</p>
        <button className="btn" onClick={onBack}>
          처음으로
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>과제 제출</h2>
      <p className="sub">{studentName} 학생</p>

      {errors.length > 0 && (
        <div className="errors">
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {types.length === 0 ? (
        <p className="muted">등록된 과제 유형이 없습니다. 선생님께 문의하세요.</p>
      ) : (
        <>
          <label>과제 유형</label>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (지정 {t.targetCount}회)
              </option>
            ))}
          </select>

          <label>회차</label>
          <input
            type="number"
            value={round}
            onChange={(e) => setRound(e.target.value)}
            placeholder="예: 1"
          />

          <label>점수 (선택)</label>
          <input
            type="number"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="예: 88"
          />

          <label>틀린 문항 번호 (선택, 쉼표로 구분)</label>
          <input
            value={wrongNumbersText}
            onChange={(e) => setWrongNumbersText(e.target.value)}
            placeholder="예: 3, 17, 40"
          />

          <div style={{ height: 14 }} />
          <button className="btn" onClick={submit} disabled={submitting}>
            {submitting ? "제출 중…" : "제출하기"}
          </button>
        </>
      )}
      <div style={{ height: 8 }} />
      <button className="btn ghost" onClick={onBack}>
        ← 처음으로
      </button>
    </div>
  );
}
