# 스킬: Supabase JSONB 파싱 규칙
> 위반 시 데이터가 조용히 빈 값으로 표시됨 — 절대 준수

## 핵심 규칙

Supabase REST API는 JSONB 컬럼을 **이미 JavaScript 객체**로 반환한다.
`JSON.parse()`를 다시 적용하면 오류 없이 조용히 실패한다.

## 반드시 사용할 헬퍼 함수

```typescript
// src/lib/parseJsonField.ts 또는 컴포넌트 상단에 선언
function parseJsonField(val: unknown): any {
  if (val === null || val === undefined) return null;
  if (typeof val === "object") return val;   // JSONB → 이미 객체
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return null; }
  }
  return null;
}
```

## 사용 패턴

```typescript
// ❌ 절대 금지
wrongAnswers: JSON.parse(r.wrong_answers || "[]")
reflection:   JSON.parse(r.reflection   || "{}")

// ✅ 반드시 이렇게
wrongAnswers: parseJsonField(r.wrong_answers) ?? []
reflection:   parseJsonField(r.reflection)   ?? {}
```

## 컬럼 타입별 처리

| 타입  | REST 반환값    | 처리            |
|-------|---------------|-----------------|
| JSONB | 객체/배열      | parseJsonField() |
| JSON  | 객체/배열      | parseJsonField() |
| TEXT  | 문자열         | JSON.parse() 가능|

## 증상 체크리스트
데이터가 "미작성" 또는 빈 배열로 표시될 때:
- [ ] JSONB 컬럼에 JSON.parse() 중복 적용 여부 확인
- [ ] parseJsonField() 교체 후 재확인
