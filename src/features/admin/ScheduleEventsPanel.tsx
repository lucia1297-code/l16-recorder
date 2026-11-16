import { useEffect, useMemo, useState } from "react";

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

type Status = "new" | "assigned" | "in_progress" | "done" | "dismissed";

interface ScheduleEvent {
  id: string;
  created_at: string;
  source: string;
  kind: string;
  student_name: string;
  week_start: string | null;
  summary: string;
  status: Status;
  assigned_to: string;
  task_note: string;
  report: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: "새 변경",
  assigned: "작업 지정됨",
  in_progress: "처리 중",
  done: "완료",
  dismissed: "무시",
};

const STATUS_COLOR: Record<Status, string> = {
  new: "#dc2626",
  assigned: "#ca8a04",
  in_progress: "#0891b2",
  done: "#059669",
  dismissed: "#94a3b8",
};

const KIND_LABEL: Record<string, string> = {
  lesson_schedule_changed: "정규 수업 변경",
  block_added: "시간표 추가·이동",
  block_changed: "시간표 수정",
  block_removed: "시간표 삭제",
  student_added: "학생 등록",
  student_status_changed: "학생 상태 변경",
  needs_decision: "확인 필요",
};

const FILTERS: { key: "open" | "all" | Status; label: string }[] = [
  { key: "open", label: "처리할 것" },
  { key: "new", label: "새 변경" },
  { key: "assigned", label: "작업 지정됨" },
  { key: "in_progress", label: "처리 중" },
  { key: "done", label: "완료" },
  { key: "all", label: "전체" },
];

function fmt(ts: string) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ScheduleEventsPanel() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [filter, setFilter] = useState<"open" | "all" | Status>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ assigned_to: string; task_note: string; report: string }>({
    assigned_to: "",
    task_note: "",
    report: "",
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/schedule_events?select=id,created_at,source,kind,student_name,week_start,summary,status,assigned_to,task_note,report&order=created_at.desc&limit=300`,
        { headers: SB_H }
      );
      if (!res.ok) throw new Error(`불러오기 실패 (${res.status})`);
      setEvents(await res.json());
      setError("");
    } catch (e: any) {
      setError(e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "open") return events.filter(e => e.status === "new" || e.status === "assigned" || e.status === "in_progress");
    return events.filter(e => e.status === filter);
  }, [events, filter]);

  const openCount = events.filter(e => e.status === "new" || e.status === "assigned" || e.status === "in_progress").length;

  function toggle(e: ScheduleEvent) {
    if (openId === e.id) { setOpenId(null); return; }
    setOpenId(e.id);
    setDraft({ assigned_to: e.assigned_to, task_note: e.task_note, report: e.report });
  }

  async function save(e: ScheduleEvent, status: Status) {
    setSaving(true);
    try {
      const res = await fetch(`${SB_URL}/rest/v1/schedule_events?id=eq.${e.id}`, {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ ...draft, status, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`저장 실패 (${res.status})`);
      setError("");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong style={{ fontSize: 16 }}>일정 알림</strong>
          <span style={{ marginLeft: 10, fontSize: 12, color: "#64748b" }}>
            수업 시간·시간표가 바뀌면 자동으로 기록됩니다 (휴대폰·PC 공통)
          </span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: openCount ? "#dc2626" : "#059669" }}>
          처리할 것 {openCount}건
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
        {FILTERS.map(f => (
          <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}
            style={{ padding: "4px 10px", fontSize: 12, borderRadius: 14,
              border: "1px solid #cbd5e1", background: filter === f.key ? "#0f172a" : "#fff",
              color: filter === f.key ? "#fff" : "#334155", width: "auto" }}>
            {f.label}
          </button>
        ))}
        <button onClick={load} style={{ padding: "4px 10px", fontSize: 12, borderRadius: 14, border: "1px solid #cbd5e1", background: "#fff", width: "auto" }}>
          새로고침
        </button>
      </div>

      {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {loading && <div style={{ color: "#94a3b8", fontSize: 13 }}>불러오는 중…</div>}
      {!loading && shown.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13 }}>해당하는 알림이 없습니다.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map(e => (
          <div key={e.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" }}>
            <div onClick={() => toggle(e)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", cursor: "pointer" }}>
              <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{fmt(e.created_at)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[e.status], whiteSpace: "nowrap" }}>
                {STATUS_LABEL[e.status]}
              </span>
              <span style={{ fontSize: 11, color: "#315ba7", whiteSpace: "nowrap" }}>{KIND_LABEL[e.kind] ?? e.kind}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, wordBreak: "break-word" }}>{e.summary}</span>
              {e.assigned_to && <span style={{ fontSize: 11, color: "#ca8a04", whiteSpace: "nowrap" }}>담당 {e.assigned_to}</span>}
            </div>

            {openId === e.id && (
              <div style={{ padding: "8px 10px 12px", borderTop: "1px solid #f1f5f9", display: "grid", gap: 8 }}>
                <label style={{ fontSize: 12, color: "#475569" }}>
                  담당 (예: AR, Codex, 직접)
                  <input value={draft.assigned_to} onChange={ev => setDraft({ ...draft, assigned_to: ev.target.value })} />
                </label>
                <label style={{ fontSize: 12, color: "#475569" }}>
                  작업 지시
                  <textarea rows={2} value={draft.task_note} onChange={ev => setDraft({ ...draft, task_note: ev.target.value })} />
                </label>
                <label style={{ fontSize: 12, color: "#475569" }}>
                  처리 보고
                  <textarea rows={2} value={draft.report} onChange={ev => setDraft({ ...draft, report: ev.target.value })} />
                </label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button disabled={saving} onClick={() => save(e, "assigned")} style={{ width: "auto" }}>작업 지정</button>
                  <button disabled={saving} onClick={() => save(e, "in_progress")} style={{ width: "auto" }}>처리 중</button>
                  <button disabled={saving} onClick={() => save(e, "done")} style={{ width: "auto" }}>완료</button>
                  <button disabled={saving} onClick={() => save(e, "dismissed")} style={{ width: "auto" }}>무시</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
