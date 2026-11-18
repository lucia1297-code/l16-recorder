# L16 Lesson Judgment Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 L16 수업 화면에 문항 결과와 강사 판단을 원터치로 기록하고, 수업 후 보완 및 변경 이력을 보존한다.

**Architecture:** `LessonOverviewPanel`에서 선택 문맥을 재사용한다. `lesson_judgment_events`는 원터치 이벤트를 멱등 저장하고 `lesson_judgment_revisions`는 상세 보완을 append-only로 보존한다. 오프라인 outbox는 student code만 보유하고, UI는 local/Supabase 저장소 추상화를 사용한다.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase JS v2, Supabase Postgres/RLS, 기존 Vite PWA.

**Spec:** `docs/superpowers/specs/2026-11-18-l16-lesson-judgment-capture-design.md`

## Global Constraints

- 기존 L16 수업 기록, teacher_logs, 메모 연결, item_responses 및 item_sessions의 동작을 변경하지 않는다.
- 원터치 상태와 상세 필드는 첨부 사양의 값과 구분을 사용한다.
- 운영 DB migration 실행, 운영 배포, 실제 학생 데이터 입력·수집은 승인 전 수행하지 않는다.
- 실제 연동되지 않은 ASX API·분석·추천을 구현된 것처럼 표시하지 않는다.
- Supabase 판단 기록은 anon 접근을 허용하지 않는다.

## Review Focus

- 학생/수업/문항 선택 없이 남긴 이벤트가 유실되지 않고 나중에 연결되는지 — Task 2, Task 3.
- 더블 탭과 네트워크 재시도가 같은 UUID의 중복 행을 만들지 않는지 — Task 2.
- 오프라인 저장 후 재접속 때 이벤트가 보존되고 큐가 성공 행만 제거하는지 — Task 2.
- teacher_logs 또는 item_bank 관련 행 삭제·수정 뒤에도 판단 기록 본문이 남는지 — Task 2 migration/contract tests.
- 모바일 폭에서 원터치 버튼과 보완 폼이 화면 밖으로 밀리지 않는지 — Task 3 component tests and build review.

---

### Task 1: 판단 이벤트 도메인과 검증 규칙

**Files:**
- Create: `src/core/lessonJudgment.ts`
- Test: `src/__tests__/lessonJudgment.test.ts`

**Interfaces:**
- Produces: `QuickOutcome`, `JudgmentCode`, `ReasonTag`, `LessonJudgmentEvent`, `LessonJudgmentRevision`, `CreateQuickEventInput`, `createQuickEvent(input, now, id)`.
- `eventType` is `item_outcome | judgment_changed | new_discovery | explanation_effect | follow_up_review | lesson_plan_saved | lesson_review_saved`.
- `LessonJudgmentEvent` has `eventId`, literal `schemaVersion: "1.0"`, `eventType`, `recordedAt`, required ISO `lessonDate`, nullable `studentCode/sessionRef/itemId/itemVersion`, optional `outcome/reasonTags`, `recordStatus`, and an empty-or-filled `detail` object. `LessonJudgmentRevision` has `revisionId`, `eventId`, increasing `revisionNo`, `createdAt`, `createdBy`, and one complete `detail` snapshot.
- `CreateQuickEventInput` accepts `eventType`, `lessonDate`, nullable refs, and only the optional outcome/reason fields valid for the event type. `filter` accepts optional `studentCode`, `lessonDate`, and `itemId`.
- `createQuickEvent` returns schema version `1.0`, status `quick_saved`, required `lessonDate`, selected student/session/item refs or `null`, and empty detail fields; it never invents an observation or interpretation.
- `hold` means the teacher intentionally deferred judgment; `unverified` means correctness/evidence has not been checked yet.

