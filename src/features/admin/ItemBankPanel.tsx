import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AXIS_KEYS,
  FLAG_LABEL,
  THRESHOLDS,
  computeAll,
  parseItemsCsv,
  parseResponsesCsv,
  type Grade,
  type Item,
  type ItemStats,
  type Response,
} from "../../core/itemAnalytics";
import { itemBankStore, type ExamSession, type ReviewRow } from "../../lib/itemBankStore";

const GRADE_COLOR: Record<Grade, { bg: string; fg: string }> = {
  A: { bg: "#dcfce7", fg: "#166534" },
  B: { bg: "#dbeafe", fg: "#1e40af" },
  C: { bg: "#fef3c7", fg: "#92400e" },
  D: { bg: "#f1f5f9", fg: "#475569" },
};
const STATUS_LABEL: Record<Item["status"], string> = {
  draft: "검수 전",
  approved: "승인",
  hold: "보류",
  revise: "수정 필요",
};

const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);
const num = (v: number | null, d = 2) => (v == null ? "-" : v.toFixed(d));

const ITEM_TEMPLATE =
  "id,set,school,no,source,points,answer,A1,A2,A3,A4,A5,A6\nGN2-S1-01,Set1,광남고,1,교과서,3,3,2,3,3,2,3,3";
const RESP_TEMPLATE =
  "item_id,student_code,chosen,session\nGN2-S1-01,C0E8E00E,3,2026-11-시범";

