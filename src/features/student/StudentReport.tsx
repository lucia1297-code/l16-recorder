import { useEffect, useMemo, useState } from "react";
import type { ExamResult, WrongReason } from "../../core/types";
import { WRONG_REASON_LABELS } from "../../core/types";
import { verifyReportToken } from "../../lib/reportToken";
import { useStorage } from "../../lib/useStorage";

export default function StudentReport({ studentCode, token }: { studentCode: string; token: string }) {
  const storage = useStorage();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ExamResult[]>([]);

  useEffect(() => {
    verifyReportToken(studentCode, token).then((ok) => {
      setVerified(ok);
      if (ok) {
        storage.listResults().then((all) => {
          setRows(all.filter((r) => r.student.studentCode === studentCode));
        });
      }
    });
  }, [studentCode, token, storage]);

  if (verified === null) return <div className="card"><p className="muted center">확인 중…</p></div>;
  if (!verified) return (
    <div className="card">
      <h2>❌ 접근 불가</h2>
      <p className="muted">유효하지 않은 리포트 링크입니다.</p>
    </div>
  );
  if (rows.length === 0) return (
    <div className="card">
      <h2>📊 내 학습 리포트</h2>
      <p className="muted center">제출된 데이터가 없습니다.</p>
    </div>
  );

  const studentName = rows[0].student.name;

  function getYearMonth(isoDate: string) {
    const d = new Date(isoDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // 월별 집계
  const monthlyData = useMemo(() => {
    const map = new Map<string, {
      submissions: { examName: string; score: number; maxScore: number; date: string; wrongNos: number[] }[];
      wrongFreq: Map<number, { cnt: number; reasons: string[]; isThreePoint: boolean }>;
      reasons: Map<string, number>;
      reflections: { examName: string; hardestReason: string; nextGoal: string; satisfaction: number | string }[];
    }>();

    for (const r of rows) {
      const ym = getYearMonth(r.submittedAt);
      if (!map.has(ym)) map.set(ym, { submissions: [], wrongFreq: new Map(), reasons: new Map(), reflections: [] });
      const m = map.get(ym)!;

      m.submissions.push({
        examName: r.exam.examName,
        score: r.score,
        maxScore: r.exam.maxScore,
        date: new Date(r.submittedAt).toLocaleDateString("ko-KR"),
        wrongNos: r.wrongAnswers.map((w) => w.questionNo).sort((a, b) => a - b),
      });

      for (const w of r.wrongAnswers) {
        const prev = m.wrongFreq.get(w.questionNo);
        const reasons = w.reasons.map((rr) => WRONG_REASON_LABELS[rr as WrongReason] ?? rr);
        if (prev) { prev.cnt++; prev.reasons = [...new Set([...prev.reasons, ...reasons])]; }
        else m.wrongFreq.set(w.questionNo, { cnt: 1, reasons, isThreePoint: w.isThreePoint ?? false });

        for (const reason of w.reasons) {
          const label = WRONG_REASON_LABELS[reason as WrongReason] ?? reason;
          m.reasons.set(label, (m.reasons.get(label) ?? 0) + 1);
        }
      }

      if (r.reflection?.hardestReason || r.reflection?.nextGoal) {
        m.reflections.push({
          examName: r.exam.examName,
          hardestReason: r.reflection?.hardestReason ?? "",
          nextGoal: r.reflection?.nextGoal ?? "",
          satisfaction: r.reflection?.satisfaction ?? "-",
        });
      }
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([ym, data]) => {
      const avgScore = Math.round(data.submissions.reduce((s, x) => s + x.score, 0) / data.submissions.length);
      const avgPct = Math.round(data.submissions.reduce((s, x) => s + (x.score / x.maxScore) * 100, 0) / data.submissions.length);
      const wrongFreq = Array.from(data.wrongFreq.entries()).map(([no, v]) => ({ no, ...v })).sort((a, b) => b.cnt - a.cnt || a.no - b.no);
      const topReasons = Array.from(data.reasons.entries()).map(([label, cnt]) => ({ label, cnt })).sort((a, b) => b.cnt - a.cnt);
      const totalReasonCnt = topReasons.reduce((s, r) => s + r.cnt, 0);
      return { ym, avgScore, avgPct, submissions: data.submissions, wrongFreq, topReasons, totalReasonCnt, reflections: data.reflections };
    });
  }, [rows]);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 16 }}>
      <div style={{ background: "#2c3e50", color: "#fff", borderRadius: 12, padding: "14px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>📊 {studentName}의 학습 리포트</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>L16 Student Recorder</div>
      </div>

      {monthlyData.map(({ ym, avgScore, avgPct, submissions, wrongFreq, topReasons, totalReasonCnt, reflections }) => (
        <div key={ym} style={{ border: "2px solid #e0e0e0", borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ background: "#ecf0f1", padding: "8px 16px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700 }}>📅 {ym.replace("-", "년 ")}월</span>
            <span style={{ fontSize: 13, color: "#666" }}>{submissions.length}회 응시</span>
          </div>

          <div style={{ padding: 16 }}>
            {/* 점수 */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#eaf4fb", borderRadius: 8, padding: "8px 16px", textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#2980b9" }}>{avgScore}점</div>
                <div style={{ fontSize: 12, color: "#888" }}>월평균</div>
              </div>
              <div style={{ background: "#eaf4fb", borderRadius: 8, padding: "8px 16px", textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#2980b9" }}>{avgPct}%</div>
                <div style={{ fontSize: 12, color: "#888" }}>정답률</div>
              </div>
            </div>
            {submissions.map((sub, i) => (
              <div key={i} style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
                {sub.date} | {sub.examName} | {sub.score}/{sub.maxScore}점
              </div>
            ))}

            {/* 틀린 번호 */}
            <div style={{ marginTop: 16, marginBottom: 4, fontWeight: 700, color: "#e74c3c" }}>틀린 번호</div>
            {wrongFreq.length === 0 ? (
              <p style={{ color: "#27ae60", fontSize: 13 }}>오답 없음 🎉</p>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {wrongFreq.map((w) => (
                    <span key={w.no} style={{
                      padding: "4px 10px", borderRadius: 6, fontWeight: 700, fontSize: 13,
                      background: w.cnt > 1 ? "#e74c3c" : w.isThreePoint ? "#e67e22" : "#f0f0f0",
                      color: w.cnt > 1 || w.isThreePoint ? "#fff" : "#333",
                    }}>
                      {w.no}번{w.isThreePoint ? "★" : ""}{w.cnt > 1 ? ` ×${w.cnt}` : ""}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
                  빨강=반복오답 | 주황★=3점문항
                </div>
              </>
            )}

            {/* 오답 원인 */}
            {topReasons.length > 0 && (
              <>
                <div style={{ fontWeight: 700, color: "#8e44ad", marginBottom: 8 }}>오답 원인</div>
                {topReasons.map((r) => (
                  <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ minWidth: 60, fontSize: 13 }}>{r.label}</span>
                    <div style={{ flex: 1, background: "#eee", borderRadius: 4, height: 8 }}>
                      <div style={{ width: `${Math.round(r.cnt / totalReasonCnt * 100)}%`, background: "#8e44ad", height: 8, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12 }}>{Math.round(r.cnt / totalReasonCnt * 100)}%</span>
                  </div>
                ))}
              </>
            )}

            {/* 회고 */}
            {reflections.length > 0 && (
              <>
                <div style={{ fontWeight: 700, color: "#27ae60", marginTop: 14, marginBottom: 8 }}>회고</div>
                {reflections.map((r, i) => (
                  <div key={i} style={{ background: "#f9f9f9", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.examName}</div>
                    {r.hardestReason && <div>어려웠던 점: {r.hardestReason}</div>}
                    {r.nextGoal && <div>다음 목표: {r.nextGoal}</div>}
                    {r.satisfaction !== "-" && <div>만족도: {r.satisfaction}/5</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      ))}

      <div style={{ textAlign: "center", color: "#aaa", fontSize: 12, marginTop: 20 }}>
        L16 Student Recorder
      </div>
    </div>
  );
}
