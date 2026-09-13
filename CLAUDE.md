# Working Memory - L16 Recorder Project

## 🚨🚨 MOST IMPORTANT RULE — READ THIS FIRST 🚨🚨

**This app is used via GitHub Pages (deployed build), NOT the local dev server.**
A code edit is NOT "done" until it has been `git add` / `git commit` / `git push`ed to
`origin/main`. Verifying in the local `npm run dev` browser preview, or even querying
Supabase directly to confirm data, proves NOTHING about what the user actually sees —
the user only sees what's been pushed and rebuilt by GitHub Actions.

**This exact mistake (editing code, testing locally, reporting "done", but never
committing/pushing) has already happened TWICE in this project** — once on
2026-09-12 with ExamSchedulePanel, and again on 2026-09-12 with the assignment
analysis-question feature, where the user had to explicitly ask "정밀분석이 보이지
않는다" before the missing push was discovered. See Related Incidents below.

**Checklist before saying any task is complete:**
1. `git status` — are there modified/untracked files relevant to this task?
2. `git add` the specific files, `git commit`, `git push origin main`
3. Only THEN tell the user it's done — and mention that GitHub Actions needs a minute
   to rebuild/deploy before it's live.

## Project
**L16 Student Recorder Lite** - Student test results & notes recording app  
**Type**: React + TypeScript + Supabase  
**User**: lucia1297@gmail.com

## Key Panels & Tables

| Panel | File | Table | Purpose |
|-------|------|-------|---------|
| **ExamSchedulePanel** | ExamSchedulePanel.tsx | `admin_exam_schedules` | Gantt chart: test schedules |
| **ExamPrepPanel** | ExamPrepPanel.tsx | `admin_exam_schedules` | Test prep tracking |
| **TimetablePanel** | TimetablePanel.tsx | `students.lessonSchedule` | Auto-generate class schedule |

**⚠️ CRITICAL**: ExamSchedulePanel & ExamPrepPanel both use `admin_exam_schedules` table

## Data Structure

**ExamSchedule** interface:
- `studentCode` - Student identifier
- `reportDeadline` (직보일) - Report deadline
- `examStart` (시작일) - Exam start
- `englishExamDate` (영어시험일) - English exam
- `examEnd` (종료일) - Exam end
- `nextLessonDate` (다음수업) - Next lesson
- `score`, `completed`, `memo`

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "ExamSchedulePanel shows no data" | Wrong table name (exam_schedules vs admin_exam_schedules) | Verify table in fetch URL |
| "Code changes not showing" (local dev) | Port collision (5173 & 5174) | Kill Node processes: `Get-Process node \| Stop-Process -Force` |
| "Code changes not showing" (deployed site) | **Changes never committed/pushed** — happened twice already | `git status` → `git add` → `git commit` → `git push origin main`, then wait for GitHub Actions |
| "Can't login to admin panel" | VITE_ADMIN_ACCESS_CODE not set | Set env var: `$env:VITE_ADMIN_ACCESS_CODE = "admin"` |
| "Installed PWA shows 404" | Stale service worker (see PWA section below) | Already fixed via `registerType: "autoUpdate"` (commit fa991c4) — if it recurs, check `vite.config.ts` workbox config wasn't reverted |

## Development Setup

**Port**: 5173 (single instance only)  
**Command**: `npm run dev`  
**Config**: stored in `.env.local` (not committed) — do NOT hardcode the URL/key in `$env:` one-liners in chat; always read the current values from `.env.local` or the Supabase MCP (`list_projects` → `get_project_url` / `get_publishable_keys`) before setting env vars, since a stale/typo'd project ref silently resolves to a nonexistent project (see Related Incidents below).

Correct project ref (verified via Supabase MCP): `grvambgnkpbufapvhvjx` → `https://grvambgnkpbufapvhvjx.supabase.co`

**Before Starting Server**:
```powershell
# Kill any existing Node processes
Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process -Force
Start-Sleep -Seconds 2
```

