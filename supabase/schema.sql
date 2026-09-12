-- L16 Student Recorder Lite — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- 이미 실행한 적이 있어도 안전합니다 (if not exists / add column if not exists 사용).

create table if not exists results (
  id uuid primary key,
  student_code text not null,
  name text not null,
  school text not null,
  grade text not null,
  exam_name text not null,
  year int not null,
  month int not null,
  round int not null,
  total_questions int not null,
  max_score int not null,
  provider text,
  teacher text,
  date date not null,
  score int not null,
  wrong_answers jsonb not null default '[]',
  reflection jsonb not null default '{}',
  question_details jsonb default '[]',
  submitted_at timestamptz not null default now()
);

alter table results add column if not exists provider text;
alter table results add column if not exists question_details jsonb default '[]';

create index if not exists idx_results_school on results (school);
create index if not exists idx_results_exam on results (exam_name);
create index if not exists idx_results_student on results (student_code);

-- ── 학생 명부 (관리자가 엑셀로 업로드) ──────────────────────
create table if not exists students (
  student_code text primary key,
  name text not null,
  school text not null,
  grade text not null,
  phone text not null,
  parent_phone text,
  teacher text,
  note text,
  registered_at timestamptz default now(),
  student_type text default '',
  exclude_from_reminder boolean default false,
  weekly_session int,
  lesson_days text default '{}',
  class_sessions text default '[]',
  last_assignment_saved_at timestamptz default null,
  student_status text default 'active',
  paused_at date,
  paused_reason text
);
alter table students add column if not exists registered_at timestamptz default now();
alter table students add column if not exists student_type text default '';
alter table students add column if not exists exclude_from_reminder boolean default false;
alter table students add column if not exists weekly_session int;
alter table students add column if not exists lesson_days text default '{}';
alter table students add column if not exists class_sessions text default '[]';
alter table students add column if not exists last_assignment_saved_at timestamptz default null;
alter table students add column if not exists student_status text default 'active';
alter table students add column if not exists paused_at date;
alter table students add column if not exists paused_reason text;
create index if not exists idx_students_phone on students (phone);

-- ── 레거시 마이그레이션: lesson_days 가 배열('["thu"]')로 저장된 행을 객체('{"thu":1}')로 변환 ──
-- 앱 코드(rosterStore.supabase.ts)는 로드 시 배열을 자동 변환하므로 필수는 아니지만,
-- DB를 깨끗하게 유지하고자 하면 Supabase SQL Editor 에서 아래 문을 한 번 실행하세요.
update students set lesson_days = (
  select coalesce(jsonb_object_agg(elem, to_jsonb(1)), '{}'::jsonb)::text
  from jsonb_array_elements_text(lesson_days::jsonb) elem
)
where lesson_days is not null and lesson_days like '[%';

alter table students enable row level security;
-- 조회/등록/수정 모두 로그인한 관리자만 가능 (학생은 앱을 통해 간접적으로만 조회됨)
drop policy if exists "authenticated select students" on students;
drop policy if exists "authenticated upsert students" on students;
drop policy if exists "authenticated update students" on students;
drop policy if exists "authenticated delete students" on students;
create policy "authenticated select students" on students for select to authenticated using (true);
create policy "authenticated upsert students" on students for insert to authenticated with check (true);
create policy "authenticated update students" on students for update to authenticated using (true);
create policy "authenticated delete students" on students for delete to authenticated using (true);

-- ── 학생 자가등록 신청 (승인 대기) ──────────────────────
create table if not exists pending_registrations (
  phone text primary key,
  name text not null,
  school text not null,
  grade text not null,
  requested_at timestamptz not null default now()
);
alter table pending_registrations enable row level security;
drop policy if exists "anon submit pending" on pending_registrations;
drop policy if exists "anon upsert pending" on pending_registrations;
drop policy if exists "authenticated select pending" on pending_registrations;
drop policy if exists "authenticated delete pending" on pending_registrations;
create policy "anon submit pending" on pending_registrations for insert to anon with check (true);
create policy "anon upsert pending" on pending_registrations for update to anon using (true);
create policy "authenticated select pending" on pending_registrations for select to authenticated using (true);
create policy "authenticated delete pending" on pending_registrations for delete to authenticated using (true);

-- ── 과제 관리 (관리자가 유형/지정개수 관리, 학생이 제출) ────────
create table if not exists assignment_types (
  id uuid primary key,
  name text not null,
  target_count int not null,
  kind text check (kind in ('mock_exam', 'general')),
  item_label text,
  scope_label text,
  completed_label text
);
alter table assignment_types add column if not exists kind text check (kind in ('mock_exam', 'general'));
alter table assignment_types add column if not exists item_label text;
alter table assignment_types add column if not exists scope_label text;
alter table assignment_types add column if not exists completed_label text;

create table if not exists assignment_submissions (
  id uuid primary key,
  student_code text not null references students(student_code) on delete cascade,
  type_id uuid not null references assignment_types(id) on delete cascade,
  round int not null,
  score int,
  wrong_numbers jsonb not null default '[]',
  submitted_at timestamptz not null default now(),
  -- 모의고사 세부풀이시간 (선택)
  total_minutes int,
  step1_minutes int,
  step2_minutes int,
  step3_minutes int,
  -- 모의고사 외 일반 과제용 (선택)
  item text,
  scope text,
  completed boolean,
  -- 메모 (선택 — 관리자가 추가할 수 있음)
  memo text,
  -- 강사 2차 점검 (선택)
  review_status text check (review_status in ('pending', 'pass', 'fail')) default 'pending',
  reviewed_at timestamptz,
  review_note text
);
alter table assignment_submissions add column if not exists total_minutes int;
alter table assignment_submissions add column if not exists step1_minutes int;
alter table assignment_submissions add column if not exists step2_minutes int;
alter table assignment_submissions add column if not exists step3_minutes int;
alter table assignment_submissions add column if not exists item text;
alter table assignment_submissions add column if not exists scope text;
alter table assignment_submissions add column if not exists completed boolean;
alter table assignment_submissions add column if not exists memo text;
alter table assignment_submissions add column if not exists review_status text default 'pending';
alter table assignment_submissions add column if not exists reviewed_at timestamptz;
alter table assignment_submissions add column if not exists review_note text;

