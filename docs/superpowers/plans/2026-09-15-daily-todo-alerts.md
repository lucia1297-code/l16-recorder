# 일일 TODO 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 패널을 열면 다가오는 학생별 일정(시험/직보/영어시험/수업자료)을
메모장에 자동으로 기록하고, 매일 아침 8시(KST)에 같은 내용을 관리자 휴대폰으로
문자 발송한다.

**Architecture:** 판정 규칙을 `src/core/todoRules.ts`에 순수 함수로 한 번만
작성해서, 브라우저(메모장 자동 기록)와 GitHub Actions cron이 실행하는 Node
스크립트(문자 발송) 양쪽에서 그대로 import해서 쓴다. 새 백엔드/DB 테이블은
추가하지 않고 기존 `admin_exam_schedules`/`students` 테이블만 읽는다.

**Tech Stack:** TypeScript, React, Vitest(테스트), Supabase REST(fetch), Solapi
SMS(기존 `sms.solapi.ts` 재사용), GitHub Actions(cron) + tsx(Node에서 TS 실행).

**Spec:** [docs/superpowers/specs/2026-09-15-daily-todo-alerts-design.md](../specs/2026-09-15-daily-todo-alerts-design.md)

## Global Constraints

- 알림 기준일은 고정값: 수업자료 D-1, 직보 D-3, 영어시험 D-2, 시험 시작/종료는 당일.
- 시험 시작/종료 메시지는 학생 단위가 아니라 **학교+날짜 단위로 중복 제거**한다.
- 문자 수신자는 `VITE_ADMIN_PHONE` (기존 시크릿 재사용, 새 시크릿 추가 없음).
- 문자 발송 시각은 08:00 KST (`cron: "0 23 * * *"`).
- 오늘 해당 항목이 하나도 없으면 메모/문자 모두 생성하지 않는다.
- 메모장은 기존과 동일하게 `localStorage`(`l16_memos`)에 저장 — 기기 간 동기화는
  범위 밖.
- 테스트 파일은 기존 컨벤션대로 `src/__tests__/<name>.test.ts`에 둔다
  (`describe`/`it`/`expect` from `vitest`).

---

### Task 1: 판정 규칙 엔진 `src/core/todoRules.ts`

**Files:**
- Create: `src/core/todoRules.ts`
- Test: `src/__tests__/todoRules.test.ts`

**Interfaces:**
- Consumes: `RosterEntry` from `src/core/roster.ts` (이미 존재, 필드:
  `studentCode`, `name`, `school`, ...)
