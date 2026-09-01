# L16 Student Recorder Lite — MASTER SKILL
> 모든 작업자(Claude, WW, CLINIC-WW 등)가 이 파일을 먼저 읽어야 한다.
> 위반 시 빌드 실패, 데이터 손실, 학생 정보 오류가 발생한다.

---

## 프로젝트 개요

| 항목 | 내용 |
|---|---|
| **서비스명** | L16 개인 영어 지도 — Student Recorder Lite |
| **배포 URL** | https://l16-academy.surge.sh |
| **GitHub** | lucia1297-code/l16-recorder (Private) |
| **Backend** | Supabase (FREE 플랜) |
| **SMS** | Solapi |
| **AI** | OpenAI (Whisper + GPT-4o-mini) |
| **Framework** | React + TypeScript + Vite |

---

## 아키텍처

```
src/
├── core/           ← 비즈니스 로직 (순수 TS, 프레임워크 무관)
│   ├── types.ts    ← ExamResult, WrongAnswerEntry, Reflection, QuestionDetail
│   ├── roster.ts   ← RosterEntry (학생 명단)
│   ├── assignment.ts ← AssignmentType, AssignmentSubmission, 분석 질문
│   └── logic.ts    ← 점수 계산, 통계
├── features/
│   ├── admin/      ← 관리자 화면
│   │   ├── AdminPanel.tsx      ← 메인 (150,000자 한계)
│   │   ├── GrowthPanel.tsx     ← 발전기록 (Lazy)
│   │   ├── ExamPrepPanel.tsx   ← 시험일정조사 (Lazy)
│   │   ├── ExamPlanPanel.tsx   ← 시험대비 계획 (Lazy)
│   │   └── RecordingPanel.tsx  ← 수업 녹음 분석 (Lazy)
│   └── student/    ← 학생 화면
│       ├── StudentFlow.tsx     ← 학생 메인 (68,000자)
│       ├── StudentExamRegister.tsx ← 시험등록/상담
│       └── LessonRecorder.tsx  ← 수업 녹음 (미사용)
└── lib/            ← 외부 연동
    ├── examUtils.ts      ← ★ 시험 데이터 변환 (반드시 사용)
    ├── storage.supabase.ts ← 모의고사 결과 CRUD
    ├── rosterStore.supabase.ts ← 학생 명단 CRUD
    └── assignmentStore.supabase.ts ← 과제 CRUD
```

---

## Supabase 테이블 목록

| 테이블 | 용도 | 주요 필드 |
|---|---|---|
| `results` | 모의고사 제출 | student_code, score, wrong_answers(JSONB), reflection(JSONB), question_details(JSONB) |
| `student_exams` | 학생 직접 등록 시험 | student_code, english_exam_date, exam_range |
| `exam_prep_plans` | 시험대비 주간 계획 | student_code, exam_id, week_number, task_key, status |
| `consultation_messages` | 학생-강사 상담 | student_code, message, admin_reply |
| `lesson_recordings` | 수업 녹음 분석 | student_code, audio_url, transcript, analysis, keywords |

localStorage 키:
- `l16.examSchedules` — 관리자 등록 시험 일정 (ExamSchedule 배열)
- `l16.growthMessages` — 처방 메시지 이력

---

## 절대 규칙 (위반 시 빌드 실패)

### R1. AdminPanel.tsx 파일 크기 한계
```
AdminPanel.tsx: 150,000자 초과 금지
초과 시: 새 탭은 반드시 별도 파일 + Lazy import 패턴
```

### R2. Lazy import 표준 패턴
```tsx
function MyPanelLazy() {
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    import("./MyPanel").then(m => setComp(() => m.default))
      .catch(e => setErr(String(e?.message ?? e)));
  }, []);
  if (err) return <div className="card"><p style={{color:"#ef4444"}}>{err}</p></div>;
  if (!Comp) return <div className="card"><p style={{color:"#94a3b8"}}>로딩 중…</p></div>;
  return <Comp />;
}
```