create index if not exists idx_assignment_sub_student on assignment_submissions (student_code);
create index if not exists idx_assignment_sub_type on assignment_submissions (type_id);

alter table assignment_types enable row level security;
alter table assignment_submissions enable row level security;
-- 유형 관리는 관리자만. 제출/수정(방금 제출 수정하기)은 학생이 로그인 없이 하므로 익명 허용.
drop policy if exists "authenticated manage types" on assignment_types;
drop policy if exists "anon select types" on assignment_types;
drop policy if exists "anon insert submissions" on assignment_submissions;
drop policy if exists "anon update submissions" on assignment_submissions;
drop policy if exists "authenticated select submissions" on assignment_submissions;
create policy "authenticated manage types" on assignment_types for all to authenticated using (true) with check (true);
create policy "anon select types" on assignment_types for select to anon using (true);
create policy "anon insert submissions" on assignment_submissions for insert to anon with check (true);
create policy "anon update submissions" on assignment_submissions for update to anon using (true);
create policy "authenticated select submissions" on assignment_submissions for select to authenticated using (true);

-- ── 모의고사 세부풀이시간 설정 (관리자가 관리하는 단일 설정행, id는 항상 'default') ──
create table if not exists mock_exam_timing_config (
  id text primary key default 'default',
  enabled boolean not null default false,
  step1_label text not null default 'Step1',
  step1_range text not null default '18~28번',
  step1_target int not null default 10,
  step2_label text not null default 'Step2',
  step2_range text not null default '35~45번',
  step2_target int not null default 17,
  step3_label text not null default 'Step3',
  step3_range text not null default '29~34번',
  step3_target int not null default 17
);
alter table mock_exam_timing_config enable row level security;
drop policy if exists "authenticated manage timing config" on mock_exam_timing_config;
drop policy if exists "anon select timing config" on mock_exam_timing_config;
create policy "authenticated manage timing config" on mock_exam_timing_config for all to authenticated using (true) with check (true);
create policy "anon select timing config" on mock_exam_timing_config for select to anon using (true);

-- ── 과제 경고 누적 기록 (지정개수를 늘려 이월할 때, 여전히 경고 상태인 학생의 횟수를 누적) ──
create table if not exists assignment_warnings (
  student_code text not null,
  type_id uuid not null,
  count int not null default 0,
  last_warned_at timestamptz not null default now(),
  primary key (student_code, type_id)
);
alter table assignment_warnings enable row level security;
drop policy if exists "authenticated manage warnings" on assignment_warnings;
create policy "authenticated manage warnings" on assignment_warnings for all to authenticated using (true) with check (true);

-- ── 모의고사 성적 접수 확인 이력 (학생이 "과제 제출하기" 선택 시 매번 응답) ──
create table if not exists exam_checks (
  id uuid primary key,
  student_code text not null,
  student_name text not null,
  answer text not null check (answer in ('yes', 'no', 'na')),
  answered_at timestamptz not null default now()
);
alter table exam_checks enable row level security;
drop policy if exists "anon insert exam checks" on exam_checks;
drop policy if exists "authenticated select exam checks" on exam_checks;
create policy "anon insert exam checks" on exam_checks for insert to anon with check (true);
create policy "authenticated select exam checks" on exam_checks for select to authenticated using (true);

-- ── 학생별 과제입력 (강사 전용 개인 관리 표, 학생은 접근 불가) ──
create table if not exists teacher_logs (
  id text primary key,
  student_code text not null,
  date date not null,
  rows jsonb not null default '[]',
  exam_records jsonb not null default '[]',
  notes text,
  next_plan text,
  class_content text
);
alter table teacher_logs enable row level security;
drop policy if exists "authenticated manage teacher logs" on teacher_logs;
create policy "authenticated manage teacher logs" on teacher_logs for all to authenticated using (true) with check (true);

-- ── OTP 세션 (Edge Function 사용 시에만 필요, supabase/functions 참고) ──
create table if not exists otp_sessions (
  phone text primary key,
  code text not null,
  expires_at timestamptz not null,
  attempts int not null default 0
);
alter table otp_sessions enable row level security;
-- 정책을 추가하지 않음 = anon/authenticated 모두 기본 차단.
-- Edge Function 은 Service Role 키로 실행되어 RLS 를 우회하므로 정상 동작한다.

-- ── results 테이블 RLS 정책 ──────────────────────
--  - 학생 제출(insert)은 익명(anon) 허용 — 로그인 없이 폰으로 제출해야 하므로.
--  - 조회(select)는 인증된 사용자(관리자)만 허용 — Supabase Auth 로그인 필요.
-- 운영 전 반드시 검토하세요 (예: 학교/강사별 행 단위 제한 추가).
alter table results enable row level security;
drop policy if exists "anon insert" on results;
drop policy if exists "authenticated select" on results;
create policy "anon insert" on results for insert to anon with check (true);
create policy "authenticated select" on results for select to authenticated using (true);
