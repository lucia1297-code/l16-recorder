# Tasks

## Active

## Waiting On

## Someday

## Done

- [x] ~~**ExamSchedulePanel 데이터 반영 근본 원인 진단 및 해결**~~ (2026-09-12 완료)
  - 근본 원인: exam_schedules vs admin_exam_schedules 테이블 불일치
  - 해결책: ExamSchedulePanel이 admin_exam_schedules 테이블에서 로드하도록 수정
  - 커밋: bf2de58
  
- [x] ~~**포트 충돌 문제 해결**~~ (2026-09-12 완료)
  - 문제: 포트 5173/5174 중복 점유로 캐시된 번들 로드
  - 해결책: 모든 Node 프로세스 종료 후 개발 서버 단일 포트에서 시작
  - 상태: 포트 5173에서 정상 작동 중
  
- [x] ~~**관리자 패널 로그인 및 ExamSchedulePanel 검증**~~ (2026-09-12 완료)
  - adminGate.ts에 기본값 "admin" 추가
  - 로그인 성공 ✅
  - ExamSchedulePanel Gantt chart 로드 완료 ✅
  - 학생 데이터 표시 확인 ✅

- [x] ~~**GrowthPanel(발전기록) 모의고사 풀이시간 반영 + 전체 학생(22명 중 18명) 표시**~~ (2026-09-12 완료)
  - 요청 1: 모의고사 풀이 시간(총/Step1/2/3)을 발전기록 진단문·상담평가서에 반영
  - 요청 2: 모의고사 미제출 학생도 과제 제출 데이터로 상담평가 대상에 포함
  - 잘못된 착수: Supabase 요청이 `net::ERR_NAME_NOT_RESOLVED`로 실패 → DNS/네트워크 문제로 오판하고 한 사이클 낭비 (DNS 서버 변경 제안, vite 프록시 추가, fetch→Supabase 클라이언트 교체 등 헛수고)
  - **진짜 근본 원인 1**: `mxyvstpqaennnfrgvsbw.supabase.co`는 존재하지 않는 프로젝트였음 (`nslookup ... 8.8.8.8` → "Non-existent domain", 반면 `supabase.co` 자체는 정상 해석 — 네트워크가 아니라 프로젝트 참조 자체가 틀렸다는 증거). Supabase MCP `list_projects`로 실제 프로젝트(`grvambgnkpbufapvhvjx`) 확인 후 `.env.local`에 올바른 URL/키 기록
  - **진짜 근본 원인 2**: `fetchAssignmentsWithAnalysis()`가 `analysisData != null`인 제출물만 반환하는데, 이 필터된 목록을 "학생이 데이터를 가지고 있는지" 판단에도 재사용 → 정밀분석 안 받은 학생이 통째로 누락 (12→17명). `fetchAllAssignments()`(필터 없음) 신설로 해결 → 18명 전원 표시
  - **진짜 근본 원인 3**: 모의고사 기록 없는 학생(`rows=[]`) 포함 시 `latest.score` 접근에서 렌더링 크래시 → 과제만 있는 학생 전용 카드 UI 추가로 해결
  - 검증: SQL로 `students_with_any_data=18` 확인, 브라우저에서 18명 카드 정상 렌더링 확인
  - 기록: [memory/incident_2026_09_12_growthpanel.md](memory/incident_2026_09_12_growthpanel.md), CLAUDE.md 업데이트

