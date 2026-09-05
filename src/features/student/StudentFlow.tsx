import { Calendar } from "lucide-react";
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
import StudentExamRegister from "./StudentExamRegister";
import { createSmsProvider } from "../../lib/smsFactory";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createPendingStore } from "../../lib/pendingStoreFactory";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import { createMockExamTimingStore } from "../../lib/mockExamTimingStoreFactory";
import { createExamCheckStore } from "../../lib/examCheckStoreFactory";
import type { ExamCheckAnswer } from "../../core/examCheck";
import { EXAM_CHECK_ANSWER_LABELS } from "../../core/examCheck";
import {
  validateSubmissionInput,
  validateGeneralSubmissionInput,
  validateMockExamTimingInput,
  computeNextRound,
  isMockExamKind,
  getGeneralFieldLabels,
  detectAnalysisCategory,
  ANALYSIS_QUESTIONS,
  type AssignmentType,
  type AssignmentSubmission,
  type AssignmentAnalysisAnswer,
  type AssignmentAnalysisData,
} from "../../core/assignment";
import {
  evaluateStepTiming,
  TIMING_EVALUATION_LABELS,
  type MockExamTimingConfig,
  type TimingEvaluation,
} from "../../core/mockExamTiming";
import {
  saveSubmissionToNeon,
  saveAttemptToNeon,
  type NeonQuestionAttempt,
} from "../../lib/neonStorage";

const EMPTY_DRAFT: DraftResult = {
  student: {},
  exam: { year: new Date().getFullYear(), totalQuestions: 45, maxScore: 100 },
  teacher: "",
  score: null,
  solvingTime: null,
  wrongAnswers: [],
  reflection: {},
  step: 0,
};

const STEPS = ["전화인증", "학생", "학교·학년", "시험", "풀이시간", "오답번호", "3점문항", "오답원인", "상세분석", "회고", "총점확인", "제출"];

