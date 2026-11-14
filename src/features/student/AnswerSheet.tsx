import { useCallback, useEffect, useMemo, useState } from "react";
import { itemBankStore, type ExamSession } from "../../lib/itemBankStore";

const CIRCLES = ["①", "②", "③", "④", "⑤"];

/**
 * 학생 답안 제출 화면.
 * 종이로 시험을 본 뒤 자기 답만 입력한다. 정답은 내려받지 않으므로 채점 결과는 보이지 않는다.
 */
export default function AnswerSheet({
  studentCode,
  studentName,
  onBack,
}: {
  studentCode: string;
  studentName: string;
  onBack: () => void;
}) {
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [picked, setPicked] = useState<ExamSession | null>(null);
  const [items, setItems] = useState<{ id: string; questionNo: number }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    itemBankStore
      .listOpenSessions()
      .then(setSessions)
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  const open = useCallback(
    async (s: ExamSession) => {
      setLoading(true);
      setErr("");
      try {
        const [list, mine] = await Promise.all([
          itemBankStore.listSessionItems(s.setName),
          itemBankStore.myAnswers(studentCode, s.sessionName),
        ]);
        setItems(list);
        setAnswers(mine);
        setPicked(s);
        setDone(false);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [studentCode],
  );

  const filled = useMemo(
    () => items.filter((i) => (answers[i.id] ?? "").trim() !== "").length,
    [items, answers],
  );

  async function submit() {
    if (!picked) return;
    const rows = items
      .filter((i) => (answers[i.id] ?? "").trim() !== "")
      .map((i) => ({
        itemId: i.id,
        studentCode,
        chosen: answers[i.id].trim(),
        session: picked.sessionName,
      }));
    if (rows.length === 0) {
      setErr("답을 하나 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await itemBankStore.upsertResponses(rows);
      setDone(true);
    } catch (e: any) {
      setErr(`제출 실패: ${String(e?.message ?? e)}`);
    } finally {
      setSaving(false);
    }
  }

  const back = (
    <button
      onClick={picked ? () => setPicked(null) : onBack}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        background: "#fff",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      ← 뒤로
    </button>
  );

  if (done) {
    return (
      <div style={{ padding: "0 16px" }}>
        <div
          style={{
            background: "#dcfce7",
            border: "1px solid #86efac",
            borderRadius: 13,
            padding: 20,
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 32 }}>✅</div>
          <div style={{ fontWeight: 700, color: "#166534", marginTop: 6 }}>답안을 제출했습니다</div>
          <div style={{ fontSize: 13, color: "#15803d", marginTop: 4 }}>
            {picked?.sessionName} · {filled}문항
          </div>
        </div>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          채점 결과는 선생님이 확인한 뒤 알려 주십니다. 답을 고치고 싶으면 다시 들어와 제출하면
          됩니다.
        </p>
        <button className="btn" onClick={onBack} style={{ width: "100%" }}>
          처음으로
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        {back}
        <b style={{ fontSize: 15 }}>{picked ? picked.sessionName : "시험 답안 제출"}</b>
      </div>

      {err && (
        <p style={{ color: "#b91c1c", fontSize: 13, background: "#fee2e2", padding: 10, borderRadius: 8 }}>
          {err}
        </p>
      )}
      {loading && <p style={{ color: "#94a3b8" }}>불러오는 중…</p>}

      {!loading && !picked && (
        <>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 0 }}>
            {studentName} 학생, 시험을 본 뒤 자기가 고른 답을 입력하면 됩니다.
          </p>
          {sessions.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>지금 답안을 받는 시험이 없습니다.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => void open(s)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    padding: "14px 16px",
                    borderRadius: 13,
                    background: "#e0f2fe",
                    border: "1px solid #7dd3fc",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      flexShrink: 0,
                      background: "#0284c7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    📝
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#075985" }}>
                      {s.sessionName}
                    </div>
                    <div style={{ fontSize: 11, color: "#0369a1", marginTop: 2 }}>
                      {s.school ? `${s.school} · ` : ""}
                      {s.setName} · {s.questionCount}문항
                    </div>
                  </div>
                  <span style={{ color: "#7dd3fc", fontSize: 18 }}>›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && picked && (
        <>
          <div
            style={{
              position: "sticky",
              top: 0,
              background: "#fff",
              padding: "8px 0",
              zIndex: 2,
              borderBottom: "1px solid #e2e8f0",
              marginBottom: 10,
            }}
          >
            <b style={{ fontSize: 14 }}>
              {filled} / {items.length} 입력
            </b>
            <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>
              서답형은 오른쪽 칸에 직접 쓰면 됩니다
            </span>
          </div>

          {items.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>이 시험에 등록된 문항이 없습니다. 선생님께 알려 주세요.</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {items.map((it) => {
                const v = answers[it.id] ?? "";
                return (
                  <div
                    key={it.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 8px",
                      borderRadius: 10,
                      background: v ? "#f0f9ff" : "#f8fafc",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <b style={{ width: 28, textAlign: "right", fontSize: 14, color: "#334155" }}>
                      {it.questionNo}
                    </b>
                    <div style={{ display: "flex", gap: 3 }}>
                      {CIRCLES.map((c, idx) => {
                        const val = String(idx + 1);
                        const on = v === val;
                        return (
                          <button
                            key={val}
                            onClick={() =>
                              setAnswers((p) => ({ ...p, [it.id]: on ? "" : val }))
                            }
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 8,
                              fontSize: 16,
                              cursor: "pointer",
                              border: on ? "2px solid #0284c7" : "1px solid #cbd5e1",
                              background: on ? "#0284c7" : "#fff",
                              color: on ? "#fff" : "#475569",
                            }}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      value={CIRCLES.some((_, i) => String(i + 1) === v) ? "" : v}
                      onChange={(e) =>
                        setAnswers((p) => ({ ...p, [it.id]: e.target.value }))
                      }
                      placeholder="서답형"
                      style={{
                        flex: 1,
                        minWidth: 60,
                        padding: "6px 8px",
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        fontSize: 13,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <button
            className="btn"
            onClick={submit}
            disabled={saving || items.length === 0}
            style={{ width: "100%", marginTop: 16, marginBottom: 24 }}
          >
            {saving ? "제출 중…" : `답안 제출 (${filled}문항)`}
          </button>
        </>
      )}
    </div>
  );
}
