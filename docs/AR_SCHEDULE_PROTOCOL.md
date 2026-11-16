# AR ↔ L16 일정 연동 규칙

L16(휴대폰 앱·PC)에서 수업 시간이나 시간표를 바꾸면 DB가 자동으로 `schedule_events`에 한 줄을 기록한다.
AR은 이 표를 읽어 작업을 지정하고, 처리 결과를 같은 줄에 보고한다. 관리자 화면의 **일정 알림** 탭에서 같은 내용을 볼 수 있다.

## 원칙
1. **AR은 작업을 시작할 때마다 먼저 L16 스케줄을 확인한다.** (아래 1·2번 조회)
2. 처리할 일은 `status in (new, assigned, in_progress)` 이다.
3. `kind = needs_decision` 줄은 선생님 확인 전에는 수업 데이터를 바꾸지 않는다.
4. 처리 후에는 반드시 `report`를 쓰고 `status`를 바꾼다.

## 접속
- 주소: `https://grvambgnkpbufapvhvjx.supabase.co/rest/v1/`
- 헤더: `apikey`, `Authorization: Bearer <anon key>` (키는 L16의 `.env.local` 참고, 문서에 적지 않는다)

## 1. 현재 시간표 읽기
- 정규 수업: `GET /students?select=student_code,name,student_status,lesson_schedule`
  - `lesson_schedule`은 JSON 문자열이다. 한 번 더 `JSON.parse` 해야 한다.
- 주별 예외·휴강·보충: `GET /timetable_blocks?select=*&order=week_start,day,start_slot`
  - `student_codes`, `absent_student_codes`도 JSON 문자열이다.
  - `week_start`가 비어 있으면 매주, 날짜가 있으면 그 주(일요일 날짜)에만 적용된다.

## 2. 처리할 변경 읽기
`GET /schedule_events?status=in.(new,assigned,in_progress)&order=created_at.asc`

주요 `kind`
| kind | 뜻 |
|---|---|
| lesson_schedule_changed | 정규 수업 시간 변경 (`payload.before/after`) |
| block_added / block_changed / block_removed | 주별 시간표 추가·이동·수정·삭제 (`payload.block`) |
| student_added / student_status_changed | 학생 등록, 상태 변경 |
| needs_decision | 선생님 확인 필요 |

## 3. 작업 지정과 보고
`PATCH /schedule_events?id=eq.<id>` 본문 예:
```json
{"status":"assigned","assigned_to":"AR","task_note":"해당 학생 다음 수업 자료 준비","updated_at":"2026-11-16T10:00:00Z"}
```
처리 후:
```json
{"status":"done","report":"자료 준비 완료, 11/21 토 수업 전 전달","updated_at":"..."}
```
상태 값: `new` → `assigned` → `in_progress` → `done` (불필요하면 `dismissed`).

## 주의
- `students`와 `timetable_blocks`를 AR이 직접 고치지 않는다. 수업 데이터 변경은 L16 화면에서 한다.
- 알림은 휴대폰·PC 어디서 입력했는지와 관계없이 DB 단계에서 기록된다.
