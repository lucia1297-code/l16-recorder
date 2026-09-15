# 일일 TODO 알림 (메모장 자동 기록 + 아침 문자 발송)

## 배경 / 목적

관리자가 학생별 일정(시험 시작/종료일, 영어시험일, 직보 예정일, 다음 수업일)을
매번 직접 확인하지 않아도, 다가오는 할 일을 자동으로 알려주는 기능.

- 관리자 패널을 열면 메모장에 "오늘의 할일" 메모가 자동으로 남는다.
- 매일 아침 8시(KST)에 같은 내용을 관리자 휴대폰으로 문자 발송한다.

## 알림 규칙

데이터 소스: `admin_exam_schedules` 테이블 (studentCode, subject, examStart,
examEnd, englishExamDate, reportDeadline, nextLessonDate) + `students` 테이블
(studentCode → name, school).

| 유형 | 기준 | 메시지 형식 |
|---|---|---|
| 수업자료 준비 | nextLessonDate - 1일 | `{학생명} '{과목}' 수업자료 준비가 1일 남았습니다.` |
| 직보 예정 | reportDeadline - 3일 | `{학생명} 직보 예정일이 3일 남았습니다.` |
| 영어시험 | englishExamDate - 2일 | `{학생명} 영어시험 이틀 전날입니다.` |
| 시험 시작 | examStart == 오늘 | `{학교명} 시험 시작일입니다.` |
| 시험 종료 | examEnd == 오늘 | `{학교명} 시험 종료일입니다.` |

시험 시작/종료는 학생 단위가 아니라 **학교+날짜 단위로 중복 제거**한다 — 같은
학교 학생 여러 명이 같은 시험 기간이면 문자에 한 줄만 나온다. 나머지 3개 유형은
학생별로 각각 나온다.

오늘 해당되는 항목이 하나도 없으면 빈 목록을 반환한다 (메모/문자 모두 스킵).

## 컴포넌트

### 1. `src/core/todoRules.ts` (신규)

React·브라우저 API에 의존하지 않는 순수 TS 모듈. 메모장(브라우저)과 문자 발송
스크립트(Node) 양쪽에서 동일하게 import해서 쓴다.

```ts
export interface TodoItem {
  type: "classPrep" | "reportDeadline" | "englishExam" | "examStart" | "examEnd";
  studentCode?: string;      // examStart/examEnd 타입은 학교 단위라 없음
  message: string;
}

export function computeTodos(
  schedules: ExamScheduleRow[],
  roster: RosterEntry[],
  today?: Date,               // 기본값 new Date() — 테스트용으로 주입 가능
): TodoItem[];

export function formatDailyDigest(items: TodoItem[]): string; // 문자/메모 본문용 줄바꿈 join
```

`ExamScheduleRow`, `RosterEntry`는 각각 `ExamPrepPanel.tsx`, `core/roster.ts`에
이미 있는 필드 구조를 그대로 따른다 (새 타입 재정의 없이 최소 형태로 로컬
선언).

### 2. 메모장 자동 기록 (`MemoPanel.tsx` 및 관리자 패널 진입점 수정)

- `TAG_META`에 `할일` 태그 추가 (아이콘: `CheckCircle` 계열, 색상은 기존 팔레트
  중 미사용 톤).
- 관리자 로그인 직후(어느 탭이든 무관하게 한 번) `admin_exam_schedules` +
  `students`를 REST로 읽어 `computeTodos()` 실행.
- 결과가 있으면 `id: "todo-YYYY-MM-DD"` 고정 ID로 로컬 메모를 upsert
  (title: `오늘의 할일 (YYYY-MM-DD)`, body: `formatDailyDigest()` 결과,
  tag: `할일`). 같은 날 이미 만들어져 있으면 다시 안 만든다
  (`localStorage`에 `l16_todo_last_date` 같은 마커로 하루 1회만 계산).
- 기존과 동일하게 `localStorage`(`l16_memos`)에 저장 — 기기별 저장이며 여러
  기기 동기화는 이번 범위 밖.

### 3. 매일 아침 문자 발송

- `.github/workflows/daily-todo-sms.yml` (신규): `schedule: cron: "0 23 * * *"`
  (23:00 UTC = 08:00 KST) + `workflow_dispatch`로 수동 테스트 가능하게.
- `scripts/send-daily-todo-sms.ts` (신규, `tsx`로 실행):
  1. `process.env`의 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`로
     `admin_exam_schedules`, `students`를 REST fetch (기존 `ExamPrepPanel.tsx`가
     쓰는 것과 동일한 헤더 패턴).
  2. `computeTodos()` → `formatDailyDigest()`.
  3. 결과가 비어 있으면 종료 (문자 발송 안 함).
  4. 기존 `src/lib/sms.solapi.ts`의 `SolapiSmsProvider`를
     `process.env`의 `VITE_SOLAPI_*` 값으로 직접 생성해 `VITE_ADMIN_PHONE`으로
     발송. (`sms.solapi.ts`와 `solapiAuth.ts`는 `fetch`/`crypto.subtle`만
     사용해 Node 20에서도 그대로 동작 — 별도 포팅 불필요.)
- `package.json`에 `tsx`를 devDependency로 추가하고, 로컬 수동 테스트용으로
  `"todo:sms": "tsx scripts/send-daily-todo-sms.ts"` 스크립트 추가.
- 워크플로 secrets는 기존 build 워크플로와 동일한 것들을 재사용
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SOLAPI_API_KEY`,
  `VITE_SOLAPI_API_SECRET`, `VITE_SOLAPI_SENDER`, `VITE_ADMIN_PHONE`) — 이미
  레포 secrets에 등록돼 있으므로 추가 설정 불필요.

## 에러 처리

- Solapi 발송 실패 시 스크립트는 에러를 로그로 남기고 non-zero exit —
  GitHub Actions에서 실패로 표시되어 관리자가 Actions 탭에서 인지 가능
  (기존 build 워크플로처럼 별도 알림 채널은 두지 않음, YAGNI).
- 메모장 쪽은 기존 패턴대로 실패해도 조용히 무시(다음 세션에 재시도).

## 테스트

- `src/core/todoRules.test.ts` (Vitest): 5개 규칙 각각의 경계값(D-1/D-3/D-2
  정확히 맞는 날짜, 하루 전/후는 안 걸리는지) + 같은 학교 여러 학생 시험
  시작일 중복 제거 케이스.
- 문자 발송 스크립트 자체는 실제 Solapi 호출을 건드리므로 자동테스트 대상에서
  제외하고, `workflow_dispatch` 수동 실행으로 1회 확인.

## 범위 밖 (이번에 안 하는 것)

- 메모장 여러 기기 동기화 (Supabase 이전) — 별도 요청 시 추후 진행.
- 알림 기준일(D-1/D-3/D-2)을 관리자가 UI에서 직접 바꾸는 설정 화면 — 지금은
  코드에 고정값으로 둠.
