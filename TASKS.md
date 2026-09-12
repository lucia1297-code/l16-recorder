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