- [x] **Step 1: Write failing tests** for allowed outcomes/codes, nullable refs, required lesson date/event ID/time, distinct `hold`/`unverified` meanings, and separate fact/statement/interpretation/hypothesis fields.
- [x] **Step 2: Run the focused test** with `npx vitest run src/__tests__/lessonJudgment.test.ts`; confirm it fails because the domain module does not exist.
- [x] **Step 3: Implement the types and `createQuickEvent`** with no storage or React dependency.
- [x] **Step 4: Re-run the focused test** and confirm all cases pass.

### Task 2: Idempotent persistence, offline outbox, and SQL migration draft

**Files:**
- Create: `src/lib/lessonJudgmentStore.ts`
- Create: `src/lib/lessonJudgmentStore.local.ts`
- Create: `src/lib/lessonJudgmentStore.supabase.ts`
- Create: `src/lib/lessonJudgmentStoreFactory.ts`
- Create: `src/__tests__/lessonJudgmentStore.test.ts`
- Create: `supabase/migrations/20261118_lesson_judgment_events.sql`
- Modify only if required by the project's export conventions: `src/lib/teacherLogStoreFactory.ts`

**Interfaces:**
- `LessonJudgmentStore.appendEvent(event): Promise<"saved" | "queued">`
- `LessonJudgmentStore.listEvents(filter): Promise<LessonJudgmentEvent[]>`
- `LessonJudgmentStore.appendRevision(revision): Promise<void>`
- `LessonJudgmentStore.listRevisions(eventId): Promise<LessonJudgmentRevision[]>`
- `LessonJudgmentStore.flushOutbox(): Promise<{ synced: number; remaining: number }>`
- `LessonJudgmentStore.getOutboxStatus(): Promise<{ count: number; oldestQueuedAt: string | null }>`
- `LessonJudgmentStore.listQueuedEventIds(): Promise<string[]>`
- `LessonJudgmentStore.deleteQueuedEvent(eventId): Promise<void>`; UI confirms before calling it.
- `createLessonJudgmentStore(): LessonJudgmentStore`; Supabase outbox entries are scoped to the authenticated owner ID.
- Local writes persist first, then remote sync uses the same event UUID as the idempotency key.

- [x] **Step 1: Write failing tests** for one local save, duplicate event retry, disconnected queue retention, successful flush/removal, failed flush retention, explicit deletion after UI confirmation, oldest pending age, append-only revision order, and no name/phone in serialized outbox.
- [x] **Step 2: Run the focused store test** and confirm expected failures.
- [x] **Step 3: Implement the local queue and Supabase adapter**; preserve failed rows, retry the same UUID, show the oldest pending age, avoid automatic expiry, require explicit confirmation to delete unsynced records, and report queued state instead of claiming a server save.
- [x] **Step 4: Add the migration draft** with RLS enabled, authenticated owner-only select/insert, no anon policy, unique event UUID, and revisions without update/delete policy. Keep optional references non-cascading or `ON DELETE SET NULL` so evidence survives parent deletion.
- [x] **Step 5: Re-run store tests** and verify the SQL draft by inspecting exact policies and constraints. Do not execute it against the live database.

### Task 3: In-class quick capture UI

**Files:**
- Create: `src/features/admin/LessonJudgmentCapture.tsx`
- Modify: `src/features/admin/LessonOverviewPanel.tsx`
- Test: `src/__tests__/LessonJudgmentCapture.test.tsx`

**Interfaces:**
- Props: `{ studentCode: string | null; sessionRef: string | null; lessonDate: string; store: LessonJudgmentStore }`.
- Emits item outcome, optional reason tag, and J-01~J-04 events; selected `item_id` is nullable and does not copy item answer/key into the event.

- [x] **Step 1: Write failing interaction tests** for all four result buttons, all four judgment buttons, optional reason selection, no-context capture, saving indicator, and error/queued messages.
- [x] **Step 2: Run the focused component test** and verify failure because the component is absent.
- [x] **Step 3: Implement the compact capture panel** using existing LessonOverviewPanel student/date context and an optional item-ID field. Quick result actions require no free-text input; question-bank search was deferred to avoid loading answer-bearing item rows into this capture component.
- [x] **Step 4: Add it to the selected lesson editor** without altering the existing `TeacherLog` or memo save path.
- [ ] **Step 5: Verify** the responsive capture panel in desktop and 760px/420px browser viewports. Automated interaction tests pass, but direct viewport/device inspection is still pending.

