-- Create export templates and runs for per-user exports
create extension if not exists pgcrypto;

create table if not exists public.export_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  entity text not null, -- invoices | suppliers | rules | emails | audit
  format text not null default 'CSV', -- CSV | JSON | Excel | PDF
  fields jsonb not null default '[]'::jsonb, -- array of field names/paths
  filters jsonb null, -- filter config
  options jsonb null, -- ordering, etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.export_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  template_id uuid null references public.export_templates(id) on delete set null,
  name text null,
  status text not null default 'Queued', -- Queued | Running | Completed | Failed
  format text not null default 'CSV',
  entity text not null,
  started_at timestamptz default now(),
  finished_at timestamptz null,
  duration_ms integer null,
  count_rows integer null,
  file_path text null,
  file_url text null,
  error text null,
  params jsonb null
);

create index if not exists idx_export_templates_user on public.export_templates(user_id);
create index if not exists idx_export_runs_user on public.export_runs(user_id);
create index if not exists idx_export_runs_status on public.export_runs(status);

alter table public.export_templates enable row level security;
alter table public.export_runs enable row level security;

drop policy if exists export_templates_owner_policy on public.export_templates;
create policy export_templates_owner_policy on public.export_templates
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists export_runs_owner_policy on public.export_runs;
create policy export_runs_owner_policy on public.export_runs
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
