-- ASX Student Recorder Lite — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

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
  teacher text,
  date date not null,
  score int not null,
  wrong_answers jsonb not null default '[]',
  reflection jsonb not null default '{}',
  submitted_at timestamptz not null default now()
);

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
  note text
);
create index if not exists idx_students_phone on students (phone);

alter table students enable row level security;
-- 조회/등록/수정 모두 로그인한 관리자만 가능 (학생은 앱을 통해 간접적으로만 조회됨)
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
-- 제출(insert/upsert)은 학생 본인이 로그인 없이 하므로 익명 허용.
-- 조회/승인(삭제)은 로그인한 관리자만.
create policy "anon submit pending" on pending_registrations for insert to anon with check (true);
create policy "anon upsert pending" on pending_registrations for update to anon using (true);
create policy "authenticated select pending" on pending_registrations for select to authenticated using (true);
create policy "authenticated delete pending" on pending_registrations for delete to authenticated using (true);

-- ── 과제 관리 (관리자가 유형/지정개수 관리, 학생이 제출) ────────
create table if not exists assignment_types (
  id uuid primary key,
  name text not null,
  target_count int not null
);

create table if not exists assignment_submissions (
  id uuid primary key,
  student_code text not null references students(student_code) on delete cascade,
  type_id uuid not null references assignment_types(id) on delete cascade,
  round int not null,
  score int,
  wrong_numbers jsonb not null default '[]',
  submitted_at timestamptz not null default now()
);
create index if not exists idx_assignment_sub_student on assignment_submissions (student_code);
create index if not exists idx_assignment_sub_type on assignment_submissions (type_id);

alter table assignment_types enable row level security;
alter table assignment_submissions enable row level security;
-- 유형 관리는 관리자만. 제출은 학생이 로그인 없이 하므로 익명 허용.
create policy "authenticated manage types" on assignment_types for all to authenticated using (true) with check (true);
create policy "anon insert submissions" on assignment_submissions for insert to anon with check (true);
create policy "authenticated select submissions" on assignment_submissions for select to authenticated using (true);
create policy "anon select types" on assignment_types for select to anon using (true);

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
create policy "anon insert" on results for insert to anon with check (true);
create policy "authenticated select" on results for select to authenticated using (true);
