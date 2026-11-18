-- Draft only. Do not apply to the operating Supabase project without separate approval.
create table if not exists public.lesson_judgment_events (
  event_id uuid primary key,
  schema_version text not null,
  event_type text not null check (event_type in (
    'item_outcome', 'judgment_changed', 'new_discovery', 'explanation_effect',
    'follow_up_review', 'lesson_plan_saved', 'lesson_review_saved'
  )),
  recorded_at timestamptz not null,
  lesson_date date not null,
  student_code text,
  session_ref text,
  item_id text,
  item_version text,
  judgment_code text check (judgment_code is null or judgment_code in ('J-01','J-02','J-03','J-04')),
  outcome text check (outcome is null or outcome in ('correct','incorrect','hold','unverified')),
  reason_tags jsonb not null default '[]'::jsonb,
  record_status text not null check (record_status in ('quick_saved','needs_detail','complete')),
  detail jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists lesson_judgment_events_student_date_idx
  on public.lesson_judgment_events (created_by, student_code, lesson_date desc);
create index if not exists lesson_judgment_events_item_idx
  on public.lesson_judgment_events (created_by, item_id, recorded_at desc);

create table if not exists public.lesson_judgment_revisions (
  revision_id uuid primary key,
  event_id uuid not null references public.lesson_judgment_events(event_id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  created_at timestamptz not null,
  created_by uuid not null default auth.uid(),
  detail jsonb not null,
  unique (event_id, revision_no)
);

create index if not exists lesson_judgment_revisions_event_idx
  on public.lesson_judgment_revisions (event_id, revision_no);

alter table public.lesson_judgment_events enable row level security;
alter table public.lesson_judgment_revisions enable row level security;

drop policy if exists "lesson judgment event owner read" on public.lesson_judgment_events;
create policy "lesson judgment event owner read" on public.lesson_judgment_events
  for select to authenticated using (created_by = auth.uid());
drop policy if exists "lesson judgment event owner insert" on public.lesson_judgment_events;
create policy "lesson judgment event owner insert" on public.lesson_judgment_events
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "lesson judgment revision owner read" on public.lesson_judgment_revisions;
create policy "lesson judgment revision owner read" on public.lesson_judgment_revisions
  for select to authenticated using (created_by = auth.uid());
drop policy if exists "lesson judgment revision owner insert" on public.lesson_judgment_revisions;
create policy "lesson judgment revision owner insert" on public.lesson_judgment_revisions
  for insert to authenticated with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.lesson_judgment_events as parent
      where parent.event_id = lesson_judgment_revisions.event_id
        and parent.created_by = auth.uid()
    )
  );

-- No anon, update, or delete policies: captured events and revisions are append-only.