- [x] ~~**과제 정밀분석 질문 확장/로테이션/저장 + 관리자 확인 UI**~~ (2026-09-12 완료)
  - 요청: 모든 과제(모의고사 외)에도 학생 어려움 확인 질문, 과제별 다른 질문, 매주 안 겹치게 로테이션, 다짐/목표, 만족도
  - `ANALYSIS_QUESTIONS` 카테고리별 4→7~8개로 확장, `pickRotatingQuestions()`로 회차별 순환 노출, `COMMON_ANALYSIS_QUESTIONS`(다짐/목표+만족도)는 매번 고정 노출
  - 조사 중 발견: `analysisData` 답변은 UI만 있고 Supabase에 저장된 적이 없었음(스토어 매핑 누락) → `analysis_data` jsonb 컬럼 추가 + `assignmentStore.supabase.ts` 저장/조회 매핑 추가
  - 관리자 "과제 점검" 화면에 "🔬 정밀분석 보기" 토글 추가
  - **⚠️ 배포 사고 (반복된 실수)**: 로컬 개발 서버+DB 직접 조회로만 검증하고 "완료"라고 보고했으나, **git commit/push를 하지 않아** 실제 GitHub Pages 배포본에는 전혀 반영되지 않음. 사용자가 실제 화면에서 "정밀분석이 보이지 않는다"고 재보고한 뒤에야 `git status`로 미커밋 상태를 발견. 커밋 a9ed6da로 뒤늦게 push.
  - **이 프로젝트에서 두 번째로 겪는 동일 패턴의 사고**임 — 최초 사고(2026-09-12, ExamSchedulePanel 건)의 원인 중 하나도 "Code not pushed to remote"였음. 즉 한 번 기록해둔 교훈이 재발을 막지 못함 → 아래 CLAUDE.md 및 스킬 메모리에 "코드 수정 후 검증 완료 = commit+push까지 끝난 상태"로 재정의하여 기록.

- [x] ~~**PWA 홈 화면 설치 + 설치 후 404 오류 근절**~~ (2026-09-12~13 완료)
  - 요청: 핸드폰에 앱처럼 설치할 수 있게 해달라
  - 1차: `App.tsx`에 Android `beforeinstallprompt` 캐치 배너 + iOS "홈 화면에 추가" 안내 모달 추가 (커밋 b0a1194)
  - 2차: 설치 후 실행 시 404 재현 → `vite.config.ts`에 workbox `navigateFallback`(캐시 미스 시 index.html로 폴백) + `cleanupOutdatedCaches` 추가 (커밋 2915398). 원인 진단: GitHub Pages 배포(`peaceiris/actions-gh-pages`)가 매번 이전 파일을 완전 교체하는데, 설치 시점의 서비스워커가 그 시점 파일 해시를 참조하고 있다가 재배포로 삭제된 뒤 네비게이션 요청이 그대로 실패해 노출됨
  - **3차(재발)**: 2차 수정을 배포했음에도 사용자가 핸드폰에서 다시 404를 겪음 — **진짜 근본 원인**: `registerType: "prompt"`는 사용자가 업데이트 배너를 직접 눌러야만 새 서비스워커로 전환됨. 하루 4~5회 재배포하는 이 프로젝트에서, 사용자는 몇 시간 전의 오래된(2차 수정 이전) 서비스워커를 계속 쓰고 있었고, 그 오래된 서비스워커에는 애초에 navigateFallback이 없었으므로 2차 수정이 전혀 소급 적용되지 않았음. `registerType: "autoUpdate"` + `skipWaiting`/`clientsClaim`으로 전환하여 새 서비스워커가 배포되면 즉시 활성화되도록 근본 해결 (커밋 fa991c4)
  - **교훈**: PWA에서 "서버에 올바른 파일이 있다"와 "사용자 기기에 올바른 서비스워커가 활성화되어 있다"는 완전히 별개의 상태다. `registerType: "prompt"`인 서비스워커 프로젝트에서 하루 여러 번 재배포하면, 서버 측 수정(navigateFallback 등)이 있어도 이미 활성화된 오래된 서비스워커에는 반영되지 않아 문제가 재발할 수 있다 — 배포 빈도가 잦은 프로젝트는 `autoUpdate`가 안전.
  - 기록: `memory/incident_2026_09_12_unpushed_deploy.md`(1차 배포 누락 건), 시스템 메모리에 PWA 캐시 관련 feedback 추가 예정
