-- app_settings: stores global settings (JSON)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- keep updated_at fresh on update
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute procedure public.set_updated_at();

-- retrieval_logs: records each retrieval run result
create table if not exists public.retrieval_logs (
  id bigserial primary key,
  account_id uuid null,
  email text null,
  status text not null check (status in ('ok','error')),
  fetched int null,
  error text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_retrieval_logs_created_at on public.retrieval_logs (created_at desc);
create index if not exists idx_retrieval_logs_email on public.retrieval_logs (email);