## PWA / Service Worker

This app installs to phone home screens (VitePWA, `vite.config.ts`). Two facts that
matter for this project specifically, because it redeploys many times per day:

- `registerType: "autoUpdate"` (not `"prompt"`) — a new service worker activates as
  soon as it's detected, no user action required. With `"prompt"`, a user's device can
  keep running a service worker from hours ago until they notice and tap an update
  banner; meanwhile GitHub Pages deploys (`peaceiris/actions-gh-pages`) fully replace
  the previous build's files each time, so that stale service worker's cached
  references point at files that no longer exist on the server → 404 on next
  navigation. This bit the project twice in one day (2026-09-12/13) before switching
  to `autoUpdate`.
- `workbox.navigateFallback: "/l16-recorder/index.html"` + `cleanupOutdatedCaches: true`
  — a safety net so a navigation that misses cache falls back to the app shell instead
  of surfacing a raw 404.
- If a 404-after-install report ever comes back a THIRD time: don't assume the same
  fix regressed — check whether `registerType`/`workbox` options in `vite.config.ts`
  still match this file, first, before re-diagnosing from scratch.

## Key Files

- `src/features/admin/AdminPanel.tsx` - Main admin panel router
- `src/features/admin/ExamSchedulePanel.tsx` - Gantt chart for test schedules
- `src/features/admin/ExamPrepPanel.tsx` - Test prep dashboard
- `src/core/roster.ts` - Data structures (RosterEntry, ExamSchedule)
- `src/App.tsx` - Login gate, role routing

## Lessons Learned

1. **Multiple panels, single data source**: Always verify both source and destination table match
2. **Port conflicts are invisible**: User sees "no changes" even when code IS updated
3. **Systematic debugging first**: Fix root causes, not symptoms
4. **Environment defaults matter**: Provide sensible dev defaults for critical gates
5. **"Verified locally" ≠ "done"** (repeated twice now): local dev-server testing and direct
   Supabase queries only prove the code/data is correct — they say nothing about whether
   the deployed site has that code. Always `git push` before declaring a task finished.
6. **A bug can hide behind "no data has this filled in yet"**: the `optionElimination`
   rendering bug (see incident below) sat in the codebase without anyone noticing because
   almost every existing row in Supabase had that field as empty strings — the buggy
   branch only rendered once a student actually filled it in. When testing a conditional
   render, don't stop at "the condition is usually false, so it's probably fine" — query
   for a row where the condition IS true and check that one.
7. **After a fix + push, if the user says "still not fixed," check the SERVER before
   re-diagnosing**: fetch the deployed JS bundle directly and grep it for the bug string.
   If the fix isn't there, the push/deploy failed. If it IS there, the user is very likely
   looking at a stale cached copy (PWA service worker, browser cache) — ask them to
   hard-refresh before assuming the code fix was wrong. This saved a wasted re-investigation
   in the ①②③④⑤"[k]" incident below — the deployed bundle already had the fix; the user's
   client just hadn't picked it up yet, confirmed a minute later when they refreshed.

## Related Incidents

- **2026-09-12**: ExamSchedulePanel data not displaying (3 root causes found & fixed)
  - See: `memory/incident_2026_09_12.md` for full analysis
- **2026-09-12**: GrowthPanel showed "제출된 모의고사가 없습니다" / only 12 of 22 students. Spent a long debugging cycle blaming DNS/network (`ERR_NAME_NOT_RESOLVED` on `mxyvstpqaennnfrgvsbw.supabase.co`). Root cause: that project ref was simply **wrong/nonexistent** — not a network issue. `nslookup <ref>.supabase.co 8.8.8.8` returned "Non-existent domain" even though `supabase.co` itself resolved fine, proving it wasn't a DNS/ISP problem. Correct project (verified via Supabase MCP `list_projects`) is `grvambgnkpbufapvhvjx`, confirmed by matching row counts (`students`: 22 rows). Fixed by writing the correct URL/anon key to `.env.local`.
  - **Lesson**: when a Supabase project URL fails, test with `nslookup <ref>.supabase.co 8.8.8.8` and compare against `list_projects` from the Supabase MCP BEFORE assuming a network/DNS problem — a bad project ref look identical to a DNS outage from inside the browser console.
