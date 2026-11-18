import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createQuickEvent, type JudgmentCode, type LessonJudgmentDetail, type LessonJudgmentEvent, type LessonJudgmentEventType, type LessonJudgmentRevision, type QuickOutcome, type ReasonTag } from "../../core/lessonJudgment";
import type { LessonJudgmentStore } from "../../lib/lessonJudgmentStore";

type Props = { studentCode: string | null; sessionRef: string | null; lessonDate: string; store: LessonJudgmentStore };

const outcomes: { label: string; value: QuickOutcome }[] = [
  { label: "정답", value: "correct" }, { label: "오답", value: "incorrect" },
  { label: "판단 보류", value: "hold" }, { label: "미확인", value: "unverified" },
];
const reasons: { label: string; value: ReasonTag }[] = [
  { label: "어휘", value: "vocabulary" }, { label: "문장 구조", value: "sentence_structure" },
  { label: "논리", value: "logic" }, { label: "추론", value: "inference" },
  { label: "선지 판단", value: "choice_judgment" }, { label: "시간", value: "time" }, { label: "기타", value: "other" },
];
const judgments: { label: string; value: JudgmentCode; eventType: LessonJudgmentEventType }[] = [
  { label: "J-01 판단 변경", value: "J-01", eventType: "judgment_changed" },
  { label: "J-02 새 발견", value: "J-02", eventType: "new_discovery" },
  { label: "J-03 설명 효과", value: "J-03", eventType: "explanation_effect" },
  { label: "J-04 후속 검토", value: "J-04", eventType: "follow_up_review" },
];
const emptyDetail: LessonJudgmentDetail = {
  initialHypothesis: "", observedFact: "", studentStatement: "", teacherInterpretation: "",
  revisionReason: "", strategyApplied: "", observedOutcome: "", nextHypothesis: "",
};
const detailDraftKey = (eventId: string) => `l16.lessonJudgment.detailDraft.v1:${eventId}`;

