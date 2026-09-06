import { useRef, useState, useEffect } from "react";
import { createSmsProvider } from "./lib/smsFactory";
import { runScheduledSms } from "./lib/scheduledSms";
import { useRegisterSW } from "virtual:pwa-register/react";
import StudentFlow from "./features/student/StudentFlow";
import ExamPaperUpload from "./features/student/ExamPaperUpload";
import AdminPanel from "./features/admin/AdminPanel";
import StudentReport from "./features/student/StudentReport";
import { checkAdminAccessCode } from "./core/adminGate";
import { parseReportHash } from "./lib/reportToken";

const GATE_SESSION_KEY = "asx.admin.gate";
const ADMIN_PREVIEW_KEY = "asx.admin.preview";
const TAP_THRESHOLD = 5;
const TAP_WINDOW_MS = 2000;

export default function App() {
  const [role, setRole] = useState<"student" | "admin">("student");

  // ── 예약 문자 자동 발송: 앱 켜지면 즉시 + 1분마다 pending 체크 ──
  useEffect(() => {
    const provider = createSmsProvider();
    const check = () => runScheduledSms(provider).catch(console.warn);
    check();
    const timer = setInterval(check, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // 전역 Promise 오류 캐치 (네트워크 오류 등 미처리 Promise)
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      console.error("[L16] 미처리 Promise 오류:", e.reason);
      // 치명적 오류만 사용자에게 표시 (네트워크 오류 등은 무시)
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  // 전역 JS 오류 캐치
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      console.error("[L16] 전역 오류:", e.message, e.filename, e.lineno);
    };
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);

  // PWA 업데이트 감지
  const [showUpdate, setShowUpdate] = useState(false);
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegistered(r) {
      console.log("[PWA] 등록:", r?.scope);
      // 1분마다 새 버전 체크
      if (r) setInterval(() => r.update(), 60 * 1000);
    },
    onRegisterError(e) { console.warn("[PWA] 오류:", e); },
    onNeedRefresh() { setShowUpdate(true); },
  });
  const [previewMode, setPreviewMode] = useState(false); // 관리자가 학생 화면 미리보기
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

  // 관리자 미리보기 상태 복원
  useEffect(() => {
    if (sessionStorage.getItem(GATE_SESSION_KEY) === "1") {
      setRole("admin");
    }
  }, []);

  function handleTitleTap() {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, TAP_WINDOW_MS);
    if (tapCountRef.current >= TAP_THRESHOLD) {
      tapCountRef.current = 0;
      // 학생체험 모드 중이면 → 관리자로 즉시 복귀
      if (previewMode) {
        exitPreview();
        return;
      }
      // 일반 학생 화면 → 관리자 접속
      if (sessionStorage.getItem(GATE_SESSION_KEY) === "1") {
        setRole("admin");
        setPreviewMode(false);
      } else {
        setShowGatePrompt(true);
      }
    }
  }

  function submitGateCode() {
    const result = checkAdminAccessCode(gateCode, import.meta.env.VITE_ADMIN_ACCESS_CODE as string | undefined);
    if (result.ok) {
      sessionStorage.setItem(GATE_SESSION_KEY, "1");
      setShowGatePrompt(false);
      setGateCode("");
      setGateError("");
      setRole("admin");
      setPreviewMode(false);
    } else {
      setGateError(result.error ?? "접속 코드가 올바르지 않습니다.");
    }
  }

  function enterPreview() {
    setPreviewMode(true);
  }

  function exitPreview() {
    setPreviewMode(false);
  }

  const isAdmin = role === "admin";
  const showStudent = role === "student" || previewMode;

  return (
    <div className="app">
      {/* PWA 업데이트 알림 배너 */}
      {(showUpdate || needRefresh[0]) && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, zIndex:9999,
          background:"linear-gradient(90deg,#1a56db,#1e40af)",
          color:"#fff",
          padding:"12px 20px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:12, fontSize:14, fontWeight:600,
          boxShadow:"0 2px 16px rgba(0,0,0,0.35)",
          animation:"slideDown 0.3s ease"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20 }}>🆕</span>
            <div>
              <div style={{ fontWeight:700, fontSize:15 }}>새 버전이 업데이트됐습니다</div>
              <div style={{ fontSize:12, opacity:0.85, marginTop:1 }}>버튼을 눌러 최신 버전으로 전환하세요.</div>
            </div>
          </div>
          <button
            onClick={() => { updateServiceWorker(true); setTimeout(() => window.location.reload(), 500); }}
            style={{
              padding:"8px 22px", borderRadius:10,
              border:"2px solid #fff", background:"#fff", color:"#1a56db",
              fontWeight:800, fontSize:14, cursor:"pointer",
              flexShrink:0, letterSpacing:"0.02em"
            }}>
            지금 업데이트
          </button>
        </div>
      )}
      <div className="topbar">
        <h1 onClick={handleTitleTap} style={{ cursor: "default", userSelect: "none" }}>
          L16 Student Recorder Lite
        </h1>
        {/* 관리자 미리보기 중 배너 */}
        {isAdmin && previewMode && (
          <button
            onClick={exitPreview}
            style={{
              padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: "#e74c3c", color: "#fff", border: "none",
            }}
          >
            🔴 미리보기 중 — 관리자로 돌아가기
          </button>
        )}
        {/* 관리자 화면에서 미리보기/학생전환 버튼 */}
        {isAdmin && !previewMode && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="role-switch"
              onClick={enterPreview}
              style={{ background: "#f39c12", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              👁 학생 화면 미리보기
            </button>
          </div>
        )}
        {/* 일반 학생 화면에서 관리자 접근 버튼 (숨김) */}
        {role === "admin" && !previewMode && (
          <button className="role-switch" onClick={() => { setRole("student"); }}>
            ← 학생
          </button>
        )}
      </div>

      {/* 관리자 미리보기 안내 배너 */}
      {isAdmin && previewMode && (
        <div style={{
          background: "#fef9e7", border: "2px solid #f39c12", borderRadius: 10,
          padding: "10px 16px", margin: "8px 0", display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>👩‍🎓</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#e67e22", fontSize: 14 }}>
              학생체험 모드 — <span style={{ color: "#e74c3c" }}>감아랑</span> 학생으로 접속 중
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#888" }}>학생과 동일한 화면입니다. 실제 데이터는 저장되지 않습니다. · <strong>제목 5번 탭 → 관리자 복귀</strong></p>
          </div>
          <button
            onClick={exitPreview}
            style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, fontWeight: 700, background: "#e74c3c", color: "#fff", border: "none", cursor: "pointer" }}
          >
            관리자 화면으로
          </button>
        </div>
      )}

      {showGatePrompt && (
        <div className="card">
          <h2>관리자 접속 코드</h2>
          <p className="sub">관리자만 알고 있는 접속 코드를 입력하세요.</p>
          {gateError && <p style={{ color: "var(--red)", fontSize: 14 }}>{gateError}</p>}
          <input
            type="password"
            value={gateCode}
            onChange={(e) => setGateCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitGateCode()}
            placeholder="접속 코드"
          />
          <div style={{ height: 12 }} />
          <div className="nav-buttons">
            <button className="btn secondary" onClick={() => setShowGatePrompt(false)}>취소</button>
            <button className="btn" onClick={submitGateCode}>확인</button>
          </div>
        </div>
      )}

      {/* 리포트 링크 접속 */}
      {reportParams && (
        <StudentReport studentCode={reportParams.studentCode} token={reportParams.token} />
      )}

      {/* 메인 화면 */}
      {!reportParams && !showGatePrompt && (
        <>
          {showStudent && <StudentFlow previewMode={previewMode} />}
          {isAdmin && !previewMode && <AdminPanel />}
        </>
      )}
    </div>
  );
}