export default function StudentFlow({ previewMode = false }: { previewMode?: boolean }) {
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
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [matched, setMatched] = useState(false);
  const [mode, setMode] = useState<"select" | "exam" | "examCheck" | "assignment" | "examregister">("select");

  // 미리보기 모드 - 감아랑 학생으로 자동 설정
  useEffect(() => {
    if (!previewMode) return;
    rosterStore.listRoster().then((roster) => {
      // 명부에서 감아랑 찾기
      const student = roster.find((r) => r.name === "감아랑") ?? {
        studentCode: "PREVIEW",
        name: "감아랑",
        school: "세화여고",
        grade: "3",
        phone: "01012345678",
        teacher: "김민수",
        note: "",
      };
      setPhoneVerified(true);
      setMatched(true);
      setLoaded(true);
      setDraft((prev) => ({
        ...prev,
        phone: student.phone,
        student: {
          name: student.name,
          studentCode: student.studentCode,
          school: student.school,
          grade: student.grade,
        },
        teacher: student.teacher ?? "",
        step: 1,
      }));
    });
  }, [previewMode]);

  function refreshRoster() {
    return rosterStore.listRoster().then((r) => {
      setRoster(r);
      setRosterLoaded(true);
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
        // 항상 인증 단계(step 0)부터 시작 - 저장된 step 무시
        setDraft({ ...d, step: 0 });
        if (d.phone) setPhone(d.phone);
      }
      setLoaded(true);
    });
  }, [storage]);

  // 자동 저장 (변경 시마다)
  useEffect(() => {
    if (loaded) storage.saveDraft({ ...draft, step: 0 }); // 항상 step 0으로 저장
  }, [draft, loaded, storage]);

  function canProceedStep0(): boolean {
    if (!phoneVerified) return false;
    if (!rosterLoaded) return false; // 명부 로딩 중에는 진행 불가
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
    const errs = validateStep(9, draft);
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
      questionDetails: draft.questionDetails ?? [],
      submittedAt: new Date().toISOString(),
    };

    // 미리보기 모드: 실제 저장 없이 완료 화면만 표시
    if (previewMode) {
      setDone(true);
      return;
    }

    // 저장 시도 — 실패 시 오류 표시
    try {
      await storage.saveResult(result);
    } catch(e: any) {
      const msg = e?.message ?? e?.details ?? "저장 실패";
      console.error("[Submit] Supabase 저장 오류:", e);
      setErrors([`제출 중 오류가 발생했습니다: ${msg}\n잠시 후 다시 시도해주세요.`]);
      return;
    }

    // 관리자 SMS 알림 (실패해도 제출 자체는 완료)
    const adminPhone = import.meta.env.VITE_ADMIN_PHONE as string | undefined;
    if (adminPhone) {
      createSmsProvider()
        .send(adminPhone, `[L16] ${result.student.name} 모의고사 제출 완료 (${result.score}점)`)
        .catch(() => {});
    }

    // Neon DB 저장 (비동기 - 실패해도 제출 완료)
    saveSubmissionToNeon({
      id: result.id,
      studentId: result.student.studentCode,
      studentName: result.student.name,
      school: result.student.school,
      grade: result.student.grade,
      examId: `${result.exam.year}_${result.exam.month}_${result.exam.examName}`,
      examName: result.exam.examName,
      examYear: result.exam.year,
      examMonth: result.exam.month,
      score: result.score,
      maxScore: result.exam.maxScore,
      wrongAnswers: result.wrongAnswers,
      reflection: result.reflection,
      submittedAt: result.submittedAt,
    }).catch(console.error);

    // 상세 분석 Neon 저장
    if (draft.questionDetails && draft.questionDetails.length > 0) {
      for (const detail of draft.questionDetails) {
        const attempt: NeonQuestionAttempt = {
          submissionId: result.id,
          studentId: result.student.studentCode,
          examId: `${result.exam.year}_${result.exam.month}_${result.exam.examName}`,
          questionNo: detail.questionNo,
          chosenOption: detail.chosenOption,
          confidenceBefore: detail.confidenceBefore,
          reasonStudent: detail.reasonStudent,
          evidenceSentence: detail.evidenceSentence,
          missedSignal: detail.missedSignal,
          optionElimination: detail.optionElimination,
          studentNextAction: detail.studentNextAction,
          isThreePoint: draft.wrongAnswers.find((w) => w.questionNo === detail.questionNo)?.isThreePoint ?? false,
        };
        saveAttemptToNeon(attempt).catch(console.error);
      }
    }

    await storage.clearDraft().catch(() => {});
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
            <span className="stamp-text">{previewMode ? "미리보기" : "제출완료"}</span>
            <span className="stamp-sub">L16 RECORDER</span>
          </div>
        </div>
        <h2>{previewMode ? "미리보기 완료" : "제출이 완료됐습니다"}</h2>
        <p className="muted">{previewMode ? "실제 데이터는 저장되지 않았습니다." : "시험 결과가 저장되었습니다."}</p>
        <button className="btn" onClick={restart}>
          {previewMode ? "처음부터 다시 보기" : "새로 입력하기"}
        </button>
      </div>
    );
  }

  if (mode === "examCheck") {
    return (
      <ExamCompletionCheckScreen
        studentCode={draft.student.studentCode ?? ""}
        studentName={draft.student.name ?? ""}
        onDone={() => setMode("assignment")}
      />
    );
  }

  if (mode === "examregister") {
    const matchedEntry = roster.find(r => r.studentCode === draft.student.studentCode);
    return (
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, padding:"0 16px" }}>
          <button onClick={() => setMode("select")}
            style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #e2e8f0",
              background:"#fff", fontSize:13, cursor:"pointer" }}>
            ← 뒤로
          </button>
          <h2 style={{ margin:0, fontSize:16, color:"#7c3aed" }}><Calendar size={13} style={{verticalAlign:"middle",marginRight:4}}/> 시험 등록 / 상담</h2>
        </div>
        <div style={{ padding:"0 16px" }}>
          <StudentExamRegister
            studentCode={matchedEntry?.studentCode ?? draft.student.studentCode ?? ""}
            studentName={matchedEntry?.name ?? draft.student.name ?? ""}
          />
        </div>
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
            onExamRegister={() => setMode("examregister")}
          />
        )}
        {step === 1 && <StepStudent draft={draft} set={set} />}
        {step === 2 && <StepSchool draft={draft} set={set} />}
        {step === 3 && <StepExam draft={draft} set={set} />}
        {step === 4 && <StepSolvingTime draft={draft} set={set} />}
        {step === 5 && <StepWrongNumbers draft={draft} set={set} />}
        {step === 6 && <StepThreePoint draft={draft} set={set} />}
        {step === 7 && <StepWrongReasons draft={draft} set={set} />}
        {step === 8 && <StepQuestionDetail draft={draft} set={set} />}
        {step === 9 && <StepReflection draft={draft} set={set} />}
        {step === 10 && <StepScoreConfirm draft={draft} set={set} />}
        {step === 11 && <StepReview draft={draft} />}
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
    case 4: {
      // 풀이시간
      const times = d.solvingTime as unknown as (number | null)[] | null;
      const arr = Array.isArray(times) ? times : [];
      const allOk = arr.length === 3 && arr.every((t) => t != null && t > 0);
      return allOk ? [] : [" Step 1·2·3 풀이 시간을 모두 입력해야 다음으로 진행할 수 있습니다."];
    }
    case 5:
      return []; // 오답번호 (만점 허용)
    case 6:
      return []; // 3점문항 (선택)
    case 7:
      return []; // 오답원인
    case 8:
      return []; // 상세분석 (선택)
    case 9:
      return validateReflection(d.reflection);
    case 10:
      return d.score == null || d.score < 0 ? ["총점을 확인하세요."] : [];
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
  onExamRegister,
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
  onExamRegister: () => void;
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
          <b>{phone}</b> 인증 완료
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
        <button className="btn secondary" onClick={onExamRegister}>
          <Calendar size={13} style={{verticalAlign:"middle",marginRight:4}}/> 시험 등록 / 상담
        </button>

      </div>
    );
  }

  // 자유 입력 모드(명부 미등록) — 과제 제출은 학생코드 확인이 안 되므로 시험 결과만 진행
  if (verified && roster.length === 0) {
    return (
      <div>
        <p className="muted">
          <b>{phone}</b> 인증 완료
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
             <b>{phone}</b> 등록 신청이 접수되었습니다.
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
          <b>{phone}</b> 전화번호 인증 완료 — 아직 등록된 학생이 아닙니다.
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
  const autoCalculated = draft.wrongAnswers.length > 0;
  return (
    <>
      <label>내 총점</label>
      {autoCalculated && (
        <p className="muted" style={{ fontSize: 13, color: "#27ae60", marginBottom: 6 }}>
          오답 체크에서 자동 계산됨 — 직접 수정할 수 있습니다.
        </p>
      )}
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

// ── Step별 목표시간 ──────────────────────────────
const STEP_TARGETS = [
  { label: "Step 1 (18~28번)", target: 5 },
  { label: "Step 2 (29~38번)", target: 15 },
  { label: "Step 3 (39~45번)", target: 15 },
];

function StepSolvingTime({ draft, set }: StepProps) {
  const times = (draft.solvingTime as unknown as number[] | null) ?? [null, null, null];
  const asArr = Array.isArray(times) ? times : [null, null, null];

  function setTime(idx: number, val: number | null) {
    const next = [...asArr] as (number | null)[];
    next[idx] = val;
    set({ solvingTime: next as unknown as number });
  }

  const allEntered = asArr.every((t) => t != null && t > 0);
  const totalActual = asArr.reduce<number>((s, t) => s + (t ?? 0), 0);
  const totalTarget = STEP_TARGETS.reduce<number>((s, t) => s + t.target, 0);

  // 가상 점수 계산
  const baseScore = draft.score ?? 0;
  let bonus = 0;
  asArr.forEach((t, i) => {
    if (t == null) return;
    const diff = STEP_TARGETS[i].target - t; // 양수=빠름, 음수=느림
    bonus += diff; // 분당 +1/-1
  });
  const virtualScore = Math.min(100, Math.max(0, baseScore + bonus));

  return (
    <>
      <p className="muted">각 Step별 실제 풀이 시간을 입력하세요.</p>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
        목표 초과 시 분당 -1점 · 목표보다 빠르면 분당 +1점 가산한 가상점수를 계산합니다.
      </p>

      {STEP_TARGETS.map((st, i) => {
        const t = asArr[i];
        const diff = t != null ? st.target - t : null;
        const color = diff == null ? "#aaa" : diff > 0 ? "#27ae60" : diff < 0 ? "#e74c3c" : "#3498db";
        return (
          <div key={i} style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "#f9f9f9", border: "1px solid #eee" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{st.label}</span>
              <span style={{ fontSize: 12, color: "#888" }}>목표: {st.target}분</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="number"
                min={1}
                max={60}
                value={t ?? ""}
                placeholder="분"
                onChange={(e) => setTime(i, e.target.value === "" ? null : Number(e.target.value))}
                style={{ width: 80, fontSize: 18, textAlign: "center", fontWeight: 700, padding: "6px 8px" }}
              />
              <span style={{ fontSize: 13 }}>분</span>
              {diff != null && (
                <span style={{ fontWeight: 700, color, fontSize: 14 }}>
                  {diff > 0 ? `+${diff}점 (${diff}분 빠름)` : diff < 0 ? `${diff}점 (${Math.abs(diff)}분 초과)` : "정확히 맞춤"}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* 미입력 경고 */}
      {!allEntered && (
        <div style={{ padding: "14px 16px", borderRadius: 10, background: "#fdecea", border: "2px solid #e74c3c", marginBottom: 12 }}>
          <p style={{ margin: 0, fontWeight: 700, color: "#e74c3c", fontSize: 15 }}>
             3개 Step 시간을 모두 입력해야 다음 단계로 넘어갈 수 있습니다.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#888" }}>
            기억이 정확하지 않으면 대략적인 시간을 입력하세요.
          </p>
        </div>
      )}

      {/* 전체 요약 */}
      {allEntered && (
        <div style={{ padding: "14px 16px", borderRadius: 10,
          background: totalActual > totalTarget ? "#fdecea" : "#f0f9f0",
          border: `2px solid ${totalActual > totalTarget ? "#e74c3c" : "#2ecc71"}`,
          marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 15 }}>
            총 풀이 시간: {totalActual}분
            {totalActual > totalTarget
              ? ` (목표 ${totalTarget}분 초과 +${totalActual - totalTarget}분)`
              : ` (목표 ${totalTarget}분보다 ${totalTarget - totalActual}분 빠름)`}
          </p>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2c3e50" }}>{baseScore}점</div>
              <div style={{ fontSize: 12, color: "#888" }}>실제 점수</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#aaa", alignSelf: "center" }}>→</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700,
                color: virtualScore > baseScore ? "#27ae60" : virtualScore < baseScore ? "#e74c3c" : "#3498db" }}>
                {virtualScore}점
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>가상 점수 ({bonus >= 0 ? "+" : ""}{bonus}점)</div>
            </div>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#666" }}>
            * 가상점수 = 실제점수 {bonus >= 0 ? "+" : ""}{bonus}점 (step별 시간 가산)
          </p>
        </div>
      )}
    </>
  );
}


// ── 3점 문항 체크 단계 ──────────────────────────────
function StepThreePoint({ draft, set }: StepProps) {
  const maxScore = draft.exam.maxScore ?? 100;
  const wrongNums = draft.wrongAnswers.map((w) => w.questionNo);

  function toggleThree(n: number) {
    const newWrong = draft.wrongAnswers.map((w) =>
      w.questionNo === n ? { ...w, isThreePoint: !w.isThreePoint } : w
    );
    // 3점 문항 변경 시 자동 점수 재계산 (인라인)
    const deduction = newWrong.reduce((s, w) => s + (w.isThreePoint ? 3 : 2), 0);
    const autoScore = Math.max(0, maxScore - deduction);
    set({ wrongAnswers: newWrong, score: autoScore });
  }

  if (wrongNums.length === 0) {
    return (
      <>
        <p style={{ color: "#27ae60", fontWeight: 600, fontSize: 15 }}>
          오답이 없습니다! 만점입니다.
        </p>
        <p className="muted">다음 단계로 진행하세요.</p>
      </>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        오답 중 <strong>3점 문항</strong>에 체크하세요.<br />
        체크하지 않은 문항은 2점으로 계산됩니다.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {wrongNums.map((n) => {
          const isThree = draft.wrongAnswers.find((w) => w.questionNo === n)?.isThreePoint ?? false;
          return (
            <button
              key={n}
              onClick={() => toggleThree(n)}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: isThree ? "2px solid #e74c3c" : "2px solid #ddd",
                background: isThree ? "#fdecea" : "#f8f9fa",
                color: isThree ? "#e74c3c" : "#555",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
                minWidth: 56,
              }}
            >
              {n}번{isThree ? " 3점" : ""}
            </button>
          );
        })}
      </div>
      <p style={{ marginTop: 16, fontSize: 14, color: "#2980b9", fontWeight: 600 }}>
        예상 점수: <strong>{draft.score ?? "?"}점</strong>
      </p>
    </>
  );
}

function StepWrongNumbers({ draft, set }: StepProps) {
  const total = draft.exam.totalQuestions ?? 45;
  const maxScore = draft.exam.maxScore ?? 100;
  const wrongSet = new Set(draft.wrongAnswers.map((w) => w.questionNo));

  function toggle(n: number) {
    let newWrong;
    if (wrongSet.has(n)) {
      newWrong = draft.wrongAnswers.filter((w) => w.questionNo !== n);
    } else {
      newWrong = [...draft.wrongAnswers, { questionNo: n, reasons: [], isThreePoint: false }].sort(
        (a, b) => a.questionNo - b.questionNo,
      );
    }
    const autoScore = calcAutoScore(newWrong, maxScore);
    set({ wrongAnswers: newWrong, score: autoScore });
  }

  function toggleThreePoint(n: number) {
    const newWrong = draft.wrongAnswers.map((w) =>
      w.questionNo === n ? { ...w, isThreePoint: !w.isThreePoint } : w
    );
    const autoScore = calcAutoScore(newWrong, maxScore);
    set({ wrongAnswers: newWrong, score: autoScore });
  }

  function calcAutoScore(wrongs: typeof draft.wrongAnswers, max: number) {
    const threeCount = wrongs.filter((w) => w.isThreePoint).length;
    const twoCount = wrongs.length - threeCount;
    return max - threeCount * 3 - twoCount * 2;
  }

  const autoScore = calcAutoScore(draft.wrongAnswers, maxScore);

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

      {draft.wrongAnswers.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 16, marginBottom: 8 }}>
            3점 문항에 체크하세요:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {draft.wrongAnswers.map((w) => (
              <label
                key={w.questionNo}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: w.isThreePoint ? "#e8f4fd" : "#f5f5f5",
                  border: w.isThreePoint ? "2px solid #3498db" : "2px solid #ddd",
                  borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                  fontWeight: 600, fontSize: 15,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!w.isThreePoint}
                  onChange={() => toggleThreePoint(w.questionNo)}
                  style={{ width: 18, height: 18 }}
                />
                {w.questionNo}번 3점
              </label>
            ))}
          </div>

          <div style={{
            marginTop: 16, padding: "12px 16px",
            background: "#f0f9f0", borderRadius: 10,
            border: "2px solid #2ecc71",
          }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
              자동 계산 점수: <span style={{ color: "#27ae60", fontSize: 20 }}>{autoScore}점</span>
              <span style={{ color: "#888", fontSize: 13, marginLeft: 8 }}>/ {maxScore}점</span>
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>
              2점 문항 {draft.wrongAnswers.filter((w) => !w.isThreePoint).length}개 ×2점
              + 3점 문항 {draft.wrongAnswers.filter((w) => w.isThreePoint).length}개 ×3점 감점
            </p>
          </div>
        </>
      )}

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
      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
        {draft.wrongAnswers.map((w) => (
          <div className="reason-block" key={w.questionNo}>
            <div className="qno">
              {w.questionNo}번
              {w.isThreePoint && (
                <span style={{ marginLeft: 6, fontSize: 11, color: "#e74c3c", fontWeight: 700 }}>3점</span>
              )}
            </div>
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
      </div>
    </>
  );
}

function StepQuestionDetail({ draft, set }: StepProps) {
  const { wrongAnswers, questionDetails = [] } = draft;

  // 상위 3개 자동 선정 (헷갈림 표시 → 3점 문항 → 번호 순)
  const top3 = useMemo(() => {
    const sorted = [...wrongAnswers].sort((a, b) => {
      if (a.isThreePoint && !b.isThreePoint) return -1;
      if (!a.isThreePoint && b.isThreePoint) return 1;
      return a.questionNo - b.questionNo;
    });
    return sorted.slice(0, 3);
  }, [wrongAnswers]);

  // 선택된 상세 분석 문항
  const [selected, setSelected] = useState<number[]>(
    () => top3.map((w) => w.questionNo)
  );

  function getDetail(qNo: number): import("../../core/types").QuestionDetail {
    return questionDetails.find((d) => d.questionNo === qNo) ?? {
      questionNo: qNo,
      chosenOption: "",
      confidenceBefore: 50,
      reasonStudent: "",
      evidenceSentence: "",
      missedSignal: "",
      optionElimination: { "1": "", "2": "", "3": "", "4": "", "5": "" },
      studentNextAction: "",
    };
  }

  function updateDetail(qNo: number, patch: Partial<import("../../core/types").QuestionDetail>) {
    const existing = getDetail(qNo);
    const updated = { ...existing, ...patch };
    const others = questionDetails.filter((d) => d.questionNo !== qNo);
    set({ questionDetails: [...others, updated] });
  }

  function toggleSelect(qNo: number) {
    setSelected((prev) =>
      prev.includes(qNo)
        ? prev.filter((n) => n !== qNo)
        : prev.length < 3 + wrongAnswers.length
          ? [...prev, qNo]
          : prev
    );
  }

  if (wrongAnswers.length === 0) {
    return (
      <div>
        <p className="muted">오답이 없습니다 (만점). 다음 단계로 이동하세요.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        상위 3개 문항이 자동 선정됐습니다. 추가로 선택하거나 해제할 수 있습니다.
      </p>

      {/* 문항 선택 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {wrongAnswers.map((w) => {
          const isSelected = selected.includes(w.questionNo);
          const isAuto = top3.some((t) => t.questionNo === w.questionNo);
          return (
            <button
              key={w.questionNo}
              onClick={() => toggleSelect(w.questionNo)}
              style={{
                padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                fontWeight: 700, fontSize: 14,
                background: isSelected ? "#2980b9" : "#f0f0f0",
                color: isSelected ? "#fff" : "#333",
                border: isAuto ? "2px solid #e74c3c" : "2px solid transparent",
              }}
            >
              {w.questionNo}번{isAuto ? " ★" : ""}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>★ 자동 선정 | 파란색 = 상세 입력</p>

      {/* 선택된 문항별 상세 입력 */}
      {selected.sort((a, b) => a - b).map((qNo) => {
        const detail = getDetail(qNo);
        const wrong = wrongAnswers.find((w) => w.questionNo === qNo);
        return (
          <div key={qNo} style={{ border: "2px solid #3498db", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h4 style={{ margin: "0 0 12px", color: "#2980b9" }}>
              {qNo}번 문항 상세분석
              {wrong?.isThreePoint && <span style={{ marginLeft: 8, color: "#e74c3c", fontSize: 13 }}>3점</span>}
            </h4>

            <label style={{ fontSize: 13, fontWeight: 600 }}>내가 고른 선지</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, marginTop: 4 }}>
              {["1", "2", "3", "4", "5"].map((n) => (
                <button
                  key={n}
                  onClick={() => updateDetail(qNo, { chosenOption: n })}
                  style={{
                    width: 40, height: 40, borderRadius: "50%", fontWeight: 700,
                    background: detail.chosenOption === n ? "#e74c3c" : "#f0f0f0",
                    color: detail.chosenOption === n ? "#fff" : "#333",
                    border: "none", cursor: "pointer", fontSize: 16,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600 }}>
              자신감: {detail.confidenceBefore}%
            </label>
            <input
              type="range" min={0} max={100} step={10}
              value={detail.confidenceBefore}
              onChange={(e) => updateDetail(qNo, { confidenceBefore: Number(e.target.value) })}
              style={{ width: "100%", marginBottom: 12 }}
            />

            <label style={{ fontSize: 13, fontWeight: 600 }}>선택 이유</label>
            <input
              value={detail.reasonStudent}
              onChange={(e) => updateDetail(qNo, { reasonStudent: e.target.value })}
              placeholder="왜 이 선지를 골랐나요?"
              style={{ marginBottom: 8 }}
            />

            <label style={{ fontSize: 13, fontWeight: 600 }}>근거로 삼은 문장</label>
            <input
              value={detail.evidenceSentence}
              onChange={(e) => updateDetail(qNo, { evidenceSentence: e.target.value })}
              placeholder="어떤 문장/표현을 근거로 삼았나요?"
              style={{ marginBottom: 8 }}
            />

            <label style={{ fontSize: 13, fontWeight: 600 }}>놓친 신호</label>
            <input
              value={detail.missedSignal}
              onChange={(e) => updateDetail(qNo, { missedSignal: e.target.value })}
              placeholder="무엇을 못 봤나요?"
              style={{ marginBottom: 8 }}
            />

            <label style={{ fontSize: 13, fontWeight: 600 }}>선지 소거 메모 (선택)</label>
            {["1", "2", "3", "4", "5"].map((n) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, width: 24, textAlign: "center" }}>{n}번</span>
                <input
                  value={detail.optionElimination[n] ?? ""}
                  onChange={(e) => updateDetail(qNo, {
                    optionElimination: { ...detail.optionElimination, [n]: e.target.value }
                  })}
                  placeholder={`${n}번 선지 판단`}
                  style={{ flex: 1, marginBottom: 0 }}
                />
              </div>
            ))}

            <label style={{ fontSize: 13, fontWeight: 600, marginTop: 8, display: "block" }}>다음에 할 행동</label>
            <input
              value={detail.studentNextAction}
              onChange={(e) => updateDetail(qNo, { studentNextAction: e.target.value })}
              placeholder="다음에는 어떻게 풀겠나요?"
            />
          </div>
        );
      })}
    </div>
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


// ── 총점 확인 단계 (자동계산 후 확인) ──────────────
function StepScoreConfirm({ draft, set }: StepProps) {
  const autoScore = draft.score;
  const wrongCount = draft.wrongAnswers.length;
  const threeCount = draft.wrongAnswers.filter((w) => w.isThreePoint).length;
  const twoCount = wrongCount - threeCount;
  const deduction = threeCount * 3 + twoCount * 2;
  const maxScore = draft.exam.maxScore ?? 100;

  return (
    <>
      <div style={{
        background: "#e8f8f5", border: "2px solid #27ae60", borderRadius: 12,
        padding: 16, marginBottom: 16
      }}>
        <p style={{ fontSize: 13, color: "#27ae60", fontWeight: 600, marginBottom: 8 }}>
          자동 계산 결과
        </p>
        <p style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
          오답 {wrongCount}문항 (3점: {threeCount}개 × 3점 + 2점: {twoCount}개 × 2점 = -{deduction}점)
        </p>
        <p style={{ fontSize: 22, fontWeight: 700, color: "#27ae60" }}>
          {maxScore}점 - {deduction}점 = <strong>{autoScore}점</strong>
        </p>
      </div>
      <label style={{ fontSize: 14, color: "#555", marginBottom: 6, display: "block" }}>
        점수가 다르면 직접 수정하세요
      </label>
      <input
        type="number"
        value={draft.score ?? ""}
        placeholder="점수 직접 입력"
        onChange={(e) => set({ score: e.target.value === "" ? null : Number(e.target.value) })}
        style={{
          width: "100%", padding: "12px 16px", borderRadius: 10,
          border: "1.5px solid #ddd", fontSize: 18, fontWeight: 700, textAlign: "center"
        }}
      />
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        실제 채점 결과와 다를 경우 수정 후 다음으로 진행하세요.
      </p>
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
  const timingStore = useMemo(() => createMockExamTimingStore(), []);
  const [types, setTypes] = useState<AssignmentType[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [timingConfig, setTimingConfig] = useState<MockExamTimingConfig | null>(null);
  const [pickedType, setPickedType] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [round, setRound] = useState("");
  const [score, setScore] = useState("");
  const [wrongNumbersText, setWrongNumbersText] = useState("");
  const [item, setItem] = useState("");
  const [scope, setScope] = useState("");
  const [completed, setCompleted] = useState(true);
  const [totalMinutes, setTotalMinutes] = useState("");
  const [step1Minutes, setStep1Minutes] = useState("");
  const [step2Minutes, setStep2Minutes] = useState("");
  const [step3Minutes, setStep3Minutes] = useState("");
  const [analysisAnswers, setAnalysisAnswers] = useState<AssignmentAnalysisAnswer[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [timingResult, setTimingResult] = useState<
    { label: string; minutes: number; evaluation: TimingEvaluation }[]
  >([]);

  useEffect(() => {
    assignmentStore.listTypes().then(setTypes);
    assignmentStore.listSubmissionsForStudent(studentCode).then(setSubmissions);
    timingStore.getConfig().then(setTimingConfig).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[L16] 모의고사 세부풀이시간 설정을 불러오지 못했습니다:", e);
    });
  }, [assignmentStore, timingStore, studentCode]);

  const selectedType = types.find((t) => t.id === typeId);
  const isMockExam = selectedType ? isMockExamKind(selectedType) : false;
  const fieldLabels = selectedType ? getGeneralFieldLabels(selectedType) : null;
  const nextRound = selectedType ? computeNextRound(submissions, studentCode, typeId) : 1;
  const showTiming = isMockExam && timingConfig?.enabled;

  function parseWrongNumbers(text: string): number[] {
    return text
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  function parseMinutes(text: string): number | undefined {
    if (text.trim() === "") return undefined;
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }

  async function submit() {
    if (!typeId) return setErrors(["과제 유형을 선택하세요."]);

    let submissionPatch: Partial<AssignmentSubmission> = {};
    let effectiveRound: number;
    const errs: string[] = [];

    if (isMockExam) {
      effectiveRound = Number(round) || 0;
      const scoreVal = score.trim() === "" ? null : Number(score);
      errs.push(...validateSubmissionInput({ round: effectiveRound, score: scoreVal, wrongNumbers: [] }));
      submissionPatch = { score: scoreVal, wrongNumbers: parseWrongNumbers(wrongNumbersText) };

      if (showTiming) {
        const timingInput = {
          totalMinutes: parseMinutes(totalMinutes),
          step1Minutes: parseMinutes(step1Minutes),
          step2Minutes: parseMinutes(step2Minutes),
          step3Minutes: parseMinutes(step3Minutes),
        };
        errs.push(...validateMockExamTimingInput(timingInput));
        submissionPatch = { ...submissionPatch, ...timingInput };
      }
    } else {
      effectiveRound = nextRound;
      errs.push(...validateGeneralSubmissionInput({ item, scope, completed }));
      submissionPatch = { item, scope, completed, score: null, wrongNumbers: [] };
    }

    if (errs.length) return setErrors(errs);

    setSubmitting(true);
    setErrors([]);

    const wasEditing = Boolean(editingId);
    const submissionId = editingId ?? crypto.randomUUID();

    const finalPatch: Partial<AssignmentSubmission> = {
      round: effectiveRound,
      score: submissionPatch.score ?? null,
      wrongNumbers: submissionPatch.wrongNumbers ?? [],
      ...(isMockExam
        ? {
            totalMinutes: submissionPatch.totalMinutes,
            step1Minutes: submissionPatch.step1Minutes,
            step2Minutes: submissionPatch.step2Minutes,
            step3Minutes: submissionPatch.step3Minutes,
          }
        : { item: submissionPatch.item, scope: submissionPatch.scope, completed: submissionPatch.completed }),
    };

    if (wasEditing) {
      await assignmentStore.updateSubmission(submissionId, finalPatch);
    } else {
      const analysisCategory = selectedType ? detectAnalysisCategory(selectedType.name) : "reading";
    const analysisDataToSave: AssignmentAnalysisData | undefined = analysisAnswers.length > 0 ? {
      category: analysisCategory,
      answers: analysisAnswers,
      submittedAt: new Date().toISOString(),
    } : undefined;

    await assignmentStore.submit({
        id: submissionId,
        studentCode,
        typeId,
        submittedAt: new Date().toISOString(),
        analysisData: analysisDataToSave,
        ...finalPatch,
      } as AssignmentSubmission);
    }
    setEditingId(submissionId);
    assignmentStore.listSubmissionsForStudent(studentCode).then(setSubmissions);

    // 세부풀이시간을 입력했으면 목표시간과 비교해 결과 계산
    if (isMockExam && showTiming && timingConfig) {
      const results: { label: string; minutes: number; evaluation: TimingEvaluation }[] = [];
      const stepDefs = [
        { cfg: timingConfig.step1, val: submissionPatch.step1Minutes },
        { cfg: timingConfig.step2, val: submissionPatch.step2Minutes },
        { cfg: timingConfig.step3, val: submissionPatch.step3Minutes },
      ];
      for (const { cfg, val } of stepDefs) {
        if (val != null) {
          results.push({
            label: `${cfg.label} (${cfg.range})`,
            minutes: val,
            evaluation: evaluateStepTiming(val, cfg.targetMinutes),
          });
        }
      }
      setTimingResult(results);
    }

    // 관리자 + 학부모에게 문자 알림 (실패해도 제출 자체는 유지)
    const typeName = types.find((t) => t.id === typeId)?.name ?? "과제";
    const actionWord = wasEditing ? "수정했습니다" : "제출했습니다";
    const message = `[L16] ${studentName} 학생이 "${typeName}" ${effectiveRound}회차 과제를 ${actionWord}.`;
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
            <span className="stamp-sub">L16 RECORDER</span>
          </div>
        </div>
        <h2>과제가 제출됐습니다</h2>
        <p className="muted">관리자와 학부모님께 알림이 발송되었습니다.</p>
        <p className="muted" style={{ fontSize: 13 }}>
          선생님이 확인 후 결과를 문자로 다시 안내해 드립니다.
        </p>
        {timingResult.length > 0 && (
          <div style={{ textAlign: "left", marginTop: 16 }}>
            <h3>세부풀이시간 결과</h3>
            {timingResult.map((r) => (
              <div className="bar-row" key={r.label}>
                <div className="lab">{r.label}</div>
                <div className="val" style={{ width: "auto", flex: 1, textAlign: "left" }}>
                  {r.minutes}분 — {TIMING_EVALUATION_LABELS[r.evaluation]}
                </div>
              </div>
            ))}
          </div>
        )}
        <button className="btn" onClick={onBack} style={{ marginTop: 16 }}>
          처음으로
        </button>
        <div style={{ height: 8 }} />
        <button
          className="btn secondary"
          onClick={() => {
            // 방금 제출/수정한 내용을 폼에 다시 채워서 수정 화면으로
            const last = submissions.find((s) => s.id === editingId);
            if (last) {
              setRound(String(last.round ?? ""));
              setScore(last.score != null ? String(last.score) : "");
              setWrongNumbersText((last.wrongNumbers ?? []).join(", "));
              setItem(last.item ?? "");
              setScope(last.scope ?? "");
              setCompleted(last.completed ?? true);
              setTotalMinutes(last.totalMinutes != null ? String(last.totalMinutes) : "");
              setStep1Minutes(last.step1Minutes != null ? String(last.step1Minutes) : "");
              setStep2Minutes(last.step2Minutes != null ? String(last.step2Minutes) : "");
              setStep3Minutes(last.step3Minutes != null ? String(last.step3Minutes) : "");
            }
            setPickedType(true);
            setDone(false);
          }}
        >
          방금 제출 수정하기
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
      ) : !pickedType ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            제출할 과제를 선택하세요.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {types.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  setTypeId(t.id);
                  setPickedType(true);
                  setEditingId(null);
                  setRound("");
                  setScore("");
                  setWrongNumbersText("");
                  setItem("");
                  setScope("");
                  setCompleted(true);
                  setTotalMinutes("");
                  setStep1Minutes("");
                  setStep2Minutes("");
                  setStep3Minutes("");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "16px 18px",
                  border: "2px solid var(--line-strong)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  background: "var(--paper-raised)",
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: "2px solid var(--mark)",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontWeight: 700 }}>{t.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    지정 {t.targetCount}회 · {isMockExamKind(t) ? "모의고사형" : "일반과제"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <button
            className="btn ghost"
            style={{ marginBottom: 10, padding: "6px 10px" }}
            onClick={() => setPickedType(false)}
          >
            ◀ 다른 과제 선택
          </button>
          <p style={{ fontWeight: 700, marginTop: 0 }}>{selectedType?.name}</p>

          {isMockExam ? (
            <>
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

              {showTiming && timingConfig && (
                <>
                  <label>전체 소요시간 (분, 선택)</label>
                  <input
                    type="number"
                    value={totalMinutes}
                    onChange={(e) => setTotalMinutes(e.target.value)}
                    placeholder="예: 44"
                  />
                  <label>
                    {timingConfig.step1.label} ({timingConfig.step1.range}) 소요시간 (분, 선택)
                  </label>
                  <input
                    type="number"
                    value={step1Minutes}
                    onChange={(e) => setStep1Minutes(e.target.value)}
                    placeholder={`목표 ${timingConfig.step1.targetMinutes}분`}
                  />
                  <label>
                    {timingConfig.step2.label} ({timingConfig.step2.range}) 소요시간 (분, 선택)
                  </label>
                  <input
                    type="number"
                    value={step2Minutes}
                    onChange={(e) => setStep2Minutes(e.target.value)}
                    placeholder={`목표 ${timingConfig.step2.targetMinutes}분`}
                  />
                  <label>
                    {timingConfig.step3.label} ({timingConfig.step3.range}) 소요시간 (분, 선택)
                  </label>
                  <input
                    type="number"
                    value={step3Minutes}
                    onChange={(e) => setStep3Minutes(e.target.value)}
                    placeholder={`목표 ${timingConfig.step3.targetMinutes}분`}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {nextRound}회차로 자동 등록됩니다.
              </p>
              <label>{fieldLabels?.itemLabel ?? "분야명"}</label>
              <input
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="예: 어휘 Day5"
              />
              <label>{fieldLabels?.scopeLabel ?? "학습내용"}</label>
              <input
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="예: 101~150번"
              />
              <label>{fieldLabels?.completedLabel ?? "완수여부"}</label>
              <div className="chips">
                <div
                  className={"chip" + (completed ? " on" : "")}
                  onClick={() => setCompleted(true)}
                >
                  완료
                </div>
                <div
                  className={"chip" + (!completed ? " on" : "")}
                  onClick={() => setCompleted(false)}
                >
                  미완료
                </div>
              </div>
            </>
          )}

          {/* 정밀 분석 질문 */}
          {selectedType && (() => {
            const cat = detectAnalysisCategory(selectedType.name);
            const questions = ANALYSIS_QUESTIONS[cat];
            const catLabel = cat === "vocabulary" ? "어휘" : cat === "grammar" ? "어법" :
              cat === "essay" ? "서술형" : cat === "mockexam" ? "모의고사" : "독해";
            function getAns(qid: string) { return analysisAnswers.find(a => a.questionId === qid); }
            function setAns(qid: string, patch: Partial<AssignmentAnalysisAnswer>) {
              setAnalysisAnswers(prev => {
                const others = prev.filter(a => a.questionId !== qid);
                return [...others, { questionId: qid, ...getAns(qid), ...patch }];
              });
            }
            return (
              <div style={{ marginTop:16, padding:"14px", background:"#f0fdf4",
                borderRadius:10, border:"1px solid #86efac" }}>
                <p style={{ fontSize:13, fontWeight:700, color:"#166534", marginBottom:12 }}>
                  🔬 정밀 분석 — {catLabel}
                </p>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {questions.map(q => (
                    <div key={q.id}>
                      <p style={{ fontSize:12, fontWeight:600, color:"#374151", marginBottom:7 }}>{q.question}</p>
                      {q.type === "rating" && (
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          {[1,2,3,4,5].map(n => (
                            <button key={n} type="button"
                              onClick={() => setAns(q.id, { rating: n })}
                              style={{ width:38, height:38, borderRadius:8, border:"1.5px solid",
                                borderColor: getAns(q.id)?.rating === n ? "#059669" : "#e2e8f0",
                                background: getAns(q.id)?.rating === n ? "#059669" : "#fff",
                                fontSize:18, cursor:"pointer" }}>
                              {["😟","😕","😐","😊","😄"][n-1]}
                            </button>
                          ))}
                          {getAns(q.id)?.rating && (
                            <span style={{ fontSize:11, color:"#059669", fontWeight:600 }}>
                              {["많이 어려워요","조금 어려워요","보통이에요","잘 됐어요","완벽해요"][(getAns(q.id)?.rating??1)-1]}
                            </span>
                          )}
                        </div>
                      )}
                      {q.type === "text" && (
                        <textarea value={getAns(q.id)?.text ?? ""}
                          onChange={e => setAns(q.id, { text: e.target.value })}
                          placeholder="자유롭게 작성해보세요"
                          rows={2}
                          style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                            border:"1px solid #e2e8f0", fontSize:12, resize:"none" as const,
                            boxSizing:"border-box" as const }} />
                      )}
                      {q.type === "choice" && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {(q.choices ?? []).map(ch => (
                            <button key={ch} type="button"
                              onClick={() => setAns(q.id, { choice: ch })}
                              style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600,
                                cursor:"pointer", border:"1.5px solid",
                                borderColor: getAns(q.id)?.choice === ch ? "#059669" : "#e2e8f0",
                                background: getAns(q.id)?.choice === ch ? "#059669" : "#fff",
                                color: getAns(q.id)?.choice === ch ? "#fff" : "#64748b" }}>
                              {ch}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

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

function ExamCompletionCheckScreen({
  studentCode,
  studentName,
  onDone,
}: {
  studentCode: string;
  studentName: string;
  onDone: () => void;
}) {
  const examCheckStore = useMemo(() => createExamCheckStore(), []);
  const [submitting, setSubmitting] = useState(false);

  async function answer(value: ExamCheckAnswer) {
    setSubmitting(true);
    await examCheckStore.submit({
      id: crypto.randomUUID(),
      studentCode,
      studentName,
      answer: value,
      answeredAt: new Date().toISOString(),
    });
    setSubmitting(false);
    onDone();
  }

  return (
    <div className="card">
      <h2>모의고사 성적 접수 확인</h2>
      <p className="sub">{studentName} 학생</p>
      <p className="muted">모의고사 성적 접수가 완료되었나요?</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        <button className="btn" onClick={() => answer("yes")} disabled={submitting}>
          {EXAM_CHECK_ANSWER_LABELS.yes}
        </button>
        <button className="btn secondary" onClick={() => answer("no")} disabled={submitting}>
          {EXAM_CHECK_ANSWER_LABELS.no}
        </button>
        <button className="btn ghost" onClick={() => answer("na")} disabled={submitting}>
          {EXAM_CHECK_ANSWER_LABELS.na}
        </button>
      </div>
    </div>
  );
}
