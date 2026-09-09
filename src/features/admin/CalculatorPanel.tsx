import { useState } from "react";

type Op = "+" | "−" | "×" | "÷";
const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "C", "+"];

export default function CalculatorPanel() {
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [pending, setPending] = useState<Op | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const apply = (x: number, op: Op, y: number) => op === "+" ? x + y : op === "−" ? x - y : op === "×" ? x * y : y === 0 ? null : x / y;
  function press(value: string) {
    if (/^\d$/.test(value) || value === ".") { if (waiting) { setDisplay(value === "." ? "0." : value); setWaiting(false); } else if (value === "." && display.includes(".")) return; else setDisplay(display === "0" && value !== "." ? value : display + value); return; }
    if (value === "C") { setDisplay("0"); setStored(null); setPending(null); setWaiting(false); return; }
    if (["+", "−", "×", "÷"].includes(value)) { const op = value as Op, current = Number(display); if (stored !== null && pending && !waiting) { const next = apply(stored, pending, current); if (next === null) { setDisplay("오류"); setStored(null); setPending(null); setWaiting(true); return; } setStored(next); setDisplay(String(next)); } else setStored(current); setPending(op); setWaiting(true); return; }
    if (value === "=" && stored !== null && pending && !waiting) { const current = Number(display), next = apply(stored, pending, current); if (next === null) { setDisplay("오류"); setStored(null); setPending(null); setWaiting(true); return; } setHistory(prev => [`${stored} ${pending} ${current} = ${next}`, ...prev].slice(0, 20)); setDisplay(String(next)); setStored(null); setPending(null); setWaiting(true); }
  }
  return <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}><h2 style={{ color: "#0f766e", marginTop: 0 }}>🧮 계산기</h2><div style={{ background: "#0f172a", color: "#f8fafc", borderRadius: 12, padding: "18px 16px", textAlign: "right", fontSize: 34, fontWeight: 800, minHeight: 48, overflow: "hidden", wordBreak: "break-all" }}>{display}</div><div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>{keys.map(key => <button key={key} onClick={() => press(key)} style={{ minHeight: 58, borderRadius: 10, border: "1px solid #dbe3ef", background: ["+", "−", "×", "÷"].includes(key) ? "#ede9fe" : key === "C" ? "#fee2e2" : "#f8fafc", color: ["+", "−", "×", "÷"].includes(key) ? "#6d28d9" : key === "C" ? "#b91c1c" : "#1e293b", fontSize: 22, fontWeight: 700, cursor: "pointer" }}>{key}</button>)}<button onClick={() => press("=")} style={{ gridColumn: "1 / -1", minHeight: 58, borderRadius: 10, border: 0, background: "#0f766e", color: "#fff", fontSize: 24, fontWeight: 800, cursor: "pointer" }}>=</button></div>{history.length > 0 && <div style={{ marginTop: 18 }}><strong>계산 기록</strong>{history.map((item, i) => <div key={`${item}-${i}`} style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>{item}</div>)}</div>}</div>;
}