### R3. Supabase JSONB 파싱
```tsx
// ❌ 금지
const data = JSON.parse(row.wrong_answers);

// ✅ 필수
function parseJsonField(val: unknown): any {
  if (typeof val === "object") return val;  // JSONB → 이미 객체
  if (typeof val === "string") { try { return JSON.parse(val); } catch { return null; } }
  return null;
}
```

### R4. 시험 데이터 변환 — examUtils.ts 전용
```tsx
// ❌ 직접 변환 금지 (필드명 불일치 발생)
const exam = { english_exam_date: ex.englishExamDate };

// ✅ examUtils.ts 함수 사용
import { loadLocalExams, supabaseToUnified, mergeExams } from "../../lib/examUtils";
const local = loadLocalExams(roster);
const remote = sbData.map(se => supabaseToUnified(se, roster));
const all = mergeExams(local, remote);
```

### R5. 문자열 안에 JSX 금지
```tsx
// ❌ 절대 금지 — 빌드 오류 발생
const label = "<CheckCircle size={14}/> 완료";
const text = `${condition ? "<Icon/> 텍스트" : "다른텍스트"}`;

// ✅ JSX는 렌더링 위치에 직접 작성
const label = "완료";
// 렌더링: <><CheckCircle size={14}/> {label}</>
```

### R6. 상수 중복 선언 금지
```tsx
// 파일 최상단에 1회만 선언
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
// 함수 내부 재선언 절대 금지
```

### R7. interface/type은 최상위 선언
```tsx
// ❌ 금지
function Component() {
  interface MyType { id: string; }
}
// ✅ 필수
interface MyType { id: string; }
function Component() { ... }
```

### R8. require() 사용 금지
```tsx
// ❌ 금지
const { X } = require("./module");
// ✅ ESM 사용
import { X } from "./module";
const { X } = await import("./module");
```

### R9. 아이콘은 lucide-react 일관 사용
```tsx
import { CheckCircle, XCircle, Clock, Send } from "lucide-react";
// 이모지 사용 금지 (일관성 파괴)
```

---

## WW / CLINIC-WW 연동 예정 구조

### 작업 의뢰 흐름
```
L16 Student Recorder Lite (이 앱)
        ↓ 학생 데이터 / 분석 결과
    WW (교재 제작 시스템)
        ↓ 변형문제 / 내신자료
  CLINIC-WW (심화 분석 시스템)
        ↓ 처방 / 지도 방향
    L16 강사 (민수쌤)
```

### 연동 예정 API 포인트
- `GET /results` — 학생별 모의고사 분석 결과
- `GET /exam_prep_plans` — 시험대비 계획 현황
- `GET /lesson_recordings` — 수업 녹음 분석
- `POST /consultation_messages` — 상담 내용 등록

### 향후 추가 예정 엔드포인트 (미구현)
- `/api/ww/order` — WW 작업 의뢰 전송
- `/api/clinic/analysis` — CLINIC-WW 심화 분석 요청
- `/api/materials` — 교재/문제지 연동

---

## 환경변수 목록

| 변수명 | 용도 |
|---|---|
| VITE_SUPABASE_URL | Supabase 프로젝트 URL |
| VITE_SUPABASE_ANON_KEY | Supabase 익명 키 |
| VITE_ADMIN_ACCESS_CODE | 관리자 접근 코드 |
| VITE_SOLAPI_API_KEY | Solapi SMS API 키 |
| VITE_SOLAPI_API_SECRET | Solapi SMS 시크릿 |
| VITE_SOLAPI_SENDER | SMS 발신번호 |
| VITE_ADMIN_PHONE | 관리자 전화번호 |
| VITE_OPENAI_API_KEY | OpenAI (Whisper + GPT) |

---

## 배포 전 체크리스트

```
[ ] AdminPanel.tsx < 150,000자 확인
[ ] 새 파일의 export default 존재 확인
[ ] SUPABASE_URL 중복 선언 없음
[ ] JSX가 문자열 안에 없음
[ ] interface가 함수 외부에 있음
[ ] require() 없음
[ ] lucide-react import 선언됨
[ ] examUtils 통해 시험 데이터 변환
[ ] tsc --noEmit 오류 0개
```

---

## 반복 실수 이력

