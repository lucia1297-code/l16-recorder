# 스킬: Supabase 무료 플랜 운영 규칙
> 결정: 옵션 A (무료 유지) — 2026-08-28 승인

## 현재 설정

| 항목 | 내용 |
|------|------|
| 프로젝트 | STUDENT_RECORDER |
| 플랜 | FREE |
| 리전 | ap-southeast-1 (싱가포르) |

## 무료 플랜 한도

| 항목 | 한도 | 현재 | 상태 |
|------|------|------|------|
| DB 용량 | 500MB | ~5MB | 🟢 안전 |
| Storage | 1GB | 증가 중 | 🟡 주의 |
| 동시 접속 | 2 | - | 🟡 주의 |
| **자동정지** | **7일 미사용** | - | 🔴 위험 |
| 백업 | 없음 | - | 🔴 위험 |

## 자동정지 방지 규칙

**7일간 API 요청 없으면 프로젝트 자동 정지 → 앱 불통**

방지 방법:
- 학생들이 주 1회 이상 앱 사용 → 자동 해결
- 방학/연휴: 관리자가 주 1회 관리자 탭 접속
- 긴 방학 전: Supabase 대시보드에서 "Pause Prevention" 설정 확인

## Storage 모니터링

시험지 이미지(exam-papers 버킷) 용량 주기적 확인:
```
https://supabase.com/dashboard/project/grvambgnkpbufapvhvjx/storage/buckets
```
1GB 초과 시 → Pro 업그레이드($25/월) 검토

## Pro 업그레이드 기준

아래 중 하나 해당 시 즉시 승인 요청:
- Storage 800MB 초과
- 학생 수 50명 초과
- 방학 2주 이상 지속 예정

## 이전 검토 결과 (2026-08-28)

Neon, Cloudflare 이전 **불필요**:
- Supabase 인증(RLS), Storage, REST API 모두 재구현 필요
- 3~4주 추가 작업 + 호환성 문제
- 현재 시스템에 맞게 최적화된 상태 유지

## JSONB 버그 기록

**증상**: wrong_answers, reflection 데이터 빈 값 표시  
**원인**: JSONB 컬럼에 JSON.parse() 이중 적용  
**해결**: parseJsonField() 헬퍼 사용 (SUPABASE_JSONB_SKILL.md 참조)