- Produces:
  - `interface TodoScheduleInput { studentCode: string; subject: string; examStart: string; examEnd: string; englishExamDate: string; reportDeadline: string; nextLessonDate: string; }`
  - `type TodoType = "classPrep" | "reportDeadline" | "englishExam" | "examStart" | "examEnd";`
  - `interface TodoItem { type: TodoType; studentCode?: string; message: string; }`
  - `function computeTodos(schedules: TodoScheduleInput[], roster: RosterEntry[], today?: Date): TodoItem[]`
  - `function formatDailyDigest(items: TodoItem[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/todoRules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeTodos, formatDailyDigest, type TodoScheduleInput } from "../core/todoRules";
import type { RosterEntry } from "../core/roster";

function roster(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    studentCode: "S1", name: "정지민", school: "광영고", grade: "3",
    phone: "", teacher: "", note: "", ...overrides,
  };
}

function schedule(overrides: Partial<TodoScheduleInput> = {}): TodoScheduleInput {
  return {
    studentCode: "S1", subject: "영어",
    examStart: "", examEnd: "", englishExamDate: "",
    reportDeadline: "", nextLessonDate: "", ...overrides,
  };
}

const TODAY = new Date("2026-09-15T09:00:00");

describe("computeTodos", () => {
  it("수업자료 준비 — 다음 수업일이 내일이면 알림", () => {
    const items = computeTodos(
      [schedule({ nextLessonDate: "2026-09-16", subject: "독해" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "classPrep", studentCode: "S1", message: "정지민 '독해' 수업자료 준비가 1일 남았습니다." },
    ]);
  });

  it("수업자료 준비 — 이틀 남았으면 알림 없음 (경계값)", () => {
    const items = computeTodos(
      [schedule({ nextLessonDate: "2026-09-17" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("직보 예정 — 3일 남았으면 알림", () => {
    const items = computeTodos(
      [schedule({ reportDeadline: "2026-09-18" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "reportDeadline", studentCode: "S1", message: "정지민 직보 예정일이 3일 남았습니다." },
    ]);
  });

  it("영어시험 — 이틀 남았으면 알림", () => {
    const items = computeTodos(
      [schedule({ englishExamDate: "2026-09-17" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "englishExam", studentCode: "S1", message: "정지민 영어시험 이틀 전날입니다." },
    ]);
  });

  it("시험 시작일 — 오늘이면 학교명으로 알림", () => {
    const items = computeTodos(
      [schedule({ examStart: "2026-09-15" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
    ]);
  });

  it("시험 종료일 — 오늘이면 학교명으로 알림", () => {
    const items = computeTodos(
      [schedule({ examEnd: "2026-09-15" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examEnd", message: "광영고 시험 종료일입니다." },
    ]);
  });

  it("같은 학교 여러 학생 시험 시작일 — 한 번만 알림", () => {
    const items = computeTodos(
      [
        schedule({ studentCode: "S1", examStart: "2026-09-15" }),
        schedule({ studentCode: "S2", examStart: "2026-09-15" }),
      ],
      [roster({ studentCode: "S1" }), roster({ studentCode: "S2", name: "박서연" })],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
    ]);
  });

  it("다른 학교면 시험 시작일 알림이 각각 나온다", () => {
    const items = computeTodos(
      [
        schedule({ studentCode: "S1", examStart: "2026-09-15" }),
        schedule({ studentCode: "S2", examStart: "2026-09-15" }),
      ],
      [roster({ studentCode: "S1" }), roster({ studentCode: "S2", name: "박서연", school: "다른고" })],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
      { type: "examStart", message: "다른고 시험 시작일입니다." },
    ]);
  });

  it("명부에 없는 studentCode는 건너뛴다", () => {
    const items = computeTodos(
      [schedule({ studentCode: "GHOST", examStart: "2026-09-15" })],
      [roster({ studentCode: "S1" })],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("해당 없는 날은 빈 배열", () => {
    const items = computeTodos([schedule()], [roster()], TODAY);
    expect(items).toEqual([]);
  });
});

describe("formatDailyDigest", () => {
  it("메시지를 줄바꿈으로 이어붙인다", () => {
    const digest = formatDailyDigest([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
      { type: "classPrep", studentCode: "S1", message: "정지민 '독해' 수업자료 준비가 1일 남았습니다." },
    ]);
    expect(digest).toBe("광영고 시험 시작일입니다.\n정지민 '독해' 수업자료 준비가 1일 남았습니다.");
  });

  it("빈 배열이면 빈 문자열", () => {
    expect(formatDailyDigest([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/todoRules.test.ts`
Expected: FAIL — `Cannot find module '../core/todoRules'`

- [ ] **Step 3: Write minimal implementation**

Create `src/core/todoRules.ts`:

