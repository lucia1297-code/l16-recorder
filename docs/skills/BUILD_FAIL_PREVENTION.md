# 스킬: L16 빌드 실패 방지 규칙
> 이 규칙 위반 시 GitHub Actions 빌드 실패

## 규칙 1 — interface/type/const 최상위 선언

```tsx
// ❌ 금지 — 함수 내부 선언
function MyComponent() {
  interface MyType { id: string; }
}

// ✅ 필수 — 최상위 레벨
interface MyType { id: string; }
function MyComponent() { ... }
```

## 규칙 2 — require() 사용 금지 (Vite ESM)

```tsx
// ❌ 금지
const { X } = require("./module");

// ✅ 정적 import 또는 dynamic import
import { X } from "./module";
const { X } = await import("./module");
```

## 규칙 3 — 상수 중복 선언 금지

같은 파일에 `SUPABASE_URL`, `SUPABASE_KEY` 등 1회만 선언.
새 컴포넌트 추가 전 파일 상단 상수 목록 반드시 확인.

## 규칙 4 — 파일 크기 한계

| 파일 | 한계 | 초과 시 |
|------|------|---------|
| AdminPanel.tsx | 150,000자 | 별도 파일 분리 |
| 단일 컴포넌트 | 300줄 | 별도 파일 분리 |

```python
# 파일 크기 확인
content = open("AdminPanel.tsx").read()
assert len(content) < 150000, f"분리 필요: {len(content):,}자"
```

## 규칙 5 — 새 탭 추가 표준 절차

```
1. src/features/admin/NewPanel.tsx 생성 (별도 파일)
2. AdminPanel.tsx 탭 타입에 추가
3. 탭 버튼 추가
4. Lazy 렌더링 추가:
   {tab === "newtab" && <NewPanelLazy />}
5. Lazy 컴포넌트 추가:
   function NewPanelLazy() {
     const [C,setC] = useState<React.ComponentType|null>(null);
     useEffect(()=>{ import("./NewPanel").then(m=>setC(()=>m.default)); },[]);
     if(!C) return <div className="card"><p>로딩 중…</p></div>;
     return <C />;
   }
```

## 배포 전 필수 체크

```python
# 중복 선언 확인
import re
for name, cnt in [(m, content.count(f"const {m} ")) for m in ["SUPABASE_URL","SUPABASE_KEY"]]:
    if cnt > 1: print(f"⚠️ 중복: {name}")

# require 확인
if "require(" in content: print("⚠️ require() 발견")

# 파일 크기 확인
if len(content) > 150000: print(f"⚠️ 파일 너무 큼: {len(content):,}자")
```

## 과거 실패 사례

| 날짜 | 원인 | 해결 |
|------|------|------|
| 2026-08-28 | interface 함수 내부 선언 | 최상위 이동 |
| 2026-08-28 | SUPABASE_URL 중복 선언 | 기존 변수 재사용 |
| 2026-08-28 | require() 사용 | await import()로 교체 |
| 2026-08-28 | AdminPanel 206,000자 초과 | GrowthPanel 별도 파일 분리 |
