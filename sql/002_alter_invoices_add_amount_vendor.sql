-- Adds commonly needed fields to invoices table if they don't exist yet
alter table public.invoices add column if not exists amount numeric null;
alter table public.invoices add column if not exists currency text null;
alter table public.invoices add column if not exists vendor text null;