```ts
import type { RosterEntry } from "./roster";

export interface TodoScheduleInput {
  studentCode: string;
  subject: string;
  examStart: string;
  examEnd: string;
  englishExamDate: string;
  reportDeadline: string;
  nextLessonDate: string;
}

export type TodoType = "classPrep" | "reportDeadline" | "englishExam" | "examStart" | "examEnd";

export interface TodoItem {
  type: TodoType;
  studentCode?: string;
  message: string;
}

function daysUntil(dateStr: string, today: Date): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const todayOnly = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const targetOnly = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((targetOnly - todayOnly) / 86400000);
}

export function computeTodos(
  schedules: TodoScheduleInput[],
  roster: RosterEntry[],
  today: Date = new Date(),
): TodoItem[] {
  const rosterByCode = new Map(roster.map((r) => [r.studentCode, r]));
  const items: TodoItem[] = [];
  const seenExamStart = new Set<string>();
  const seenExamEnd = new Set<string>();

  for (const ex of schedules) {
    const student = rosterByCode.get(ex.studentCode);
    if (!student) continue;

    if (daysUntil(ex.nextLessonDate, today) === 1) {
      items.push({
        type: "classPrep",
        studentCode: ex.studentCode,
        message: `${student.name} '${ex.subject}' 수업자료 준비가 1일 남았습니다.`,
      });
    }
    if (daysUntil(ex.reportDeadline, today) === 3) {
      items.push({
        type: "reportDeadline",
        studentCode: ex.studentCode,
        message: `${student.name} 직보 예정일이 3일 남았습니다.`,
      });
    }
    if (daysUntil(ex.englishExamDate, today) === 2) {
      items.push({
        type: "englishExam",
        studentCode: ex.studentCode,
        message: `${student.name} 영어시험 이틀 전날입니다.`,
      });
    }
    if (daysUntil(ex.examStart, today) === 0) {
      const key = `${student.school}|${ex.examStart}`;
      if (!seenExamStart.has(key)) {
        seenExamStart.add(key);
        items.push({ type: "examStart", message: `${student.school} 시험 시작일입니다.` });
      }
    }
    if (daysUntil(ex.examEnd, today) === 0) {
      const key = `${student.school}|${ex.examEnd}`;
      if (!seenExamEnd.has(key)) {
        seenExamEnd.add(key);
        items.push({ type: "examEnd", message: `${student.school} 시험 종료일입니다.` });
      }
    }
  }
  return items;
}

export function formatDailyDigest(items: TodoItem[]): string {
  return items.map((i) => i.message).join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/todoRules.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/todoRules.ts src/__tests__/todoRules.test.ts
git commit -m "feat: 일일 TODO 판정 규칙 엔진 추가"
```

---

### Task 2: 메모장에 "할일" 태그 추가

**Files:**
- Modify: `src/features/admin/MemoPanel.tsx:1-28` (import 및 `TAG_META`)

**Interfaces:**
- Consumes: 없음 (독립 변경)
- Produces: `TAG_META`에 `할일` 키 추가 — Task 3에서 이 태그명을 그대로 문자열
  리터럴로 사용함.

- [ ] **Step 1: `lucide-react` import에 `CheckCircle2` 추가**

`src/features/admin/MemoPanel.tsx`의 최상단 import를 연다:

```ts
import {
  Search, Plus, Trash2, Save, Bell, BellOff, Tag, Calendar,
  FileText, ChevronLeft, ChevronRight, Download, Star, Lightbulb,
  BookOpen, User, Briefcase, AlertCircle, X
} from "lucide-react";
```

다음으로 교체:

```ts
import {
  Search, Plus, Trash2, Save, Bell, BellOff, Tag, Calendar,
  FileText, ChevronLeft, ChevronRight, Download, Star, Lightbulb,
  BookOpen, User, Briefcase, AlertCircle, X, CheckCircle2
} from "lucide-react";
```

- [ ] **Step 2: `TAG_META`에 `할일` 추가**

기존:

```ts
const TAG_META: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  아이디어: { color: "#92400e", bg: "#fef3c7", icon: <Lightbulb size={12} /> },
  업무:     { color: "#1e40af", bg: "#dbeafe", icon: <Briefcase size={12} /> },
  수업:     { color: "#065f46", bg: "#d1fae5", icon: <BookOpen size={12} /> },
  학생:     { color: "#4c1d95", bg: "#ede9fe", icon: <User size={12} /> },
  중요:     { color: "#991b1b", bg: "#fee2e2", icon: <AlertCircle size={12} /> },
  개인:     { color: "#831843", bg: "#fce7f3", icon: <Star size={12} /> },
};
```

