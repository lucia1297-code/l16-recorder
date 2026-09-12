# Incident: Feature reported "complete" but never deployed — repeated mistake (2026-09-12)

## Summary
Built the assignment "정밀분석" (precision analysis) feature — expanded question pools,
per-round rotation, common goal/satisfaction questions, `analysisData` persistence to
Supabase, and an admin review UI to see student answers. Verified everything thoroughly:
local dev server browser testing, and even reading/writing test rows directly in the
Supabase database via MCP tools. Reported the feature as complete and verified.

**The code was never committed or pushed.** The user, using the actual deployed
GitHub Pages site, reported "정밀분석이 보이지 않는다" (precision analysis isn't
showing). `git status` revealed 7 modified files that had been sitting uncommitted
since they were written.

**This is the exact same class of mistake as the very first incident recorded in this
project** (`memory/incident_2026_09_12.md` — ExamSchedulePanel, root cause #2: "Code not
pushed to remote"). Writing it down once did not prevent it from happening again in the
same session-family.

## Why local + DB verification felt sufficient (and wasn't)

1. Local dev server (`npm run dev` on :5173) showed the feature working correctly in the
   Claude Browser pane — this proved the *code* was correct.
2. Supabase MCP `execute_sql` was used to write a test `analysis_data` row directly into
   the database and confirm the admin UI rendered it — this proved the *UI logic and
   schema* were correct.
3. Neither of these steps touches git at all. The user's actual browser loads the
   **built, deployed bundle from GitHub Pages**, which is produced by GitHub Actions
   from whatever is on `origin/main` — completely independent of the local working
   directory or the local dev server.

So "I verified it end-to-end" was true for *code correctness* but false for
*user-visibility* — two different claims that are easy to conflate, especially when
verification was unusually thorough (which creates false confidence).

## The fix

```bash
git add <7 files>
git commit -m "..."
git push origin main
```
GitHub Actions then rebuilds and redeploys automatically (per this project's existing
CI/CD, confirmed working in the very first incident of this project).

## Key lesson (added to CLAUDE.md as the top-of-file 🚨 rule)

For any project deployed via CI/CD from a git remote (GitHub Pages, Vercel, Netlify,
etc.), **"verified" and "done" are not the same as "pushed."** A task is not complete
until:
1. `git status` is clean (everything relevant is committed)
2. The commit is pushed to the branch that triggers deployment
3. Only then should the user be told the feature is live — and even then, mention the
   CI/CD pipeline needs a minute to actually rebuild/redeploy.

Local dev-server testing and direct database verification are necessary but not
sufficient — they verify the code and data are correct, not that the user can see it.

**Meta-lesson**: recording an incident once (the ExamSchedulePanel case) did not
prevent recurrence. The instruction "always push before declaring done" needed to be
made impossible to miss — hence placing it as the very first thing in `CLAUDE.md`
(a 🚨-flagged rule at the top of the file, not buried in a table further down) rather
than trusting that a lessons-learned bullet point deep in the doc would be re-read
every time.

## Files Modified (in the incident itself)
No code changes were needed to fix this — the fix was purely `git add`/`commit`/`push`
of already-correct code (commit `a9ed6da`). Only `CLAUDE.md` and `TASKS.md` were edited
afterward to strengthen the reminder.

---

**Incident ID**: EXP-2026-09-12-003
**Resolution**: Complete — commit `a9ed6da` pushed to `origin/main`
**Recurrence risk**: HIGH unless the top-of-CLAUDE.md rule is actually read at the start
of future sessions — this is a process/discipline failure, not a code bug, so no amount
of code review would have caught it.
