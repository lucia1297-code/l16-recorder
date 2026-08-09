import { useRef, useState, useEffect } from "react";
import StudentFlow from "./features/student/StudentFlow";
import AdminPanel from "./features/admin/AdminPanel";
import StudentReport from "./features/student/StudentReport";
import { checkAdminAccessCode } from "./core/adminGate";
import { parseReportHash } from "./lib/reportToken";

const GATE_SESSION_KEY = "asx.admin.gate";
const TAP_THRESHOLD = 5;
const TAP_WINDOW_MS = 2000;

export default function App() {
  const [role, setRole] = useState<"student" | "admin">("student");
  const [showGatePrompt, setShowGatePrompt] = useState(false);
  const [gateCode, setGateCode] = useState("");
  const [gateError, setGateError] = useState("");
  const [reportParams, setReportParams] = useState<{ studentCode: string; token: string } | null>(null);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 해시 기반 리포트 라우팅
  useEffect(() => {
    function checkHash() {
      const parsed = parseReportHash();
      setReportParams(parsed);
    }
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, []);

  function handleTitleTap() {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, TAP_WINDOW_MS);

    if (tapCountRef.current >= TAP_THRESHOLD) {
      tapCountRef.current = 0;
      if (sessionStorage.getItem(GATE_SESSION_KEY) === "1") {
        setRole("admin"); // 이번 세션에 이미 코드를 통과했으면 바로 진입
      } else {
        setShowGatePrompt(true);
      }
    }
  }

  function submitGateCode() {
    const result = checkAdminAccessCode(
      gateCode,
      import.meta.env.VITE_ADMIN_ACCESS_CODE as string | undefined,
    );
    if (result.ok) {
      sessionStorage.setItem(GATE_SESSION_KEY, "1");
      setShowGatePrompt(false);
      setGateCode("");
      setGateError("");
      setRole("admin");
    } else {
      setGateError(result.error ?? "접속 코드가 올바르지 않습니다.");
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1 onClick={handleTitleTap} style={{ cursor: "default", userSelect: "none" }}>
          L16 Student Recorder Lite
        </h1>
        {role === "admin" && (
          <button className="role-switch" onClick={() => setRole("student")}>
            ← 학생
          </button>
        )}
      </div>

      {showGatePrompt && (
        <div className="card">
          <h2>관리자 접속 코드</h2>
          <p className="sub">관리자만 알고 있는 접속 코드를 입력하세요.</p>
          {gateError && <p style={{ color: "var(--red)", fontSize: 14 }}>{gateError}</p>}
          <input
            type="password"
            value={gateCode}
            onChange={(e) => setGateCode(e.target.value)}
            placeholder="접속 코드"
          />
          <div style={{ height: 12 }} />
          <div className="nav-buttons">
            <button className="btn secondary" onClick={() => setShowGatePrompt(false)}>
              취소
            </button>
            <button className="btn" onClick={submitGateCode}>
              확인
            </button>
          </div>
        </div>
      )}

      {/* 리포트 링크로 접속한 경우 */}
      {reportParams && (
        <StudentReport studentCode={reportParams.studentCode} token={reportParams.token} />
      )}

      {!reportParams && !showGatePrompt && (role === "student" ? <StudentFlow /> : <AdminPanel />)}
    </div>
  );
}