다음으로 교체:

```ts
const TAG_META: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  아이디어: { color: "#92400e", bg: "#fef3c7", icon: <Lightbulb size={12} /> },
  업무:     { color: "#1e40af", bg: "#dbeafe", icon: <Briefcase size={12} /> },
  수업:     { color: "#065f46", bg: "#d1fae5", icon: <BookOpen size={12} /> },
  학생:     { color: "#4c1d95", bg: "#ede9fe", icon: <User size={12} /> },
  중요:     { color: "#991b1b", bg: "#fee2e2", icon: <AlertCircle size={12} /> },
  개인:     { color: "#831843", bg: "#fce7f3", icon: <Star size={12} /> },
  할일:     { color: "#0f766e", bg: "#ccfbf1", icon: <CheckCircle2 size={12} /> },
};
```

- [ ] **Step 3: 타입체크로 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep MemoPanel`
Expected: 출력 없음 (MemoPanel.tsx 관련 에러 없음)

- [ ] **Step 4: Commit**

```bash
git add src/features/admin/MemoPanel.tsx
git commit -m "feat: 메모장에 할일 태그 추가"
```

---

### Task 3: 관리자 로그인 시 오늘의 할일 메모 자동 생성 `dailyTodoMemo.ts`

**Files:**
- Create: `src/features/admin/dailyTodoMemo.ts`
- Test: `src/__tests__/dailyTodoMemo.test.ts`

**Interfaces:**
- Consumes:
  - `computeTodos`, `formatDailyDigest`, `TodoScheduleInput` from
    `../../core/todoRules` (Task 1)
  - `createRosterStore` from `../../lib/rosterStoreFactory` (기존 — `listRoster(): Promise<RosterEntry[]>`)
- Produces: `async function ensureDailyTodoMemo(today?: Date): Promise<void>` —
  Task 4에서 `AdminHome`의 `useEffect`가 호출함.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/dailyTodoMemo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listRosterMock = vi.fn();
vi.mock("../lib/rosterStoreFactory", () => ({
  createRosterStore: () => ({ listRoster: listRosterMock }),
}));

import { ensureDailyTodoMemo } from "../features/admin/dailyTodoMemo";

const TODAY = new Date("2026-09-15T09:00:00");
const MEMOS_KEY = "l16_memos";
const LAST_RUN_KEY = "l16_todo_last_date";

describe("ensureDailyTodoMemo", () => {
  beforeEach(() => {
    localStorage.clear();
    listRosterMock.mockReset();
    listRosterMock.mockResolvedValue([
      { studentCode: "S1", name: "정지민", school: "광영고", grade: "3", phone: "", teacher: "", note: "" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          student_code: "S1", subject: "독해",
          exam_start: "", exam_end: "",
          english_exam_date: "", report_deadline: "",
          next_lesson_date: "2026-09-16",
        },
      ],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("할일이 있으면 today- 고정 id로 메모를 생성한다", async () => {
    await ensureDailyTodoMemo(TODAY);
    const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
    expect(memos).toHaveLength(1);
    expect(memos[0].id).toBe("todo-2026-09-15");
    expect(memos[0].tag).toBe("할일");
    expect(memos[0].body).toBe("정지민 '독해' 수업자료 준비가 1일 남았습니다.");
  });

  it("같은 날 두 번 호출해도 fetch는 한 번만 한다", async () => {
    await ensureDailyTodoMemo(TODAY);
    await ensureDailyTodoMemo(TODAY);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("할일이 없으면 메모를 만들지 않는다", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    await ensureDailyTodoMemo(TODAY);
    const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
    expect(memos).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/dailyTodoMemo.test.ts`
Expected: FAIL — `Cannot find module '../features/admin/dailyTodoMemo'`

- [ ] **Step 3: Write minimal implementation**

Create `src/features/admin/dailyTodoMemo.ts`:

```ts
import { computeTodos, formatDailyDigest, type TodoScheduleInput } from "../../core/todoRules";
import { createRosterStore } from "../../lib/rosterStoreFactory";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const MEMOS_KEY = "l16_memos";
const LAST_RUN_KEY = "l16_todo_last_date";

function todayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchSchedules(): Promise<TodoScheduleInput[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_exam_schedules?select=student_code,subject,exam_start,exam_end,english_exam_date,report_deadline,next_lesson_date`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`admin_exam_schedules fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    subject: r.subject ?? "",
    examStart: r.exam_start ?? "",
    examEnd: r.exam_end ?? "",
    englishExamDate: r.english_exam_date ?? "",
    reportDeadline: r.report_deadline ?? "",
    nextLessonDate: r.next_lesson_date ?? "",
  }));
}

function upsertTodoMemo(dateStr: string, digest: string): void {
  const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
  const id = `todo-${dateStr}`;
  const now = new Date().toISOString();
  const next = [
    { id, title: `오늘의 할일 (${dateStr})`, body: digest, tag: "할일", alarm: "", createdAt: now, updatedAt: now },
    ...memos.filter((m: { id: string }) => m.id !== id),
  ];
  localStorage.setItem(MEMOS_KEY, JSON.stringify(next));
}

export async function ensureDailyTodoMemo(today: Date = new Date()): Promise<void> {
  const dateStr = todayStr(today);
  if (localStorage.getItem(LAST_RUN_KEY) === dateStr) return;

  const [schedules, roster] = await Promise.all([fetchSchedules(), createRosterStore().listRoster()]);
  const items = computeTodos(schedules, roster, today);
  localStorage.setItem(LAST_RUN_KEY, dateStr);
  if (items.length > 0) upsertTodoMemo(dateStr, formatDailyDigest(items));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/dailyTodoMemo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/dailyTodoMemo.ts src/__tests__/dailyTodoMemo.test.ts
git commit -m "feat: 관리자 로그인 시 오늘의 할일 메모 자동 생성"
```

---

### Task 4: `AdminHome`에서 `ensureDailyTodoMemo` 호출

**Files:**
- Modify: `src/features/admin/AdminPanel.tsx:129-135`

**Interfaces:**
- Consumes: `ensureDailyTodoMemo` from `./dailyTodoMemo` (Task 3)
- Produces: 없음 (앱 진입점 배선)

- [ ] **Step 1: import 추가**

`src/features/admin/AdminPanel.tsx` 상단 import 블록 (다른 `../../lib/...`
import들 근처, 예: 16번째 줄 `createRosterStore` import 다음 줄)에 추가:

```ts
import { ensureDailyTodoMemo } from "./dailyTodoMemo";
```

- [ ] **Step 2: `AdminHome`에 useEffect 추가**

기존 (129-135번째 줄):

```tsx
  useEffect(() => {
    storage.listResults().then(setRows);
  }, [storage]);

  useEffect(() => {
    pendingStore.listPending().then((p) => setPendingCount(p.length));
  }, [pendingStore, tab]);
```

다음으로 교체 (새 `useEffect` 한 블록 추가):

```tsx
  useEffect(() => {
    storage.listResults().then(setRows);
  }, [storage]);

  useEffect(() => {
    pendingStore.listPending().then((p) => setPendingCount(p.length));
  }, [pendingStore, tab]);

  useEffect(() => {
    ensureDailyTodoMemo().catch(() => {
      // 실패해도 조용히 무시 — 다음 세션(다음 로그인)에 재시도됨
    });
  }, []);
```

