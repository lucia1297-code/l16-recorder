/**
 * Neon Postgres 저장 헬퍼
 * 브라우저에서 직접 Postgres에 접속할 수 없으므로
 * Neon의 HTTP API를 사용합니다.
 */

const NEON_URL = import.meta.env.VITE_NEON_DATABASE_URL as string | undefined;

// Neon HTTP API endpoint
function getNeonEndpoint(): string | null {
  if (!NEON_URL) return null;
  // postgresql://user:pass@host/db → https://host/sql
  try {
    const url = new URL(NEON_URL.replace("postgresql://", "https://").replace("postgres://", "https://"));
    return `https://${url.hostname}/sql`;
  } catch {
    return null;
  }
}

function getNeonAuth(): string | null {
  if (!NEON_URL) return null;
  try {
    const url = new URL(NEON_URL.replace("postgresql://", "https://").replace("postgres://", "https://"));
    return btoa(`${url.username}:${url.password}`);
  } catch {
    return null;
  }
}

async function neonQuery(sql: string, params: unknown[] = []): Promise<void> {
  const endpoint = getNeonEndpoint();
  const auth = getNeonAuth();
  if (!endpoint || !auth) {
    console.warn("Neon DB not configured");
    return;
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
        "Neon-Connection-String": NEON_URL!,
      },
      body: JSON.stringify({ query: sql, params }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Neon query error:", err);
    }
  } catch (e) {
    console.error("Neon fetch error:", e);
  }
}

export interface NeonSubmission {
  id: string;
  studentId: string;
  studentName: string;
  school: string;
  grade: string;
  examId: string;
  examName: string;
  examYear: number;
  examMonth: number;
  score: number;
  maxScore: number;
  wrongAnswers: unknown;
  reflection: unknown;
  submittedAt: string;
}

export interface NeonQuestionAttempt {
  submissionId: string;
  studentId: string;
  examId: string;
  questionNo: number;
  chosenOption: string;
  confidenceBefore: number;
  reasonStudent: string;
  evidenceSentence: string;
  missedSignal: string;
  optionElimination: Record<string, string>;
  studentNextAction: string;
  isThreePoint: boolean;
}

export async function saveSubmissionToNeon(s: NeonSubmission): Promise<void> {
  await neonQuery(
    `INSERT INTO l16_student_submissions
      (id, student_id, student_name, school, grade, exam_id, exam_name,
       exam_year, exam_month, score, max_score, wrong_answers, reflection, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      s.id, s.studentId, s.studentName, s.school, s.grade,
      s.examId, s.examName, s.examYear, s.examMonth,
      s.score, s.maxScore,
      JSON.stringify(s.wrongAnswers),
      JSON.stringify(s.reflection),
      s.submittedAt,
    ]
  );
}

export async function saveAttemptToNeon(a: NeonQuestionAttempt): Promise<void> {
  await neonQuery(
    `INSERT INTO question_attempts
      (submission_id, student_id, exam_id, question_no, chosen_option,
       confidence_before, reason_student, evidence_sentence, missed_signal,
       option_elimination, student_next_action, is_three_point)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      a.submissionId, a.studentId, a.examId, a.questionNo, a.chosenOption,
      a.confidenceBefore, a.reasonStudent, a.evidenceSentence, a.missedSignal,
      JSON.stringify(a.optionElimination), a.studentNextAction, a.isThreePoint,
    ]
  );
}