export default function ItemBankPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [setFilter, setSetFilter] = useState("전체");
  const [gradeFilter, setGradeFilter] = useState<"전체" | Grade>("전체");
  const [itemText, setItemText] = useState("");
  const [respText, setRespText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [takerCount, setTakerCount] = useState<Record<string, number>>({});
  const [newSet, setNewSet] = useState("");
  const [newSession, setNewSession] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [i, r, v, se, tc] = await Promise.all([
        itemBankStore.listItems(),
        itemBankStore.listResponses(),
        itemBankStore.listReviews(),
        itemBankStore.listSessions(),
        itemBankStore.countBySession(),
      ]);
      setItems(i);
      setResponses(r);
      setReviews(v);
      setSessions(se);
      setTakerCount(tc);
      if (i.length === 0) setGuideOpen(true); // 처음 쓰는 화면이면 안내를 펼쳐 둔다
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const reportCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of reviews) if (r.stage === "report") m[r.itemId] = (m[r.itemId] ?? 0) + 1;
    return m;
  }, [reviews]);

  const stats = useMemo(
    () => computeAll(items, responses, reportCounts),
    [items, responses, reportCounts],
  );

  const sets = useMemo(
    () => ["전체", ...Array.from(new Set(items.map((i) => i.setName))).sort()],
    [items],
  );

  const shown = useMemo(
    () =>
      items
        .filter((i) => setFilter === "전체" || i.setName === setFilter)
        .filter((i) => gradeFilter === "전체" || stats[i.id]?.grade === gradeFilter)
        .sort((a, b) => a.setName.localeCompare(b.setName) || a.questionNo - b.questionNo),
    [items, stats, setFilter, gradeFilter],
  );

  const gradeCount = useMemo(() => {
    const c: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const i of items) c[stats[i.id].grade]++;
    return c;
  }, [items, stats]);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const m = await fn();
      setMsg(m || `${label} 완료`);
      await load();
    } catch (e: any) {
      setErr(`${label} 실패: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }

  const importItems = () =>
    run("문항 등록", async () => {
      const { items: parsed, errors } = parseItemsCsv(itemText);
      if (errors.length) throw new Error(errors.slice(0, 5).join(" / "));
      await itemBankStore.upsertItems(parsed);
      setItemText("");
      return `문항 ${parsed.length}개를 등록했습니다.`;
    });

  const importResponses = () =>
    run("응시 결과 입력", async () => {
      const { responses: parsed, errors } = parseResponsesCsv(respText);
      if (errors.length) throw new Error(errors.slice(0, 5).join(" / "));
      const known = new Set(items.map((i) => i.id));
      const ok = parsed.filter((r) => known.has(r.itemId));
      const skipped = parsed.length - ok.length;
      if (ok.length === 0) throw new Error("등록된 문항과 일치하는 item_id가 없습니다.");
      await itemBankStore.upsertResponses(ok);
      setRespText("");
      return `응시 ${ok.length}건을 입력했습니다.${skipped ? ` (미등록 문항 ${skipped}건 제외)` : ""}`;
    });

  const decide = (it: Item, status: Item["status"], result: "pass" | "fail" | "note") =>
    run("검수 처리", async () => {
      await itemBankStore.setStatus(it.id, status);
      await itemBankStore.addReview(it.id, "owner", result, note.trim());
      setNote("");
      return `${it.id}: ${STATUS_LABEL[status]}`;
    });

  const report = (it: Item) =>
    run("오류 신고 기록", async () => {
      await itemBankStore.addReview(it.id, "report", "note", note.trim());
      setNote("");
      return `${it.id}: 오류 신고 ${(reportCounts[it.id] ?? 0) + 1}건`;
    });

  const card: React.CSSProperties = { marginBottom: 16 };
  const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid #e2e8f0" };

  return (
    <div>
      <div className="card" style={card}>
        <h2 style={{ marginTop: 0 }}>🧪 문항 실측·검수</h2>
        <p style={{ color: "#64748b", marginTop: 0 }}>
          문항마다 6축 설계값과 실측값(정답률·변별도)을 대조하고, 대표 승인을 받은 문항(A등급)만
          판매본으로 씁니다.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {(["A", "B", "C", "D"] as Grade[]).map((g) => (
            <span
              key={g}
              style={{
                background: GRADE_COLOR[g].bg,
                color: GRADE_COLOR[g].fg,
                padding: "4px 10px",
                borderRadius: 999,
                fontWeight: 600,
              }}
            >
              {g}등급 {gradeCount[g]}
            </span>
          ))}
          <span style={{ color: "#64748b" }}>전체 {items.length}문항 · 응시 {responses.length}건</span>
          <button className="btn ghost" onClick={() => void load()} disabled={busy || loading}>
            새로고침
          </button>
        </div>
        <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 0 }}>
          등급(제안): D 응시 {THRESHOLDS.minN}명 미만 · C 플래그 있음 · B 플래그 없음(승인 전) · A
          플래그 없음+대표 승인. 플래그 기준: 정답률 {pct(THRESHOLDS.tooHard)} 미만/
          {pct(THRESHOLDS.tooEasy)} 초과, 변별도 {THRESHOLDS.minDisc} 미만, 신고{" "}
          {THRESHOLDS.reportLimit}건 이상, 설계 기대 정답률과 ±{pct(THRESHOLDS.designGap)} 이상 차이.
        </p>
      </div>

      <div className="card" style={card}>
        <button
          className="btn ghost"
          onClick={() => setGuideOpen((v) => !v)}
          style={{ marginBottom: guideOpen ? 10 : 0 }}
        >
          {guideOpen ? "▾" : "▸"} 사용 방법
        </button>
        {guideOpen && (
          <div style={{ lineHeight: 1.75 }}>
            <p style={{ marginTop: 0 }}>
              <b>언제 쓰나</b> — 시험지를 만든 직후 1단계, 시험을 보고 채점한 뒤 2단계, 다음 세트를
              만들기 전에 3단계로 어떤 문항을 다시 쓸지 고릅니다.
            </p>
            <p>
              <b>1단계 · 문항 등록</b> (아래) — 문항마다 한 줄씩 적습니다. 엑셀에서 복사해 붙여 넣어도
              됩니다. <code>id</code>는 문항마다 달라야 하고, <code>answer</code>는 정답,
              <code> A1~A6</code>은 선생님이 매긴 6축 설계값(1 쉬움 ~ 5 어려움)입니다.
            </p>
            <pre style={{ background: "#f8fafc", padding: 10, overflowX: "auto", fontSize: 12 }}>
{`id,set,school,no,source,points,answer,A1,A2,A3,A4,A5,A6
GN2-S1-01,Set1,광남고,1,교과서,3,3,2,3,3,2,3,3
GN2-S1-02,Set1,광남고,2,모의고사,4,5,4,4,3,4,4,4`}
            </pre>
            <p>
              <b>2단계 · 응시 결과 입력</b> (아래) — 채점한 답안지를 보고 학생이 <b>고른 답</b>만
              적습니다. 맞았는지 틀렸는지는 쓰지 않습니다. 1단계의 정답과 비교해 자동으로 계산합니다.
              <code> session</code>은 회차 이름이라, 같은 문항을 다른 반·다른 달에 또 쓰면 회차만 바꿔
              넣으면 됩니다.
            </p>
            <pre style={{ background: "#f8fafc", padding: 10, overflowX: "auto", fontSize: 12 }}>
{`item_id,student_code,chosen,session
GN2-S1-01,C0E8E00E,3,2026-11-기말
GN2-S1-01,QW3PG99P,5,2026-11-기말`}
            </pre>
            <p>
              <b>3단계 · 확인과 검수</b> (위 표) — 정답률·변별도·등급이 자동으로 뜹니다. 행을 누르면
              승인·보류·수정 필요·오류 신고를 기록할 수 있습니다. 판매본에는 A등급만 씁니다.
            </p>
            <p style={{ marginBottom: 0, color: "#475569" }}>
              <b>저장 위치</b> — 입력한 내용은 L16 Supabase에 남습니다(문항 item_bank, 학생 답
              item_responses, 검수 이력 item_reviews). 화면을 닫거나 다른 기기에서 열어도 그대로
              있습니다. 정답률·등급은 저장하지 않고 열 때마다 다시 계산하므로, 응시 결과를 더 넣으면
              숫자가 바뀝니다.
            </p>
          </div>
        )}
      </div>

      <div className="card" style={card}>
        <h3 style={{ marginTop: 0 }}>시험 회차 — 학생 답안 받기</h3>
        <p style={{ color: "#64748b", marginTop: 0 }}>
          회차를 열면 학생 앱 첫 화면에 "시험 답안 제출"이 뜹니다. 학생이 자기 답을 넣으면 채점과
          통계가 자동으로 계산되므로, 선생님이 답안을 옮겨 적을 일이 없습니다. 시험이 끝나면 닫아
          두세요.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <select value={newSet} onChange={(e) => setNewSet(e.target.value)}>
            <option value="">세트 선택</option>
            {sets
              .filter((x) => x !== "전체")
              .map((x) => (
                <option key={x}>{x}</option>
              ))}
          </select>
          <input
            value={newSession}
            onChange={(e) => setNewSession(e.target.value)}
            placeholder="회차 이름 (예: 2026-11-기말)"
            style={{ minWidth: 200 }}
          />
          <button
            className="btn"
            disabled={busy || !newSet || !newSession.trim()}
            onClick={() =>
              run("회차 열기", async () => {
                const inSet = items.filter((i) => i.setName === newSet);
                await itemBankStore.createSession(
                  newSet,
                  newSession.trim(),
                  inSet[0]?.school ?? "",
                  inSet.length,
                );
                const name = newSession.trim();
                setNewSession("");
                return `"${name}" 회차를 열었습니다. 학생 앱에서 답안을 받을 수 있습니다.`;
              })
            }
          >
            회차 열기
          </button>
        </div>
        {sessions.length === 0 ? (
          <p style={{ color: "#94a3b8", marginBottom: 0 }}>
            아직 연 회차가 없습니다. 문항을 먼저 등록한 뒤 세트를 골라 회차를 여세요.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {sessions.map((se) => (
              <div
                key={se.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: se.isOpen ? "#f0f9ff" : "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <b>{se.sessionName}</b>
                <span style={{ color: "#64748b", fontSize: 13 }}>
                  {se.setName} · {se.questionCount}문항 · 제출 {takerCount[se.sessionName] ?? 0}명
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background: se.isOpen ? "#dcfce7" : "#e2e8f0",
                    color: se.isOpen ? "#166534" : "#475569",
                  }}
                >
                  {se.isOpen ? "받는 중" : "닫힘"}
                </span>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    run(se.isOpen ? "회차 닫기" : "회차 열기", async () => {
                      await itemBankStore.setSessionOpen(se.id, !se.isOpen);
                      return `${se.sessionName}: ${se.isOpen ? "닫았습니다" : "다시 엽니다"}`;
                    })
                  }
                >
                  {se.isOpen ? "닫기" : "열기"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && (
        <div className="card" style={{ ...card, borderColor: "#ef4444", color: "#b91c1c" }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="card" style={{ ...card, color: "#166534" }}>
          {msg}
        </div>
      )}

      <div className="card" style={card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)}>
            {sets.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value as "전체" | Grade)}
          >
            {["전체", "A", "B", "C", "D"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <p style={{ color: "#94a3b8" }}>로딩 중…</p>
        ) : shown.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>
            등록된 문항이 없습니다. 위 "사용 방법"을 펼쳐 보시고, 아래 "1단계 · 문항 등록"부터 시작하세요.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["문항", "세트", "번호", "출처", "설계(6축)", "응시", "정답률", "기대", "변별도", "플래그", "등급", "상태"].map(
                    (h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => {
                  const s: ItemStats = stats[it.id];
                  const open = openId === it.id;
                  return (
                    <Fragment key={it.id}>
                      <tr
                        key={it.id}
                        onClick={() => setOpenId(open ? null : it.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={td}>{it.id}</td>
                        <td style={td}>{it.setName}</td>
                        <td style={td}>{it.questionNo}</td>
                        <td style={td}>{it.source}</td>
                        <td style={td}>{num(s.designDifficulty, 1)}</td>
                        <td style={td}>{s.n}</td>
                        <td style={td}>{pct(s.correctRate)}</td>
                        <td style={td}>{pct(s.expectedRate)}</td>
                        <td style={td}>{num(s.discrimination)}</td>
                        <td style={{ ...td, color: "#b45309" }}>
                          {s.flags.map((f) => FLAG_LABEL[f]).join(", ") || "-"}
                        </td>
                        <td style={td}>
                          <span
                            style={{
                              background: GRADE_COLOR[s.grade].bg,
                              color: GRADE_COLOR[s.grade].fg,
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontWeight: 700,
                            }}
                          >
                            {s.grade}
                          </span>
                        </td>
                        <td style={td}>{STATUS_LABEL[it.status]}</td>
                      </tr>
                      {open && (
                        <tr key={`${it.id}-d`}>
                          <td colSpan={12} style={{ ...td, background: "#f8fafc" }}>
                            <div style={{ marginBottom: 6 }}>
                              <b>6축 설계값</b>{" "}
                              {AXIS_KEYS.map((k) => `${k}=${it.axes[k] ?? "-"}`).join(" · ")} · 정답 {it.answer} ·{" "}
                              {it.points}점
                            </div>
                            <div style={{ marginBottom: 6, color: "#475569" }}>
                              {reviews
                                .filter((r) => r.itemId === it.id)
                                .slice(-5)
                                .map(
                                  (r) =>
                                    `[${r.createdAt.slice(0, 10)} ${r.stage}/${r.result}] ${r.note || "-"}`,
                                )
                                .join("  |  ") || "검수 기록 없음"}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="검수 메모 (선택)"
                                style={{ minWidth: 220 }}
                              />
                              <button className="btn" disabled={busy} onClick={() => decide(it, "approved", "pass")}>
                                승인
                              </button>
                              <button className="btn ghost" disabled={busy} onClick={() => decide(it, "hold", "note")}>
                                보류
                              </button>
                              <button className="btn ghost" disabled={busy} onClick={() => decide(it, "revise", "fail")}>
                                수정 필요
                              </button>
                              <button className="btn ghost" disabled={busy} onClick={() => report(it)}>
                                오류 신고 +1
                              </button>
                            </div>
                            {it.status === "approved" && s.flags.length > 0 && (
                              <p style={{ color: "#b45309", marginBottom: 0 }}>
                                승인했지만 플래그가 있어 A등급이 되지 않습니다.
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={card}>
        <h3 style={{ marginTop: 0 }}>1단계 · 문항 등록</h3>
        <p style={{ color: "#64748b", marginTop: 0 }}>
          쉼표 또는 탭으로 구분하고 첫 줄은 헤더입니다. 필수: id, set, no, answer. A1~A6은 1(쉬움)~5(어려움).
          같은 id를 다시 올리면 설계값만 갱신되고 검수 상태는 유지됩니다.
        </p>
        <textarea
          value={itemText}
          onChange={(e) => setItemText(e.target.value)}
          placeholder={ITEM_TEMPLATE}
          rows={5}
          style={{ width: "100%", fontFamily: "monospace" }}
        />
        <button className="btn" disabled={busy || !itemText.trim()} onClick={importItems}>
          문항 등록
        </button>
        <button className="btn ghost" onClick={() => setItemText(ITEM_TEMPLATE)}>
          예시 채우기
        </button>
      </div>

      <div className="card" style={card}>
        <h3 style={{ marginTop: 0 }}>2단계 · 응시 결과 입력</h3>
        <p style={{ color: "#64748b", marginTop: 0 }}>
          필수: item_id, student_code, chosen(학생이 고른 답). session은 시험 회차 구분용입니다.
          같은 학생·문항·회차를 다시 올리면 덮어씁니다. 정오는 문항의 정답과 비교해 자동 계산됩니다.
        </p>
        <textarea
          value={respText}
          onChange={(e) => setRespText(e.target.value)}
          placeholder={RESP_TEMPLATE}
          rows={5}
          style={{ width: "100%", fontFamily: "monospace" }}
        />
        <button className="btn" disabled={busy || !respText.trim()} onClick={importResponses}>
          응시 결과 입력
        </button>
        <button className="btn ghost" onClick={() => setRespText(RESP_TEMPLATE)}>
          예시 채우기
        </button>
      </div>
    </div>
  );
}