- [ ] **Step 3: 빌드로 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep AdminPanel`
Expected: 출력 없음

- [ ] **Step 4: Commit**

```bash
git add src/features/admin/AdminPanel.tsx
git commit -m "feat: 관리자 홈 진입 시 오늘의 할일 메모 생성 트리거"
```

---

### Task 5: `tsx` devDependency 추가 + 로컬 실행 스크립트

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: 없음
- Produces: `npm run todo:sms` 커맨드 (Task 6에서 만들 스크립트를 실행)

- [ ] **Step 1: devDependency 및 npm script 추가**

`package.json`의 `scripts`와 `devDependencies`를 다음으로 교체:

```json
{
  "name": "l16-student-recorder-lite",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "todo:sms": "tsx scripts/send-daily-todo-sms.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.110.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "xlsx": "^0.18.5",
    "lucide-react": "^1.38.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.3",
    "vite-plugin-pwa": "^0.20.5",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: 설치**

Run: `npm install`
Expected: `tsx`가 `node_modules`에 설치되고 `package-lock.json`이 갱신됨

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: tsx devDependency 추가 (일일 TODO 문자 스크립트용)"
```

---

### Task 6: 매일 아침 문자 발송 스크립트

**Files:**
- Create: `scripts/send-daily-todo-sms.ts`

**Interfaces:**
- Consumes:
  - `computeTodos`, `formatDailyDigest`, `TodoScheduleInput` from
    `../src/core/todoRules` (Task 1)
  - `SolapiSmsProvider` from `../src/lib/sms.solapi` (기존)
  - `RosterEntry` from `../src/core/roster` (기존)
- Produces: 없음 (엔트리포인트 스크립트, Task 7의 워크플로가 실행)

- [ ] **Step 1: 스크립트 작성**

Create `scripts/send-daily-todo-sms.ts`:

```ts
import { computeTodos, formatDailyDigest, type TodoScheduleInput } from "../src/core/todoRules";
import { SolapiSmsProvider } from "../src/lib/sms.solapi";
import type { RosterEntry } from "../src/core/roster";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchSchedules(): Promise<TodoScheduleInput[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_exam_schedules?select=student_code,subject,exam_start,exam_end,english_exam_date,report_deadline,next_lesson_date`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`admin_exam_schedules fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    subject: r.subject ?? "",
    examStart: r.exam_start ?? "",
    examEnd: r.exam_end ?? "",
    englishExamDate: r.english_exam_date ?? "",
    reportDeadline: r.report_deadline ?? "",
    nextLessonDate: r.next_lesson_date ?? "",
  }));
}

async function fetchRoster(): Promise<RosterEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/students?select=student_code,name,school,grade,phone,parent_phone,teacher,note`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`students fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    name: r.name ?? "",
    school: r.school ?? "",
    grade: r.grade ?? "",
    phone: r.phone ?? "",
    parentPhone: r.parent_phone ?? "",
    teacher: r.teacher ?? "",
    note: r.note ?? "",
  }));
}

async function main() {
  const [schedules, roster] = await Promise.all([fetchSchedules(), fetchRoster()]);
  const items = computeTodos(schedules, roster, new Date());

  if (items.length === 0) {
    console.log("오늘 발송할 할일이 없습니다. 문자 발송을 건너뜁니다.");
    return;
  }

  const digest = formatDailyDigest(items);
  const adminPhone = process.env.VITE_ADMIN_PHONE ?? "";
  if (!adminPhone) throw new Error("VITE_ADMIN_PHONE이 설정되지 않았습니다.");

  const provider = new SolapiSmsProvider(
    process.env.VITE_SOLAPI_API_KEY ?? "",
    process.env.VITE_SOLAPI_API_SECRET ?? "",
    process.env.VITE_SOLAPI_SENDER ?? "",
  );
  await provider.send(adminPhone, `[L16] 오늘의 할일\n${digest}`);
  console.log(`문자 발송 완료 (${items.length}건):\n${digest}`);
}

