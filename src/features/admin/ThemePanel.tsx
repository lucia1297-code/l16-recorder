import { useState } from "react";
import { BODY_THEMES, PAGE_BG, applyTheme, getSavedTheme } from "../../lib/theme";

export default function ThemePanel() {
  const [current, setCurrent] = useState(getSavedTheme());
  const customHex = current.startsWith("custom:") ? current.slice(7) : "#fce4ec";
  const pick = (v: string) => { applyTheme(v, true); setCurrent(v); };

  return (
    <div className="card">
      <h2>화면 색상</h2>
      <div className="sub">본문 카드 색을 고릅니다. 페이지 바탕은 흰색이고, 이 기기에 저장되며 메뉴탭 색은 바뀌지 않습니다.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
        {BODY_THEMES.map(t => {
          const on = current === `preset:${t.id}`;
          return (
            <button key={t.id} onClick={() => pick(`preset:${t.id}`)} aria-pressed={on}
              style={{ cursor: "pointer", padding: 0, overflow: "hidden", borderRadius: 14, background: "none",
                       border: on ? "2.5px solid var(--mark)" : "1.5px solid var(--line-strong)", font: "inherit" }}>
              <div style={{ background: PAGE_BG, padding: 10 }}>
                <div style={{ background: t.card, borderRadius: 8, height: 34, border: "1px solid rgba(0,0,0,0.06)" }}/>
              </div>
              <div style={{ padding: "8px 6px", background: "#fff", fontSize: 13, fontWeight: on ? 700 : 500, color: "var(--ink)" }}>
                {on ? "✓ " : ""}{t.name}
              </div>
            </button>
          );
        })}
      </div>
      <label>직접 고르기 (카드 색)</label>
      <input type="color" value={customHex} onChange={e => pick(`custom:${e.target.value}`)}
        style={{ width: 80, height: 44, padding: 4 }} aria-label="카드 색 직접 선택"/>
    </div>
  );
}
