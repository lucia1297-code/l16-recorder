import { useEffect, useState } from "react";
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
import { useStorage } from "../../lib/useStorage";

const EMPTY_DRAFT: DraftResult = {
  student: {},
  exam: { year: new Date().getFullYear(), totalQuestions: 45, maxScore: 100 },
  teacher: "",
  score: null,
  wrongAnswers: [],
  reflection: {},
  step: 0,
};

const STEPS = ["학생", "학교·학년", "시험", "총점", "오답번호", "오답원인", "회고", "제출"];

export default function StudentFlow() {
  const storage = useStorage();
  const [draft, setDraft] = useState<DraftResult>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  // 최초 로드: 저장된 draft 복구
  useEffect(() => {
    storage.loadDraft().then((d) => {
      if (d) setDraft(d);
      setLoaded(true);
    });
  }, [storage]);

  // 자동 저장 (변경 시마다)
  useEffect(() => {
    if (loaded) storage.saveDraft(draft);
  }, [draft, loaded, storage]);

  const step = draft.step;
  const set = (patch: Partial<DraftResult>) =>
    setDraft((d) => ({ ...d, ...patch }));

  function next() {
    const errs = validateStep(step, draft);
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    set({ step: Math.min(step + 1, STEPS.length - 1) });
  }
  function back() {
    setErrors([]);
    set({ step: Math.max(step - 1, 0) });
  }

  async function submit() {
    const errs = validateStep(6, draft);
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
  }

  if (!loaded) return <div className="card">불러오는 중…</div>;

  if (done) {
    return (
      <div className="card done">
        <div className="check">✅</div>
        <h2>제출 완료!</h2>
        <p className="muted">시험 결과가 저장되었습니다.</p>
        <button className="btn" onClick={restart}>
          새로 입력하기
        </button>
      </div>
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

      {step === 0 && <StepStudent draft={draft} set={set} />}
      {step === 1 && <StepSchool draft={draft} set={set} />}
      {step === 2 && <StepExam draft={draft} set={set} />}
      {step === 3 && <StepScore draft={draft} set={set} />}
      {step === 4 && <StepWrongNumbers draft={draft} set={set} />}
      {step === 5 && <StepWrongReasons draft={draft} set={set} />}
      {step === 6 && <StepReflection draft={draft} set={set} />}
      {step === 7 && <StepReview draft={draft} />}

      <div className="nav-buttons">
        {step > 0 && (
          <button className="btn secondary" onClick={back}>
            이전
          </button>
        )}
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
    </div>
  );
}

function validateStep(step: number, d: DraftResult): string[] {
  switch (step) {
    case 0:
      return validateStudentInfo({
        ...d.student,
        school: d.student.school ?? "placeholder",
        grade: d.student.grade ?? "placeholder",
      }).filter((e) => e.includes("학생코드") || e.includes("이름"));
    case 1:
      return validateStudentInfo({
        ...d.student,
        studentCode: d.student.studentCode ?? "x",
        name: d.student.name ?? "x",
      }).filter((e) => e.includes("학교") || e.includes("학년"));
    case 2:
      return validateExamInfo(d.exam);
    case 3:
      return d.score == null || d.score < 0 ? ["총점을 입력하세요."] : [];
    case 4:
      return []; // 오답 0개 허용 (만점)
    case 5:
      return [];
    case 6:
      return validateReflection(d.reflection);
    default:
      return [];
  }
}

// ---------- Step components ----------
type StepProps = { draft: DraftResult; set: (p: Partial<DraftResult>) => void };

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
