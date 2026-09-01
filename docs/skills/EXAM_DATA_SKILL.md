# 스킬: L16 시험 데이터 공유 규칙
> 위반 시 "ExamPrepPanel에서 저장한 데이터가 ExamPlanPanel에 안 보임" 현상 발생

---

## 핵심 원칙

**두 패널이 같은 데이터를 다른 필드명으로 읽으면 반드시 버그 발생.**
→ 모든 시험 데이터 변환은 `src/lib/examUtils.ts` 단일 파일에서 처리.

---

## 필드명 매핑 규칙

| ExamPrepPanel 저장 (camelCase) | UnifiedExam (snake_case) |
|---|---|
| `studentCode` | `student_code` |
| `examType` | `exam_type` |
| `englishExamDate` | `english_exam_date` |
| `examRange` | `exam_range` |
| `examStart` | (대체용) |
| `examEnd` | (대체용) |

## 영어시험일 우선순위
```
englishExamDate → examStart → examEnd → ""
```
항상 이 순서로 대체. 비어있어도 필터에서 제외하지 않는다.

---

## 사용 방법

```typescript
// ExamPlanPanel.tsx 에서
import { loadLocalExams, supabaseToUnified, mergeExams } from "../../lib/examUtils";
import type { UnifiedExam } from "../../lib/examUtils";

// localStorage 로딩
const localExams = loadLocalExams(roster);

// Supabase 로딩
const sbExams = sbData.map((se: any) => supabaseToUnified(se, roster));

// 통합
const allExams = mergeExams(localExams, sbExams);
```

---

## 절대 금지

```typescript
// ❌ 직접 변환 금지
const local = parsed.map(ex => ({
  english_exam_date: ex.englishExamDate,  // 필드명 불일치 위험
  ...
}));

// ✅ 반드시 examUtils 사용
const local = loadLocalExams(roster);
```

---

## 반복 실수 기록

| 날짜 | 오류 | 원인 | 해결 |
|---|---|---|---|
| 2026-09-01 | 특정 학생만 보임 | englishExamDate 빈 문자열 필터 제외 | 필터 완화 |
| 2026-09-01 | 필드명 불일치 | ex.range vs ex.examRange 혼용 | examUtils 통합 |
| 2026-09-01 | studentName 없음 | ExamSchedule에 이름 없음 | roster 매핑 |
