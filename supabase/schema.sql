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

-- 데모/MVP 기준 정책:
--  - 학생 제출(insert)은 익명(anon) 허용 — 로그인 없이 폰으로 제출해야 하므로.
--  - 조회(select)는 인증된 사용자(관리자)만 허용 — Supabase Auth 로그인 필요.
-- 운영 전 반드시 검토하세요 (예: 학교/강사별 행 단위 제한 추가).
alter table results enable row level security;
create policy "anon insert" on results for insert to anon with check (true);
create policy "authenticated select" on results for select to authenticated using (true);
