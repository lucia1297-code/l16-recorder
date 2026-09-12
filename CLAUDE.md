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

## Related Incidents

- **2026-09-12**: ExamSchedulePanel data not displaying (3 root causes found & fixed)
  - See: `memory/incident_2026_09_12.md` for full analysis
- **2026-09-12**: GrowthPanel showed "제출된 모의고사가 없습니다" / only 12 of 22 students. Spent a long debugging cycle blaming DNS/network (`ERR_NAME_NOT_RESOLVED` on `mxyvstpqaennnfrgvsbw.supabase.co`). Root cause: that project ref was simply **wrong/nonexistent** — not a network issue. `nslookup <ref>.supabase.co 8.8.8.8` returned "Non-existent domain" even though `supabase.co` itself resolved fine, proving it wasn't a DNS/ISP problem. Correct project (verified via Supabase MCP `list_projects`) is `grvambgnkpbufapvhvjx`, confirmed by matching row counts (`students`: 22 rows). Fixed by writing the correct URL/anon key to `.env.local`.
  - **Lesson**: when a Supabase project URL fails, test with `nslookup <ref>.supabase.co 8.8.8.8` and compare against `list_projects` from the Supabase MCP BEFORE assuming a network/DNS problem — a bad project ref look identical to a DNS outage from inside the browser console.
- **2026-09-12**: Built the assignment analysis-question feature (rotating questions, common goal/satisfaction questions, `analysisData` persistence, admin review UI), verified it thoroughly in the local dev server AND by reading/writing test rows directly in Supabase via MCP — but never ran `git add`/`commit`/`push`. Reported the feature as complete. The user then reported "정밀분석이 보이지 않는다" (precision analysis isn't showing) on the actual deployed site. `git status` revealed 7 modified files sitting uncommitted the entire time. This is the SAME class of mistake as the very first incident in this file (2026-09-12, ExamSchedulePanel — "Code not pushed to remote").
  - **Lesson**: local verification (dev server, direct DB queries) and "deployed and visible to the user" are two completely different claims. Never say a fix is "complete"/"verified" without first checking `git status` is clean and the commit is pushed. See the 🚨 rule at the top of this file.
