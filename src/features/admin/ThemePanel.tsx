import { useState } from "react";
import {
  BODY_THEMES, PAGE_BG, applyTheme, getSavedTheme,
  TAB_BG_COLORS, TAB_ACCENT_COLORS, DEFAULT_TAB_BG, DEFAULT_TAB_ACCENT,
  applyTabColors, getSavedTabColors,
} from "../../lib/theme";

function Swatches({ colors, value, onPick }: { colors: { name: string; hex: string }[]; value: string; onPick: (hex: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {colors.map(c => {
        const on = value.toLowerCase() === c.hex;
        return (
          <button key={c.hex} onClick={() => onPick(c.hex)} aria-pressed={on} title={c.name}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", borderRadius: 999,
                     background: "#fff", font: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, color: "var(--ink)",
                     border: on ? "2.5px solid var(--mark)" : "1.5px solid var(--line-strong)" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: c.hex, border: "1px solid rgba(0,0,0,0.15)" }}/>
            {on ? "✓ " : ""}{c.name}
          </button>
        );
      })}
    </div>
  );
}

export default function ThemePanel() {
  const [current, setCurrent] = useState(getSavedTheme());
  const customHex = current.startsWith("custom:") ? current.slice(7) : "#fce4ec";
  const pick = (v: string) => { applyTheme(v, true); setCurrent(v); };
  const [tab, setTab] = useState(getSavedTabColors());
  const pickTab = (next: { bg: string; accent: string }) => { applyTabColors(next.bg, next.accent, true); setTab(next); };

  return (
    <div className="card">
      <h2>화면 색상</h2>
      <div className="sub">본문 카드 색을 고릅니다. 페이지 바탕은 흰색이고, 이 기기에 저장되며 메뉴탭 색은 아래에서 따로 고릅니다.</div>
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

      <h2 style={{ marginTop: 28 }}>메뉴탭 색상</h2>
      <div className="sub">메뉴탭의 바탕색과 선택된 탭의 강조색을 따로 고릅니다. 이 기기에 저장됩니다.</div>

      <label>탭 바탕색</label>
      <Swatches colors={TAB_BG_COLORS} value={tab.bg} onPick={hex => pickTab({ ...tab, bg: hex })}/>
      <label>직접 고르기 (탭 바탕색)</label>
      <input type="color" value={tab.bg} onChange={e => pickTab({ ...tab, bg: e.target.value })}
        style={{ width: 80, height: 44, padding: 4 }} aria-label="탭 바탕색 직접 선택"/>

      <label>선택된 탭 강조색</label>
      <Swatches colors={TAB_ACCENT_COLORS} value={tab.accent} onPick={hex => pickTab({ ...tab, accent: hex })}/>
      <label>직접 고르기 (강조색)</label>
      <input type="color" value={tab.accent} onChange={e => pickTab({ ...tab, accent: e.target.value })}
        style={{ width: 80, height: 44, padding: 4 }} aria-label="탭 강조색 직접 선택"/>

      <div style={{ marginTop: 14 }}>
        <button className="btn secondary" style={{ width: "auto" }}
          onClick={() => pickTab({ bg: DEFAULT_TAB_BG, accent: DEFAULT_TAB_ACCENT })}>탭 색 기본값으로</button>
      </div>
    </div>
  );
}