| 날짜 | 파일 | 오류 | 원인 | 해결책 |
|---|---|---|---|---|
| 2026-09 | AdminPanel | 빌드 실패 | interface 함수 내부 | 최상위 이동 |
| 2026-09 | AdminPanel | 빌드 실패 | 파일 200,000자 초과 | ExamPrepPanel 분리 |
| 2026-09 | ExamPlanPanel | 데이터 안보임 | JSONB 이중파싱 | parseJsonField 적용 |
| 2026-09 | ExamPlanPanel | 학생 안보임 | 필드명 불일치(camelCase/snake_case) | examUtils.ts 통합 |
| 2026-09 | RecordingPanel | JSX 오류 | 문자열 내 JSX 삽입 | 텍스트만 남김 |
| 2026-09 | StudentExamRegister | 빌드 실패 | label 문자열 내 JSX | 제거 후 별도 렌더링 |

---

## 스킬 문서 목록

| 파일 | 내용 |
|---|---|
| MASTER_SKILL.md | 이 파일 — 전체 규칙 통합본 |
| BUILD_FAIL_PREVENTION.md | 빌드 실패 방지 규칙 |
| SUPABASE_JSONB_SKILL.md | JSONB 파싱 규칙 |
| SUPABASE_FREE_PLAN.md | 무료 플랜 운영 규칙 |
| EXAM_DATA_SKILL.md | 시험 데이터 변환 규칙 |
| GROWTH_REPORT_SKILL.md | 상담평가서 작성 기준 |
| DEPLOYMENT_CHECKLIST.md | 배포 체크리스트 |

---

## AFX-Desk (L19) 연동

### 시스템 관계도
```
L16 Student Recorder (Supabase)
    │
    ├── 과제제출 이벤트 → Supabase Webhook
    │                          ↓
    │              AFX-Desk /api/webhooks/supabase/assignment-submission
    │                          ↓
    │              sms_notifications 대기열 등록
    │                          ↓
    │              관리자 승인 → Solapi SMS 발송
    │
    ├── 학생 데이터 공유
    │   L16 roster.studentCode  ←→  AFX students.notes "ASX 학생코드: {code}"
    │
    ├── 성적/학습 데이터 공유
    │   L16 results             →   AFX learning_records + asx_exam_results
    │
    ├── 수업 녹음 분석
    │   L16 lesson_recordings   →   AFX learning_records (notes)
    │
    └── 월간 보고서
        L16 GrowthPanel 상담평가서 ←→ AFX student_reports (초안→검토→확정)
```

### 학생 코드 연결 규칙
```
L16: roster.studentCode = "ABC123"
AFX: students.notes 에 "ASX 학생코드: ABC123" 포함
```

### 데이터 흐름 방향

| 데이터 | L16→AFX | AFX→L16 |
|---|---|---|
| 학생 명단 | ← 원본 (ASX) | 동기화 |
| 모의고사 결과 | → 전송 | - |
| 과제 제출 이벤트 | → 웹훅 | - |
| SMS 발송 승인 | - | ← 승인 후 |
| 월간 보고서 | → 초안 | ← 확정본 |
| 수업 녹음 분석 | → 전송 | - |

### 연동 파일
- `src/lib/afxBridge.ts` — L16↔AFX 데이터 변환 및 전송
- AFX: `server/supabaseAssignmentWebhook.ts` — 웹훅 수신
- AFX: `server/routers/coredesk.ts` — tRPC 라우터

### 환경변수 추가 필요
| 변수명 | 용도 |
|---|---|
| VITE_AFX_WEBHOOK_URL | AFX-Desk 웹훅 수신 URL |
| VITE_AFX_WEBHOOK_SECRET | 웹훅 서명 시크릿 |

### AFX-Desk 절대 규칙 (코드 내부)
- 화면 텍스트: **AFX-Desk** (브랜드명)
- 컴포넌트: `CoreDeskShell` / `.coredesk-shell` (변경 금지 — 계약 테스트)
- CSS 토큰: `--afx-*` 20종
- DB: Neon PostgreSQL (운영) + Neon (ASX 원본 분리)
- ORM: Drizzle (`drizzle-orm/neon-http`)
- 테스트 게이트: `pnpm check && pnpm test` (81/86 이상)
