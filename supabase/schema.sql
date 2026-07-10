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

-- 데모용: 익명 삽입/조회 허용. 운영 시 반드시 정책을 강화하세요.
alter table results enable row level security;
create policy "anon insert" on results for insert to anon with check (true);
create policy "anon select" on results for select to anon using (true);
