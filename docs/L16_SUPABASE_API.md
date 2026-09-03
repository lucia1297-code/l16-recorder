# L16 Supabase REST API 가이드
> CLINIC-WW / NS-WW / AFX-Desk 등 외부 시스템에서 L16 데이터에 접근하는 방법

---

## 접속 정보

```
Supabase URL : https://grvambgnkpbufapvhvjx.supabase.co
Anon Key     : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydmFtYmdua3BidWZhcHZodmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjI4NjAsImV4cCI6MjA5OTUzODg2MH0.DkbtProszEG9vi0cDZvKGsHevoLQ4OwV9wdHuXx0gpk
```

모든 요청에 헤더 필수:
```
apikey: <Anon Key>
Authorization: Bearer <Anon Key>
Content-Type: application/json
```

---

## 테이블 1: admin_exam_schedules (관리자 등록 시험)

> 민수쌤이 시험일정조사 탭에서 직접 등록한 시험 일정

### GET — 전체 조회
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/admin_exam_schedules?order=created_at.asc
```

### GET — 특정 학생 조회
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/admin_exam_schedules?student_code=eq.{학생코드}&order=created_at.asc
```

### 필드 구조
| 필드 | 타입 | 설명 |
|---|---|---|
| id | text | 고유 ID |
| student_code | text | 학생코드 (roster와 연결) |
| semester | text | "1" 또는 "2" |
| exam_type | text | "midterm"(중간) / "final"(기말) |
| subject | text | 과목명 (기본: 영어) |
| exam_start | text | 시험 시작일 (YYYY-MM-DD) |
| exam_end | text | 시험 종료일 (YYYY-MM-DD) |
| english_exam_date | text | **영어 시험일 (YYYY-MM-DD)** ★핵심 |
| exam_range | text | 시험 범위 |
| report_deadline | text | 직보일 (성적 보고 기한) |
| next_lesson_date | text | 다음 수업 예정일 |
| score | integer | 시험 결과 점수 |
| exam_paper_received | boolean | 시험지 수령 여부 |
| completed | boolean | 시험 완료 여부 |
| memo | text | 메모 |
| created_at | timestamptz | 생성일시 |
| updated_at | timestamptz | 수정일시 |

---

## 테이블 2: student_exams (학생 직접 등록 시험)

> 학생이 앱에서 직접 등록한 시험 일정

### GET — 전체 조회
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/student_exams?order=submitted_at.desc
```

### 필드 구조
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid | 고유 ID |
| student_code | text | 학생코드 |
| student_name | text | 학생 이름 |
| school | text | 학교 |
| grade | text | 학년 |
| semester | text | 학기 |
| exam_type | text | midterm / final |
| english_exam_date | text | 영어 시험일 |
| exam_range | text | 시험 범위 |
| report_deadline | text | 직보일 |
| exam_paper_submitted | boolean | 시험지 제출 여부 |
| next_lesson_date | text | 다음 수업일 |
| memo | text | 메모 |
| submitted_at | timestamptz | 등록일시 |
| admin_confirmed | boolean | 관리자 확인 여부 |

---

## 테이블 3: results (모의고사 성적)

### GET — 학생별 조회
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/results?student_code=eq.{학생코드}&order=date.asc
```

### 주요 필드
| 필드 | 설명 |
|---|---|
| student_code | 학생코드 |
| score | 점수 |
| date | 시험일 |
| wrong_answers | JSONB — 오답 목록 (이미 파싱된 객체) |
| reflection | JSONB — 학생 회고 |
| question_details | JSONB — 3문항 정밀조사 |

---

## 학생 코드 조회 방법

L16에는 별도 roster API가 없으므로, 아래 쿼리로 student_code 목록 조회:
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/results?select=student_code,name&order=name.asc
```
또는:
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/admin_exam_schedules?select=student_code&order=student_code.asc
```

---

## 백서원·김남교·이예린 학생 시험일정 조회

```bash
# 세 학생 한 번에 조회
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/admin_exam_schedules?student_code=in.(백서원코드,김남교코드,이예린코드)
```

학생코드를 모를 경우 이름으로 검색:
```
GET https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/results?name=eq.백서원&select=student_code,name&limit=1
```

---

## CLINIC-WW / NS-WW 연동 시 주의사항

1. **JSONB 필드** (`wrong_answers`, `reflection`, `question_details`)는 이미 파싱된 JSON 객체로 반환됨 — 추가 JSON.parse 불필요
2. **student_code**는 L16 내부 식별자 — AFX-Desk students.notes의 "ASX 학생코드: {code}"와 매핑
3. **두 테이블 모두 조회** 필요 — admin_exam_schedules(관리자 등록) + student_exams(학생 등록)
4. **anon key**는 읽기/쓰기 모두 가능 (RLS 정책: anon all)
5. 시험일이 비어있어도(`""`) 레코드는 존재함 — 필터 시 빈 문자열 고려

---

## 실제 curl 예시

```bash
curl "https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/admin_exam_schedules?order=english_exam_date.asc" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydmFtYmdua3BidWZhcHZodmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjI4NjAsImV4cCI6MjA5OTUzODg2MH0.DkbtProszEG9vi0cDZvKGsHevoLQ4OwV9wdHuXx0gpk" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydmFtYmdua3BidWZhcHZodmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjI4NjAsImV4cCI6MjA5OTUzODg2MH0.DkbtProszEG9vi0cDZvKGsHevoLQ4OwV9wdHuXx0gpk"
```