main().catch((err) => {
  console.error("일일 TODO 문자 발송 실패:", err);
  process.exit(1);
});
```

- [ ] **Step 2: 로컬에서 dry-run으로 문법/타입 확인** (실제 발송은 하지 않음 —
      Supabase 자격증명 없이 import 에러만 확인)

Run: `npx tsc --noEmit scripts/send-daily-todo-sms.ts --moduleResolution bundler --module esnext --target es2022 --jsx react-jsx --skipLibCheck`
Expected: 출력 없음 (타입 에러 없음)

- [ ] **Step 3: Commit**

```bash
git add scripts/send-daily-todo-sms.ts
git commit -m "feat: 일일 TODO 문자 발송 스크립트 추가"
```

---

### Task 7: GitHub Actions 일일 cron 워크플로

**Files:**
- Create: `.github/workflows/daily-todo-sms.yml`

**Interfaces:**
- Consumes: `npm run todo:sms` (Task 5, 6), 기존 레포 secrets
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SOLAPI_API_KEY`,
  `VITE_SOLAPI_API_SECRET`, `VITE_SOLAPI_SENDER`, `VITE_ADMIN_PHONE`)
- Produces: 없음 (스케줄 트리거)

- [ ] **Step 1: 워크플로 작성**

Create `.github/workflows/daily-todo-sms.yml`:

```yaml
name: Daily TODO SMS

on:
  schedule:
    - cron: "0 23 * * *"   # 매일 08:00 KST (23:00 UTC 전날)
  workflow_dispatch: {}

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - run: npm run todo:sms
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_SOLAPI_API_KEY: ${{ secrets.VITE_SOLAPI_API_KEY }}
          VITE_SOLAPI_API_SECRET: ${{ secrets.VITE_SOLAPI_API_SECRET }}
          VITE_SOLAPI_SENDER: ${{ secrets.VITE_SOLAPI_SENDER }}
          VITE_ADMIN_PHONE: ${{ secrets.VITE_ADMIN_PHONE }}
```

- [ ] **Step 2: YAML 문법 확인**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/daily-todo-sms.yml'))" || node -e "require('js-yaml') && console.log('skip')" 2>&1 || cat .github/workflows/daily-todo-sms.yml`

(둘 다 없으면 최소한 파일 내용을 눈으로 재확인 — 들여쓰기가 `build-deploy.yml`과
동일한 2-space인지 확인)

Expected: 에러 없이 파싱됨 (또는 육안 검토로 기존 `.github/workflows/*.yml`과
동일한 들여쓰기/구조 확인)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-todo-sms.yml
git commit -m "feat: 일일 TODO 문자 발송 cron 워크플로 추가"
```

---

### Task 8: 전체 검증 + 수동 발송 테스트

**Files:** 없음 (검증 전용, 변경 없음)

**Interfaces:** 없음

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run: `npx vitest run`
Expected: 모든 테스트 PASS (Task 1, 3에서 추가한 테스트 포함, 기존 테스트도
깨지지 않음)

- [ ] **Step 2: 타입체크 + 빌드**

Run: `npx tsc -b && npx vite build`
Expected: 빌드 성공 (기존에 있던 `AdminInputPanel.tsx`/`ExamSchedulePanel.tsx`의
사전 존재하던 타입 에러 2건은 이 작업과 무관 — `tsc -b`가 실패하면 이 두 파일
에러인지 확인하고, 이 작업으로 새로 생긴 에러가 아니면 무시)

- [ ] **Step 3: 푸시 후 GitHub Actions에서 워크플로 수동 실행으로 1회 확인**

```bash
git push origin main
gh workflow run daily-todo-sms.yml
gh run watch
```

Expected: 워크플로 성공, 관리자 휴대폰으로 실제 문자 수신 확인 (오늘 해당되는
항목이 있는 경우) 또는 "오늘 발송할 할일이 없습니다" 로그 (해당 항목이 없는
경우 — 둘 다 정상)

- [ ] **Step 4: 관리자 패널을 열어 메모장에서 "오늘의 할일" 메모 확인**

로컬 `npm run dev` 또는 배포된 사이트에서 관리자 로그인 → 메모장 → `할일` 태그
필터로 오늘 날짜 메모가 있는지 (해당되는 항목이 있는 경우) 확인.
