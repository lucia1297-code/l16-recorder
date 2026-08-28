# L16 빌드 프로토콜 스킬
## l16-build-protocol

이 스킬은 L16 Student Recorder 프로젝트의 코드 수정/배포 시 반드시 준수해야 할 규칙입니다.

---

## ⛔ 절대 금지 규칙 (위반 시 빌드 실패)

### 1. interface/type/const 함수 내부 선언 금지
```tsx
// ❌ 절대 금지
function MyComponent() {
  interface MyType { id: string; }  // 빌드 오류
  const CONSTANT = "value";         // 중복 선언 위험
}

// ✅ 반드시 최상위 레벨
interface MyType { id: string; }
const CONSTANT = "value";
function MyComponent() { ... }
```

### 2. require() 사용 금지 (Vite ESM 환경)
```tsx
// ❌ 절대 금지
const { something } = require("./module");

// ✅ 동적 import 사용
const { something } = await import("./module");
// 또는 파일 상단에 정적 import
import { something } from "./module";
```

### 3. 같은 파일 내 상수 중복 선언 금지
```tsx
// 파일 위쪽에 이미 선언된 경우
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ❌ 금지 - 아래쪽에 또 선언
const SUPABASE_URL_GP = import.meta.env.VITE_SUPABASE_URL as string;

// ✅ 기존 상수 재사용
// SUPABASE_URL 그대로 사용
```

---

## 📏 파일 크기 규칙

### AdminPanel.tsx 크기 한계
- **150,000자 초과 시**: 즉시 신규 컴포넌트를 별도 파일로 분리
- 새 기능 추가 전 반드시 파일 크기 확인:

```python
# 파일 크기 확인
content = open("AdminPanel.tsx").read()
print(f"파일 크기: {len(content):,}자")
if len(content) > 150000:
    print("⚠️ 분리 필요!")
```

### 컴포넌트 분리 기준
- 단일 컴포넌트 **300줄 초과 시** → 별도 파일
- 새 탭 추가 시 → 항상 별도 파일로 생성

### Lazy import 패턴 (권장)
```tsx
// AdminPanel.tsx
function GrowthPanelLazy() {
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    import("./GrowthPanel").then(m => setComp(() => m.default));
  }, []);
  if (!Comp) return <div className="card"><p>로딩 중…</p></div>;
  return <Comp />;
}
```

---

## 🔄 배포 전 필수 체크리스트

### Step 1: 파일 크기 확인
```python
import requests, base64
r = requests.get(f"https://api.github.com/repos/{REPO}/contents/src/features/admin/AdminPanel.tsx", headers=headers)
content = base64.b64decode(r.json()["content"]).decode("utf-8")
print(f"파일 크기: {len(content):,}자")
assert len(content) < 200000, "파일이 너무 큼! 컴포넌트 분리 필요"
```

### Step 2: 중복 선언 확인
```python
import re
duplicates = {}
for match in re.finditer(r"^(?:const|interface|type) (\w+)", content, re.MULTILINE):
    name = match.group(1)
    duplicates[name] = duplicates.get(name, 0) + 1
for name, cnt in duplicates.items():
    if cnt > 1:
        print(f"⚠️ 중복 선언: {name} ({cnt}회)")
```

### Step 3: require() 사용 여부 확인
```python
if "require(" in content:
    print("⚠️ require() 발견! ESM으로 변환 필요")
```

### Step 4: GitHub 업로드 후 배포 대기
```python
import time
for _ in range(12):  # 최대 2분 대기
    time.sleep(10)
    r = requests.get(f"https://api.github.com/repos/{REPO}/actions/runs", headers=headers)
    latest = r.json()["workflow_runs"][0]
    if latest["status"] == "completed":
        if latest["conclusion"] == "success":
            print("✅ 배포 성공")
        else:
            print("❌ 배포 실패 - 로그 확인 필요")
        break
    print(f"배포 중... ({latest['status']})")
```

---

## 🏗️ 새 탭 추가 표준 절차

1. 새 파일 생성: `src/features/admin/NewTabPanel.tsx`
2. AdminPanel.tsx에 탭 타입 추가: `"newtab"`
3. 탭 버튼 추가
4. Lazy 렌더링 추가:
   ```tsx
   {tab === "newtab" && <NewTabLazy />}
   ```
5. Lazy 컴포넌트 추가 (AdminPanel 내):
   ```tsx
   function NewTabLazy() {
     const [Comp, setComp] = useState<React.ComponentType | null>(null);
     useEffect(() => { import("./NewTabPanel").then(m => setComp(() => m.default)); }, []);
     if (!Comp) return <div className="card"><p>로딩 중…</p></div>;
     return <Comp />;
   }
   ```
6. 파일 크기 확인 후 업로드
7. 배포 완료 확인

---

## 📋 과거 실패 사례 (참고)

| 날짜 | 원인 | 해결 |
|---|---|---|
| 2026-08-28 | interface 함수 내부 선언 | 최상위로 이동 |
| 2026-08-28 | SUPABASE_URL 중복 선언 | 기존 상수 재사용 |
| 2026-08-28 | require() 사용 | await import()로 변경 |
| 2026-08-28 | AdminPanel 206,000자 초과 | GrowthPanel 별도 파일 분리 |

---

## 배포 후 검증 규칙 (절대 생략 금지)

### 코드 레벨 검증
```bash
grep -n "require(" src/features/admin/AdminPanel.tsx  # 없어야 함
grep -c "const SUPABASE_URL" src/features/admin/AdminPanel.tsx  # 1이어야 함
```

### 배포 완료 조건
- `status: completed` AND `conclusion: success` 모두 확인
- 브라우저 강제 새로고침(Ctrl+Shift+R) 안내 필수

### 완료 선언 조건
검증 1(코드) + 검증 2(배포) 모두 통과한 경우에만 "완료"
