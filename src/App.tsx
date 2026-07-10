import { useState } from "react";
import StudentFlow from "./features/student/StudentFlow";
import AdminPanel from "./features/admin/AdminPanel";

export default function App() {
  const [role, setRole] = useState<"student" | "admin">("student");
  return (
    <div className="app">
      <div className="topbar">
        <h1>ASX Student Recorder Lite</h1>
        <button
          className="role-switch"
          onClick={() => setRole(role === "student" ? "admin" : "student")}
        >
          {role === "student" ? "관리자 →" : "← 학생"}
        </button>
      </div>
      {role === "student" ? <StudentFlow /> : <AdminPanel />}
    </div>
  );
}
