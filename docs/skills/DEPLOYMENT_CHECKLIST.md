# 스킬: L16 배포 체크리스트
> 모든 코드 수정 후 반드시 순서대로 실행

## Step 1 — 코드 레벨 검증

```python
with open("src/features/admin/AdminPanel.tsx") as f:
    content = f.read()

# 1. 파일 크기
print(f"크기: {len(content):,}자", "⚠️ 분리 필요" if len(content) > 150000 else "✅")

# 2. require 금지
print("require:", "❌ 발견!" if "require(" in content else "✅ 없음")

# 3. 상수 중복
for var in ["SUPABASE_URL", "SUPABASE_KEY"]:
    cnt = content.count(f"const {var} ")
    print(f"{var}: {'❌ 중복!' if cnt > 1 else '✅'} ({cnt}회)")
```

## Step 2 — GitHub 업로드

```python
r = requests.put(f"https://api.github.com/repos/{REPO}/contents/{path}",
    headers=headers,
    json={"message": "커밋 메시지", "content": encoded, "sha": sha})
assert r.status_code in [200, 201], f"업로드 실패: {r.status_code}"
```

## Step 3 — 배포 완료 확인

```python
import time
for _ in range(18):  # 최대 3분
    time.sleep(10)
    r = requests.get(f"https://api.github.com/repos/{REPO}/actions/runs", headers=headers)
    latest = r.json()["workflow_runs"][0]
    status, conclusion = latest["status"], latest["conclusion"]
    if status == "completed":
        assert conclusion == "success", f"❌ 빌드 실패: {conclusion}"
        print("✅ 배포 완료")
        break
    print(f"진행 중... ({status})")
```

## Step 4 — 완료 선언 조건

모두 통과해야만 "완료" 선언 가능:
- [x] 코드 레벨 검증 통과
- [x] GitHub 업로드 200/201
- [x] Actions status=completed, conclusion=success
- [x] 브라우저 강제 새로고침(Ctrl+Shift+R) 안내

## 절대 금지

- 검증 없이 "완료됐습니다" 선언
- 배포 상태 확인 없이 "확인해보세요" 안내
- in_progress 상태에서 완료 선언
