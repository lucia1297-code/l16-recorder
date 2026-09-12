# Incident: GrowthPanel Missing Students + "DNS" Red Herring (2026-09-12)

## Summary
GrowthPanel ("발전기록") showed "제출된 모의고사가 없습니다" then only 12/22, then 17/22 students, and 모의고사 solving-time (풀이시간) data was completely absent from the panel. The debugging process itself is the main lesson here: a long detour chasing a network/DNS problem that did not exist, followed by two real, unrelated root causes once the correct rabbit hole was found.

**Root Causes Found:** 3, of which 2 were real code bugs and 1 was a chatted-in-good-faith false lead.

**Status**: ✅ **Completely Resolved** — 18/22 students now display (the remaining 4 genuinely have zero mock-exam or assignment records, verified via SQL).

---

## False Lead: "DNS / Network Problem" 🔴 (the expensive mistake)

**Symptom seen:** Every Supabase fetch in the browser console failed with
`TypeError: Failed to fetch` / `net::ERR_NAME_NOT_RESOLVED` on `mxyvstpqaennnfrgvsbw.supabase.co`.

**What I did wrong:** Assumed this meant DNS/ISP/network trouble because the error *looks* identical to a real DNS outage from inside a browser console. Spent a full debugging cycle on:
- `Test-NetConnection` / `[System.Net.Dns]::GetHostAddresses` (both "failed")
- Suggesting the user change DNS servers, reboot the router, use a VPN
- Writing a Vite dev-server proxy to route around "the DNS problem"
- Re-writing `fetchResults()` to use the Supabase JS client instead of raw `fetch` (harmless, but didn't address the real bug either)

**What finally revealed the truth:** Tested DNS resolution for a *different, known-good* domain first:
```powershell
[System.Net.Dns]::GetHostAddresses("google.com")     # ✅ resolves fine
[System.Net.Dns]::GetHostAddresses("supabase.co")     # ✅ resolves fine (76.76.21.21)
[System.Net.Dns]::GetHostAddresses("mxyvstpqaennnfrgvsbw.supabase.co")  # ❌ "no such host"
nslookup mxyvstpqaennnfrgvsbw.supabase.co 8.8.8.8      # ❌ "Non-existent domain" (straight from Google's own DNS, not the ISP's)
```
Since `supabase.co` itself resolves fine but the specific project subdomain returns **Non-existent domain even from Google's public DNS**, this cannot be a local network/ISP/DNS problem — the project reference itself is wrong or the project no longer exists. A real network outage would fail *all* domains, not one specific (and only one) subdomain.

**Actual root cause:** `mxyvstpqaennnfrgvsbw` was simply the wrong Supabase project ref — probably a typo or a stale value from an earlier, different project, carried forward into `CLAUDE.md` and repeated into every `$env:VITE_SUPABASE_URL = "..."` one-liner across the session (including by me, uncritically).

**How it was actually fixed:** Used the Supabase MCP tools (`list_projects`) to enumerate the user's *real* projects instead of trusting the value already in the codebase/docs:
```
grvambgnkpbufapvhvjx  "lucia1297@gmail.com's Project"  ACTIVE_HEALTHY   ← the real one
phnijhykdbcketrgldrh  "Diary"                          INACTIVE
```
Confirmed it was the right one by matching `students` table row count (22) against what the user had been saying ("총 22명중에..."). Wrote the correct URL + anon key (from `get_publishable_keys`) into `.env.local`.

### 🔑 THE key lesson from this whole incident
**When a Supabase/API URL fails with what looks like a DNS error, before touching any network settings:**
1. Test DNS resolution for a **different known-good domain** on the **same root** (e.g. `supabase.co` vs `<project-ref>.supabase.co`). If the root resolves and only the subdomain doesn't, it is NOT a network problem — it's a wrong/stale/deleted project reference.
2. Query the Supabase MCP `list_projects` and cross-check the ref actually being used in code/env against the real list. Never assume a project ref recorded in `CLAUDE.md` or in a previous session's chat is still correct — treat it as a claim to verify, not a fact (this is literally the "before recommending from memory" rule: a memory naming a specific ID is a claim it existed *when written*).
3. Only after (1) and (2) both point to "network problem" should DNS/ISP/router/VPN be investigated.

This wasted an entire multi-message cycle (user asking "네트워크 연결 복구는 언제 되나?" and "다른 문제의 발발 원인을 찾아봐라. 항상 다른 쪽에서 해결책이 나온다") that could have been skipped by running the one differential `nslookup` test first.

---

## Real Root Cause #1: `fetchAssignmentsWithAnalysis()` silently filtered out most students 🟠

**Problem:**
```typescript
async function fetchAssignmentsWithAnalysis(): Promise<AssignmentSubmission[]> {
  const subs = await store.listSubmissions();
  return subs.filter(s => s.analysisData != null);   // ← drops any submission without 정밀분석 data
}
```
This function's result (`assignmentSubs`) was reused for a second, unrelated purpose: building the map of "which students have *any* growth-record data" (`allStudentsWithData`). A student who submitted assignments but never got 정밀분석 (analysisData) done was invisible to that map — even though they had real submission/timing data that should count.

**Symptom:** GrowthPanel showed 12, then 17 of 22 students — never all 18 that actually have data (verified via SQL: `students_with_any_data = 18`, 4 students genuinely have zero records).

**Fix:** Added a second fetch, `fetchAllAssignments()`, that returns the *unfiltered* submission list, and used that (`allAssignmentSubs`) specifically for building `allStudentsWithData`, `makeDiagnosis()`'s timing lookup, and `printReport()`'s timing lookup — while leaving `assignmentSubs` (analysisData-filtered) untouched for the 정밀분석 UI that actually needs only-analyzed submissions.

**Key Learning:** A fetch function named/scoped for one purpose ("with analysis") gets reused for a structurally different purpose ("does this student have any data at all") — the filter that made sense for purpose A silently broke purpose B. When a helper's name encodes a filter (`...WithAnalysis`), grep every call site before reusing it for something broader.

---

## Real Root Cause #2: Render crash when a student has zero mock-exam rows 🟠

**Problem:** Once `allStudentsWithData` correctly started including students with `rows = []` (assignment-only students), the "비교 분석" card renderer assumed `sorted[sorted.length-1]` (`latest`) is always defined:
```typescript
const latest = sorted[sorted.length-1];
const trend = prev ? latest.score - prev.score : 0;   // 💥 TypeError when latest is undefined
```
This crashed the whole `<GrowthPanel>` component (white screen) as soon as a data-complete `allStudentsWithData` map included even one assignment-only student.

**Fix:** Added an early-return branch inside the `.map()` for `!latest` that renders a simplified card (amber header, "모의고사 미제출 · 과제 N건", most-recent submission date/item, average timed minutes) instead of the full score-trend card.

**Key Learning:** Widening a data source (Root Cause #1's fix) can silently break downstream code that assumed the old, narrower shape. Any time a "which students have data" set is broadened, every consumer of the per-student row array must be checked for an implicit "this array is non-empty" assumption.

---

## User's original two feature requests (also delivered in this session)

1. **모의고사 풀이시간을 발전기록에 반영** — `ExamResult` type extended with `totalMinutes/step1Minutes/step2Minutes/step3Minutes`; `fetchResults()` now joins `results` with `assignment_submissions` on `(student_code, round)` to attach timing data; `makeDiagnosis()` and `printReport()` both surface a "풀이 시간" section.
2. **모의고사 미제출 학생도 과제/느낌 데이터로 상담평가에 반영** — delivered via the `allStudentsWithData` map + the assignment-only card UI (Root Cause #2's fix).

---

## Verification (SQL against the real project `grvambgnkpbufapvhvjx`)

```sql
SELECT
  (SELECT count(*) FROM students) AS total_students,                         -- 22
  (SELECT count(DISTINCT student_code) FROM results) AS students_with_results,        -- 17
  (SELECT count(DISTINCT student_code) FROM assignment_submissions) AS students_with_submissions, -- 14
  (SELECT count(DISTINCT s.student_code) FROM students s
     WHERE s.student_code IN (SELECT student_code FROM results)
        OR s.student_code IN (SELECT student_code FROM assignment_submissions)) AS students_with_any_data; -- 18
```
4 students (`R2WAPBJQ`, `SP5JKWY8`/withdrawn, `12345L16`/withdrawn, `V843634R`) have zero rows in either table — correctly absent from the panel.

Confirmed in-browser: 18 student name headers rendered in the "비교 분석" tab, no console crash, assignment-only student ("강지훈") rendered with the amber simplified card.

---

## Files Modified

| File | Change |
|------|--------|
| `src/core/types.ts` | Added `totalMinutes/step1Minutes/step2Minutes/step3Minutes` to `ExamResult` |
| `src/features/admin/GrowthPanel.tsx` | `fetchResults()` joins timing data; added `fetchAllAssignments()` + `allAssignmentSubs` state; `allStudentsWithData` now uses unfiltered submissions; added assignment-only card branch in render; `makeDiagnosis()`/`printReport()` use `allAssignmentSubs` and surface timing info |
| `.env.local` | Created with the *correct* project URL/anon key (was previously missing / pointed at a nonexistent project) |
| `vite.config.ts` | Added then removed an unnecessary proxy workaround for the false DNS lead |
| `CLAUDE.md` | Corrected project ref, added a "verify via Supabase MCP before trusting a recorded URL" rule, logged this incident |

---

## Prevention for Future

- [ ] Before ever writing `$env:VITE_SUPABASE_URL = "<value from memory/docs>"`, re-verify that value against `list_projects` from the Supabase MCP if one is available — treat a recorded project ref as a claim, not a fact.
- [ ] When a Supabase fetch fails with a DNS-looking error, run the differential `nslookup <known-good-root> 8.8.8.8` vs `nslookup <the-failing-ref>.supabase.co 8.8.8.8` test *first*, before touching any network/DNS/router settings.
- [ ] Grep all call sites before reusing a narrowly-filtered fetch helper (e.g. `...WithAnalysis`) for a broader purpose.
- [ ] Whenever a "which entities have data" set is widened, audit every downstream consumer for an implicit non-empty-array assumption.

---

**Incident ID**: EXP-2026-09-12-002
**Resolution**: Complete + Verified via SQL and live browser render
**Biggest time sink**: the false DNS lead — differential domain testing would have shortcut it immediately
