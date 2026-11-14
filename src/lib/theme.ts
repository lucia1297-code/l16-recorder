// 본문 색상 테마 — 본문 카드 면(--card-face)만 바꾼다. 페이지 바탕(--paper)은 항상 흰색.
// 메뉴탭은 --paper-raised(흰색)를 그대로 쓰므로 영향 없음.
export interface BodyTheme { id: string; name: string; card: string }
export const PAGE_BG = "#ffffff";

export const BODY_THEMES: BodyTheme[] = [
  { id: "pink",   name: "연분홍", card: "#fce4ec" },
  { id: "sky",    name: "하늘빛", card: "#d9ecfa" },
  { id: "mint",   name: "민트",   card: "#d8f3e8" },
  { id: "lemon",  name: "연노랑", card: "#fff3c4" },
  { id: "lilac",  name: "연보라", card: "#e9e1f8" },
  { id: "peach",  name: "살구",   card: "#ffe3d1" },
  { id: "white",  name: "흰색(기존)", card: "#ffffff" },
];

export const DEFAULT_THEME_ID = "pink";
const KEY = "l16.bodyTheme"; // "preset:<id>" 또는 "custom:#rrggbb"

export function getSavedTheme(): string {
  try { return localStorage.getItem(KEY) || `preset:${DEFAULT_THEME_ID}`; } catch { return `preset:${DEFAULT_THEME_ID}`; }
}

export function applyTheme(value: string, persist = false): void {
  let card: string;
  if (value.startsWith("custom:") && /^#[0-9a-fA-F]{6}$/.test(value.slice(7))) {
    card = value.slice(7);
  } else {
    card = (BODY_THEMES.find(x => `preset:${x.id}` === value) ?? BODY_THEMES[0]).card;
  }
  const root = document.documentElement.style;
  root.setProperty("--paper", PAGE_BG);
  root.setProperty("--card-face", card);
  if (persist) { try { localStorage.setItem(KEY, value); } catch { /* 저장 실패는 무시 */ } }
}

// ───────── 메뉴탭 색상 ─────────
// 탭 바탕(--tab-bg)과 선택 탭 강조색(--tab-accent)을 각각 고른다. 값이 없으면 기존 색(CSS 기본값) 그대로.
export interface TabColor { name: string; hex: string }
export const TAB_BG_COLORS: TabColor[] = [
  { name: "흰색(기본)", hex: "#ffffff" },
  { name: "연분홍", hex: "#fce4ec" },
  { name: "하늘빛", hex: "#d9ecfa" },
  { name: "민트",   hex: "#d8f3e8" },
  { name: "연노랑", hex: "#fff3c4" },
  { name: "연보라", hex: "#e9e1f8" },
  { name: "살구",   hex: "#ffe3d1" },
];
export const TAB_ACCENT_COLORS: TabColor[] = [
  { name: "남색(기본)", hex: "#2b4c7e" },
  { name: "분홍", hex: "#d6336c" },
  { name: "파랑", hex: "#1c7ed6" },
  { name: "초록", hex: "#2f9e44" },
  { name: "주황", hex: "#e8590c" },
  { name: "보라", hex: "#7048e8" },
  { name: "진회색", hex: "#495057" },
];
export const DEFAULT_TAB_BG = "#ffffff";
export const DEFAULT_TAB_ACCENT = "#2b4c7e";
const TAB_BG_KEY = "l16.tabBg";
const TAB_ACCENT_KEY = "l16.tabAccent";
const HEX = /^#[0-9a-fA-F]{6}$/;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(c: number[]): string {
  return "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
const mix = (hex: string, target: number, ratio: number) => toHex(rgb(hex).map(c => c + (target - c) * ratio));
function isDark(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 160; // 강조색 위 글자색(흰/검정) 판별
}

export function getSavedTabColors(): { bg: string; accent: string } {
  try {
    const bg = localStorage.getItem(TAB_BG_KEY) || "";
    const ac = localStorage.getItem(TAB_ACCENT_KEY) || "";
    return { bg: HEX.test(bg) ? bg : DEFAULT_TAB_BG, accent: HEX.test(ac) ? ac : DEFAULT_TAB_ACCENT };
  } catch { return { bg: DEFAULT_TAB_BG, accent: DEFAULT_TAB_ACCENT }; }
}

export function applyTabColors(bg: string, accent: string, persist = false): void {
  if (!HEX.test(bg) || !HEX.test(accent)) return;
  const root = document.documentElement.style;
  root.setProperty("--tab-bg", bg);
  root.setProperty("--tab-accent", accent);
  root.setProperty("--tab-accent-deep", mix(accent, 0, 0.3));
  root.setProperty("--tab-accent-tint", mix(accent, 255, 0.85));
  root.setProperty("--tab-accent-text", isDark(accent) ? "#ffffff" : "#1a1a1a");
  if (persist) {
    try { localStorage.setItem(TAB_BG_KEY, bg); localStorage.setItem(TAB_ACCENT_KEY, accent); } catch { /* 저장 실패는 무시 */ }
  }
}