export default function LessonJudgmentCapture({ studentCode, sessionRef, lessonDate, store }: Props) {
  const [events, setEvents] = useState<LessonJudgmentEvent[]>([]);
  const [revisions, setRevisions] = useState<LessonJudgmentRevision[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [itemId, setItemId] = useState("");
  const [selectedReasons, setSelectedReasons] = useState<ReasonTag[]>([]);
  const [detail, setDetail] = useState<LessonJudgmentDetail>(emptyDetail);
  const [planFocus, setPlanFocus] = useState("");
  const [planStrategy, setPlanStrategy] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<{ count: number; oldestQueuedAt: string | null }>({ count: 0, oldestQueuedAt: null });
  const [queuedEventIds, setQueuedEventIds] = useState<string[]>([]);
  const lastQuickAction = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    const [eventRows, queueStatus, queuedIds] = await Promise.all([
      store.listEvents(studentCode ? { studentCode } : { lessonDate }),
      store.getOutboxStatus(),
      store.listQueuedEventIds(),
    ]);
    setEvents(eventRows);
    setQueue(queueStatus);
    setQueuedEventIds(queuedIds);
    setSelectedId((old) => eventRows.some((event) => event.eventId === old) ? old : eventRows[0]?.eventId ?? "");
  }, [store, studentCode, lessonDate]);

  useEffect(() => { void refresh().catch((error) => setNotice(`판단 기록을 불러오지 못했습니다: ${String((error as Error).message ?? error)}`)); }, [refresh]);
  useEffect(() => {
    setItemId("");
    setSelectedReasons([]);
    setPlanFocus("");
    setPlanStrategy("");
  }, [studentCode, sessionRef, lessonDate]);

  const selectedEvent = useMemo(() => events.find((event) => event.eventId === selectedId) ?? null, [events, selectedId]);
  const selectedRevision = revisions[revisions.length - 1];
  const selectedItemHistory = useMemo(() => selectedEvent?.itemId
    ? events.filter((event) => event.itemId === selectedEvent.itemId).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    : [], [events, selectedEvent]);
  const planForItem = useMemo(() => selectedEvent?.itemId ? events.find((event) => event.eventType === "lesson_plan_saved" && event.itemId === selectedEvent.itemId && event.lessonDate === selectedEvent.lessonDate) : undefined, [events, selectedEvent]);
  const actualForItem = useMemo(() => selectedEvent?.itemId ? events.find((event) => event.eventType === "lesson_review_saved" && event.itemId === selectedEvent.itemId && event.lessonDate === selectedEvent.lessonDate) : undefined, [events, selectedEvent]);
  useEffect(() => {
    let active = true;
    if (!selectedEvent) { setRevisions([]); setDetail(emptyDetail); return; }
    void store.listRevisions(selectedEvent.eventId).then((rows) => {
      if (!active) return;
      setRevisions(rows);
      let draft: LessonJudgmentDetail | null = null;
      try {
        const raw = localStorage.getItem(detailDraftKey(selectedEvent.eventId));
        if (raw) draft = { ...emptyDetail, ...JSON.parse(raw) } as LessonJudgmentDetail;
      } catch { /* Keep the immutable saved revision if the local draft is malformed. */ }
      setDetail(draft ?? rows[rows.length - 1]?.detail ?? selectedEvent.detail ?? emptyDetail);
    }).catch(() => { if (active) setNotice("상세 이력을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [store, selectedEvent]);

  async function saveEvent(event: LessonJudgmentEvent) {
    setBusy(true); setNotice("");
    try {
      const result = await store.appendEvent(event);
      if (event.eventType === "lesson_review_saved" && selectedEvent) localStorage.removeItem(detailDraftKey(selectedEvent.eventId));
      setSelectedId(event.eventId);
      await refresh();
      setNotice(result === "queued" ? "기기에 저장했고 서버 전송 대기 중입니다." : "판단 기록을 저장했습니다.");
    } catch (error) { setNotice(`저장 실패: ${String((error as Error).message ?? error)}`); }
    finally { setBusy(false); }
  }

  function quickEvent(eventType: LessonJudgmentEventType, outcome?: QuickOutcome, judgmentCode?: JudgmentCode) {
    const signature = JSON.stringify([studentCode, lessonDate, sessionRef, itemId.trim() || null, eventType, outcome, judgmentCode, [...selectedReasons].sort()]);
    const timestamp = Date.now();
    const previous = lastQuickAction.current.get(signature);
    if (previous !== undefined && timestamp - previous < 650) {
      setNotice("같은 판단이 연속 입력되어 한 건만 기록했습니다.");
      return;
    }
    lastQuickAction.current.set(signature, timestamp);
    const event = createQuickEvent({
      eventType, lessonDate, studentCode, sessionRef, itemId: itemId.trim() || null,
      outcome, reasonTags: eventType === "item_outcome" ? selectedReasons : undefined,
    });
    if (judgmentCode) event.judgmentCode = judgmentCode;
    void saveEvent(event);
  }

  async function saveRevision() {
    if (!selectedEvent) { setNotice("먼저 상세 내용을 보완할 판단 기록을 선택해 주세요."); return; }
    setBusy(true); setNotice("");
    const revision: LessonJudgmentRevision = {
      revisionId: crypto.randomUUID(), eventId: selectedEvent.eventId,
      revisionNo: (revisions[revisions.length - 1]?.revisionNo ?? 0) + 1,
      createdAt: new Date().toISOString(), createdBy: "local-device", detail,
    };
    try {
      await store.appendRevision(revision);
      localStorage.removeItem(detailDraftKey(selectedEvent.eventId));
      const next = await store.listRevisions(selectedEvent.eventId);
      setRevisions(next); setDetail(next[next.length - 1]?.detail ?? detail); setNotice("상세 내용을 새 이력으로 추가했습니다.");
    } catch (error) { setNotice(`상세 이력 저장 실패: ${String((error as Error).message ?? error)}`); }
    finally { setBusy(false); }
  }

  function savePlan() {
    const event = createQuickEvent({ eventType: "lesson_plan_saved", lessonDate, studentCode, sessionRef, itemId: itemId.trim() || null });
    event.detail = { ...emptyDetail, initialHypothesis: planFocus, strategyApplied: planStrategy };
    void saveEvent(event);
  }

  function saveActual() {
    const event = createQuickEvent({ eventType: "lesson_review_saved", lessonDate, studentCode, sessionRef, itemId: itemId.trim() || null });
    event.detail = { ...detail };
    void saveEvent(event);
  }

  async function retryQueue() {
    setBusy(true);
    try {
      const result = await store.flushOutbox();
      await refresh();
      setNotice(`전송 완료 ${result.synced}건 · 대기 ${result.remaining}건`);
    } catch (error) { setNotice(`재전송에 실패했습니다: ${String((error as Error).message ?? error)}`); }
    finally { setBusy(false); }
  }

  async function deleteQueuedEvent() {
    if (!selectedEvent || !window.confirm("이 판단 기록과 연결된 미전송 기록을 이 기기에서 삭제할까요? 서버에 이미 저장된 기록은 삭제되지 않습니다.")) return;
    try {
      await store.deleteQueuedEvent(selectedEvent.eventId);
      await refresh();
      setNotice("선택한 미전송 기록을 이 기기에서 삭제했습니다.");
    } catch (error) { setNotice(`대기 기록 삭제 실패: ${String((error as Error).message ?? error)}`); }
  }

  const buttonStyle: React.CSSProperties = { border: "1px solid #cbd7e8", borderRadius: 9, padding: "9px 11px", background: "#fff", color: "#263d60", fontWeight: 700, minHeight: 40, cursor: "pointer" };
  const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d8e0eb", borderRadius: 8, padding: "9px 10px", font: "inherit" };
  const labelStyle: React.CSSProperties = { display: "grid", gap: 5, fontSize: 11, color: "#52647d", fontWeight: 700 };
  const rowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 7 };
  const eventLabel = (event: LessonJudgmentEvent) => event.outcome ? outcomes.find((item) => item.value === event.outcome)?.label : event.judgmentCode ?? event.eventType.replace(/_/g, " ");
  const changeDetail = (key: keyof LessonJudgmentDetail, value: string) => {
    const next = { ...detail, [key]: value };
    setDetail(next);
    if (selectedEvent) {
      try { localStorage.setItem(detailDraftKey(selectedEvent.eventId), JSON.stringify(next)); }
      catch { setNotice("상세 초안을 기기에 저장하지 못했습니다. 학생·수업을 이동하기 전에 저장해 주세요."); }
    }
  };
  const field = (key: keyof LessonJudgmentDetail, label: string, placeholder: string) => <label key={key} style={labelStyle}>{label}<textarea aria-label={label} style={{ ...inputStyle, minHeight: 58, resize: "vertical" }} value={detail[key]} placeholder={placeholder} onChange={(e) => changeDetail(key, e.target.value)}/></label>;

  return <section aria-label="HELIX 판단 기록" style={{ marginTop: 14, padding: 14, border: "1px solid #c9d8ef", borderRadius: 13, background: "linear-gradient(135deg,#f2f7ff,#fff 68%)", color: "#172b4d", display: "grid", gap: 12 }}>
    <style>{`@media(max-width:520px){.l16-judgment-grid{grid-template-columns:1fr!important}.l16-judgment-btns button{flex:1 1 calc(50% - 8px)}}`}</style>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10, flexWrap: "wrap" }}>
      <div><strong style={{ fontSize: 14 }}>HELIX 수업 판단</strong><div style={{ fontSize: 10, color: "#64758d", marginTop: 3 }}>교사의 관찰을 빠르게 남기고, 사실·해석·다음 가설을 별도 이력으로 보완합니다.</div><div style={{ fontSize: 10, color: "#73839a", marginTop: 3 }}>학생 이름·연락처는 적지 말고 사실과 해석을 구분해 입력하세요. 미전송 기록과 상세 초안은 이 브라우저에 저장됩니다.</div></div>
      <span style={{ borderRadius: 20, padding: "5px 9px", background: "#e8f0ff", fontSize: 10, fontWeight: 700 }}>{studentCode || "학생 미지정"} · {lessonDate}</span>
    </div>
    <label style={{ ...labelStyle, maxWidth: 420 }}>문항 ID (선택)<input aria-label="문항 ID" style={inputStyle} value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="문항과 연결하지 않아도 바로 기록됩니다."/></label>
    <div><div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>문항 결과 · 한 번 눌러 기록</div><div className="l16-judgment-btns" style={rowStyle}>{outcomes.map((item) => <button key={item.value} type="button" style={buttonStyle} onClick={() => quickEvent("item_outcome", item.value)}>{item.label}</button>)}</div><div style={{ ...rowStyle, marginTop: 7 }}>{reasons.map((item) => <button key={item.value} type="button" aria-pressed={selectedReasons.includes(item.value)} style={{ ...buttonStyle, minHeight: 32, padding: "5px 8px", fontSize: 10, background: selectedReasons.includes(item.value) ? "#dce9ff" : "#fff" }} onClick={() => setSelectedReasons((current) => current.includes(item.value) ? current.filter((value) => value !== item.value) : [...current, item.value])}>{item.label}</button>)}</div></div>
    <div><div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>교사 판단 변경 · J-01~J-04</div><div className="l16-judgment-btns" style={rowStyle}>{judgments.map((item) => <button key={item.value} type="button" style={{ ...buttonStyle, background: "#f4f7fc" }} onClick={() => quickEvent(item.eventType, undefined, item.value)}>{item.value} {item.label.split(" ").slice(1).join(" ")}</button>)}</div></div>

    <div className="l16-judgment-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, borderTop: "1px solid #e1e9f5", paddingTop: 12 }}>
      <div style={{ display: "grid", gap: 8, alignContent: "start" }}><strong style={{ fontSize: 12 }}>수업 계획 스냅샷</strong><label style={labelStyle}>예정 초점<input aria-label="예정 초점" style={inputStyle} value={planFocus} onChange={(e) => setPlanFocus(e.target.value)} placeholder="계획은 계획대로 저장됩니다."/></label><label style={labelStyle}>예정 전략<input aria-label="예정 전략" style={inputStyle} value={planStrategy} onChange={(e) => setPlanStrategy(e.target.value)} placeholder="예: 근거 문장 표시 후 선택지 비교"/></label><button type="button" disabled={busy} style={{ ...buttonStyle, justifySelf: "start" }} onClick={savePlan}>수업 계획 기록</button></div>
    </div>

    <div style={{ borderTop: "1px solid #e1e9f5", paddingTop: 11, display: "grid", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong style={{ fontSize: 12 }}>판단 근거 보완 및 변경 이력</strong><select aria-label="보완할 판단 기록" style={{ ...inputStyle, width: "auto", minWidth: 180, flex: "1 1 180px" }} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">기록 선택</option>{events.map((event) => <option key={event.eventId} value={event.eventId}>{event.recordedAt.slice(11, 16)} · {eventLabel(event)}</option>)}</select></div>
      {selectedEvent ? <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, padding: 9, borderRadius: 9, background: "#f4f7fc", fontSize: 10 }}><div><strong>계획</strong><div style={{ marginTop: 4 }}>{planForItem?.detail.initialHypothesis || "미기록"}</div><div>{planForItem?.detail.strategyApplied || "예정 전략 미기록"}</div></div><div><strong>실제</strong><div style={{ marginTop: 4 }}>{actualForItem?.detail.observedFact || "미기록"}</div><div>{actualForItem?.detail.strategyApplied || "적용 전략 미기록"}</div></div></div>
        <div className="l16-judgment-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>{field("initialHypothesis", "처음 가설", "관찰 전에 세운 잠정 가설")}{field("observedFact", "관찰된 사실", "실제로 확인한 답변·행동")}{field("studentStatement", "학생 발언", "학생의 표현을 가능한 그대로")}{field("teacherInterpretation", "교사 해석", "사실과 분리한 해석")}{field("revisionReason", "판단 변경 이유", "이전 판단과 달라진 근거")}{field("strategyApplied", "적용한 전략", "실제 사용한 설명·훈련")}{field("observedOutcome", "전략 후 결과", "전략 적용 뒤 확인한 반응")}{field("nextHypothesis", "다음 검증 가설", "다음에 확인할 예측")}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ fontSize: 10, color: "#64758d" }}>기존 원터치 기록은 보존됩니다. 상세 저장은 {revisions.length + 1}번째 이력으로 추가됩니다.</span><span style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><button type="button" disabled={busy} style={buttonStyle} onClick={saveActual}>실제 수업 결과 기록</button><button type="button" disabled={busy} style={buttonStyle} onClick={() => void saveRevision()}>상세 이력 저장</button></span></div>
        {selectedItemHistory.length > 1 && <div style={{ padding: 9, border: "1px solid #e1e9f5", borderRadius: 9 }}><strong style={{ fontSize: 10 }}>같은 문항 이력 · {selectedEvent.itemId}</strong><ol style={{ margin: "5px 0 0", paddingLeft: 18, fontSize: 10, color: "#52647d", display: "grid", gap: 4 }}>{selectedItemHistory.map((event) => <li key={event.eventId}>{event.lessonDate} · {eventLabel(event)}{event.detail.strategyApplied ? ` · 전략 ${event.detail.strategyApplied}` : ""}{event.detail.observedOutcome ? ` · 결과 ${event.detail.observedOutcome}` : ""}</li>)}</ol></div>}
        <ol aria-label="판단 타임라인" style={{ margin: 0, paddingLeft: 20, fontSize: 10, color: "#52647d", display: "grid", gap: 4 }}><li>{selectedEvent.recordedAt} · 빠른 기록 · {eventLabel(selectedEvent)}{selectedEvent.itemId ? ` · 문항 ${selectedEvent.itemId}` : " · 문항 미연결"}</li>{revisions.map((revision) => <li key={revision.revisionId}>{revision.createdAt} · 상세 보완 #{revision.revisionNo}{revision.detail.strategyApplied ? ` · 전략: ${revision.detail.strategyApplied}` : ""}</li>)}</ol>
      </> : <div style={{ fontSize: 11, color: "#73839a" }}>오늘 수업에서 기록한 판단이 여기에 시간순으로 표시됩니다.</div>}
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid #e1e9f5" }}><span role="status" aria-live="polite" style={{ fontSize: 10, color: "#52647d" }}>{notice || (queue.count ? `연결 대기 ${queue.count}건 · 최초 대기 ${queue.oldestQueuedAt ?? "시간 미상"} · 자동 만료 없음` : "로컬 기록 상태 정상")}</span>{queue.count > 0 && <span style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><button type="button" disabled={busy} style={buttonStyle} onClick={() => void retryQueue()}>대기 기록 재전송</button>{selectedEvent && queuedEventIds.includes(selectedEvent.eventId) && <button type="button" disabled={busy} style={buttonStyle} onClick={() => void deleteQueuedEvent()}>선택 대기 기록 삭제</button>}</span>}</div>
    {selectedRevision && <span hidden>{selectedRevision.revisionNo}</span>}
  </section>;
}