### Task 4: Post-lesson detail and judgment timeline

**Files:**
- Modify: `src/features/admin/LessonJudgmentCapture.tsx`
- Modify: `src/features/admin/LessonOverviewPanel.tsx`
- Test: `src/__tests__/LessonJudgmentCapture.test.tsx`

**Interfaces:**
- `appendRevision` writes a new revision linked to `eventId`; `listRevisions(eventId)` returns every revision in increasing `revisionNo`; it never overwrites the quick event.
- Detail form fields are `initialHypothesis`, `observedFact`, `studentStatement`, `teacherInterpretation`, `revisionReason`, `strategyApplied`, `observedOutcome`, and `nextHypothesis`.

- [x] **Step 1: Write failing tests** for draft fields being optional, each evidence category staying distinct, revision ordering, and prior revision remaining visible after edit.
- [x] **Step 2: Run component tests** and confirm the new revision assertions fail.
- [x] **Step 3: Implement post-lesson expansion and timeline** grouped by lesson date and item reference; keep each quick event visible and append immutable detail revisions. Automated completeness statuses are not inferred.
- [x] **Step 4: Re-run component tests** and verify existing class content, next plan, follow-ups, and linked memo still work.

### Task 5: Plan-versus-actual and same-item strategy history

**Files:**
- Modify: `src/core/lessonJudgment.ts`
- Modify: `src/features/admin/LessonJudgmentCapture.tsx`
- Test: `src/__tests__/lessonJudgment.test.ts`
- Test: `src/__tests__/LessonJudgmentCapture.test.tsx`

**Interfaces:**
- `lesson_plan_saved` captures expected focus, planned item refs, and first strategy as an event.
- `lesson_review_saved` captures observed fact, interpretation, applied strategy, outcome, and next hypothesis as a separate event/revision.
- Timeline queries group by optional student/date/item without ranking students.

- [x] **Step 1: Write failing tests** proving plan snapshots remain unchanged after plan edits, same-item strategies display chronologically, and absent plan data is shown as “미기록” rather than inferred.
- [x] **Step 2: Run focused tests** and confirm the plan/timeline cases fail.
- [x] **Step 3: Implement snapshots and comparison** using event records only; preserve all historical event rows.
- [x] **Step 4: Re-run focused tests** and confirm the exact plan/actual differences are shown without automated diagnosis.

### Task 6: ASX interface contract, regression verification, and handoff report

**Files:**
- Create: `docs/L16_LESSON_JUDGMENT_ASX_CONTRACT.md`
- Create: `docs/reports/2026-11-18-L16-lesson-judgment-claude-review.md`
- Modify only if needed: `src/features/admin/LessonOverviewPanel.tsx`

- [x] **Step 1: Document the export contract** (schema version, stable event ID, refs, evidence categories, consent/purpose boundary, no inferred API endpoint) and mark ASX/HELIX/Teacher Recorder runtime integration as not implemented.
- [x] **Step 2: Run focused tests** for event, store and component modules.
- [x] **Step 3: Run the full existing test suite** with `npm test -- --reporter=dot` and record exact pass/fail totals; distinguish pre-existing failures.
- [x] **Step 4: Run `npm run build`** and record the exit code and warnings.
- [x] **Step 5: Review `git diff` against the approved spec** and verify there are no production DB calls, real student records, deploy config changes, or modifications to unrelated features.
- [x] **Step 6: Write the Claude review report** with checked evidence, not-checked items, files, tests/build, schema migration not applied, deploy not performed, and questions for independent review.

## Verification and release boundary

All source and migration changes remain local to this branch until separately reviewed. This plan does not authorize applying SQL, collecting real class records, sending data to ASX, merging, or deploying. A 90-minute real-class time and omission-rate study is a later opt-in measurement, not part of automated test claims.