- **2026-09-12**: Built the assignment analysis-question feature (rotating questions, common goal/satisfaction questions, `analysisData` persistence, admin review UI), verified it thoroughly in the local dev server AND by reading/writing test rows directly in Supabase via MCP — but never ran `git add`/`commit`/`push`. Reported the feature as complete. The user then reported "정밀분석이 보이지 않는다" (precision analysis isn't showing) on the actual deployed site. `git status` revealed 7 modified files sitting uncommitted the entire time. This is the SAME class of mistake as the very first incident in this file (2026-09-12, ExamSchedulePanel — "Code not pushed to remote").
  - **Lesson**: local verification (dev server, direct DB queries) and "deployed and visible to the user" are two completely different claims. Never say a fix is "complete"/"verified" without first checking `git status` is clean and the commit is pushed. See the 🚨 rule at the top of this file.
- **2026-09-12/13**: User asked to make the app phone-installable (PWA). Added an install banner (Android `beforeinstallprompt` + iOS "add to home screen" modal, commit b0a1194) — worked. Then user reported 404 after installing to home screen. Diagnosed: GitHub Pages deploy fully replaces old files each time, and workbox had no `navigateFallback`, so a stale service worker's navigation request that missed cache surfaced a raw 404 instead of falling back to the app shell. Fixed with `navigateFallback` + `cleanupOutdatedCaches` (commit 2915398) — but the user hit the SAME 404 again on their phone afterward. Root cause of the recurrence: `registerType: "prompt"` meant the phone's already-active service worker (from hours earlier, before the fix existed) never updated itself — the fix only protected devices that registered a service worker *after* it shipped, not devices already running one. Switched to `registerType: "autoUpdate"` + `skipWaiting`/`clientsClaim` (commit fa991c4) so a new service worker takes over automatically instead of waiting for a user-clicked prompt.
  - **Lesson**: "the server has the right files" and "the user's device has the right service worker active" are independent facts. In a `registerType: "prompt"` PWA that redeploys frequently, a server-side fix (like adding navigateFallback) does NOT retroactively apply to devices already running an older service worker — only `autoUpdate` closes that gap. See PWA section above.
- **2026-09-13**: User reported garbage text `①②③④⑤"[k]": 값` appearing in GrowthPanel's "선지 분석" (option-elimination) display, under 발전기록 → 비교분석 → 3문항 정밀조사. Root cause: the JSX for rendering `optionElimination` (a `Record<string,string>` keyed "1"–"5") was clearly *intended* to map each key to a circled-number glyph, but the actual code had no indexing logic at all — it was the literal string `①②③④⑤"[k]": {String(v)}` hardcoded inline, so all five circled digits printed together followed by the literal characters `[k]` (not the key's value) on every row. This sat unnoticed because almost every `optionElimination` value in the real database was an empty string (the condition `Object.values(...).some(v=>v)` gates the whole block) — only two students (이예린, 강지훈) had ever actually filled in a selection-elimination note, so the buggy branch rarely rendered. Fixed with `["①","②","③","④","⑤"][Number(k)-1] ?? \`${k}번\`` (commit f7520c0). First `git push` failed with `Could not resolve host: github.com` (transient network blip, not a real error) — retried immediately and it succeeded; always confirm via `gh run list` rather than assuming a push command's own exit code tells the whole story on a flaky connection. User then said "still not gone" moments after the fix deployed; fetching the live JS bundle directly confirmed the fix WAS already live, and the user's next refresh confirmed it — a deploy/client-cache timing overlap, not a wrong fix. See Lessons Learned #6 and #7 above.
