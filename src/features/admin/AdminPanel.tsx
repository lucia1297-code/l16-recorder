import { useEffect, useMemo, useState } from "react";
import type { ExamResult } from "../../core/types";
import { WRONG_REASON_LABELS } from "../../core/types";
import { computeDashboard, toCSV, percentScore } from "../../core/logic";
import { useStorage } from "../../lib/useStorage";

// 데모용 간단 로그인 (실서비스는 Supabase Auth 로 교체)
const ADMIN_PASSWORD = "asx2026";

export default function AdminPanel() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem("asx.admin") === "1",
  );
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  return <AdminHome />;
}

function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  return (
    <div className="card">
      <h2>관리자 로그인</h2>
      <p className="sub">비밀번호를 입력하세요.</p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비밀번호"
      />
      {err && <p style={{ color: "var(--red)" }}>비밀번호가 틀립니다.</p>}
      <div style={{ height: 12 }} />
      <button
        className="btn"
        onClick={() => {
          if (pw === ADMIN_PASSWORD) {
            sessionStorage.setItem("asx.admin", "1");
            onOk();
          } else setErr(true);
        }}
      >
        로그인
      </button>
      <p className="muted center" style={{ marginTop: 10, fontSize: 13 }}>
        (데모 비밀번호: asx2026 — 실서비스에서 교체)
      </p>
    </div>
  );
}

function AdminHome() {
  const storage = useStorage();
  const [rows, setRows] = useState<ExamResult[]>([]);
  const [tab, setTab] = useState<"list" | "dash">("list");

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
      </div>
      {tab === "list" ? <ResultList rows={rows} /> : <DashboardView rows={rows} />}
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
