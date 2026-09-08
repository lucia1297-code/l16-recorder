# L16 Two-minute Recording Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement bounded tasks and review them.

**Goal:** Persist independent two-minute recordings and transcribe securely without blocking capture.
**Architecture:** Continuous sample capture and Worker MP3 encoding; durable IndexedDB outbox; authenticated Supabase Edge service and private chunk storage.
**Tech Stack:** React, TypeScript, AudioWorklet, Web Worker, IndexedDB, Supabase Postgres/Auth/Storage/Edge, OpenAI.
**Spec:** docs/superpowers/specs/2026-09-08-two-minute-recording.md

## Global Constraints

- Master server authentication; never trust browser flags or include OpenAI secrets in builds.
- Existing recordings preserved; no unrelated data or credential changes.
- Independent mono MP3 32kbps; 120 seconds per segment, actual captured samples determine duration.
- No assertion of mobile background reliability without real phone testing.
- Keep existing untracked diagnostic files and prior edits intact.

### Task 1: Capture and encoding
Files: src/recording/capture.ts, capture.worklet.js, encoder.worker.ts, encoder.ts and tests. Own only these plus encoder dependency.
Interface: `startSegmentedCapture({onSegment,onError,onState,onProgress}): Promise<{stop():Promise<void>}>`; onSegment receives `{sequence:number,blob:Blob,durationMs:number}` starting at 0. callbacks are awaited for durable storage before completion; capture never waits on network. onProgress receives captured seconds. onState emits interrupted message if audio context stops while recording. stop flushes final encoder output and drains persistence.
- [ ] Test encoder with 120 seconds plus tail, independently decode MP3 outputs, assert mono/size and sample accounting.
- [ ] Implement continuous AudioWorklet capture and serial MP3 Worker with stop acknowledgement. Persist partial output or explicitly document bounded in-progress loss.
- [ ] Run targeted tests and browser synthetic capture. Do not commit others' files.

### Task 2: Server service
Files: supabase/functions/recording-service/*, supabase/migrations/*recording*.sql, scripts/recording-server*.mjs, server tests.
Interface: exact API from spec. Export testable request handler with injected dependencies and a thin Deno entrypoint.
- [ ] Test anonymous/forged/non-Master/other owner rejection before provider calls.
- [ ] Implement private sessions/chunks schema and lease-based idempotent operations.
- [ ] Test missing/reordered chunks, duplicate upload hash, repeated transcription, provider 401/429/timeouts, save errors, analysis retries.
- [ ] Implement legacy server transcription/analysis adapters preserving originals.
- [ ] Document deployment prerequisites, execute available local tests. No live schema mutations without orchestrator.

### Task 3: Durable outbox and UI (orchestrator)
Files: src/recording/outbox.ts, client.ts, RecordingWorkspace.tsx, existing RecordingPanel.tsx, tests.
- [ ] Test local persistence before upload, failed upload retention, stop/drain and recovery, queue sequencing, upload retry without retranscription.
- [ ] Implement IndexedDB outbox with stable session/sequence identities; serial upload/transcription pump separate from capture, offline retry, download/export and count/progress.
- [ ] Implement server-verified Master login for recording only; explicit local-only status until authenticated.
- [ ] Replace old capture controls with new workspace and keep legacy history/reanalysis via server.
- [ ] Remove browser OpenAI credentials from recording code and workflow; do not expand into unrelated provider migrations.

### Task 4: Integration and delivery
- [ ] Review shared interfaces across tasks; fix findings and record decisions.
- [ ] Run targeted and whole-suite tests, production build, browser synthetic end-to-end with mock server explicitly labelled.
- [ ] Deploy only with server credentials and valid provider key; verify production version and authorized user runtime if available.
- [ ] Record implemented versus unverified items and precise external blockers; do not claim actual phone or OpenAI success from mocks.
