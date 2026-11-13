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
