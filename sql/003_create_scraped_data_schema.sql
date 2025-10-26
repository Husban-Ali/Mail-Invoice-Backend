-- Ensure invoices table has all required columns for scraped data feature
-- This migration adds missing columns for better data tracking

-- Add format column (PDF, XML, Scan)
alter table public.invoices add column if not exists format text default 'PDF';

-- Add status column (Parsed, Error, Pending)
alter table public.invoices add column if not exists status text default 'Pending';

-- Add invoice_number column
alter table public.invoices add column if not exists invoice_number text null;

-- Add updated_at timestamp
alter table public.invoices add column if not exists updated_at timestamp with time zone default now();

-- Create index on status for faster filtering
create index if not exists idx_invoices_status on public.invoices(status);

-- Create index on vendor for faster filtering
-- Some databases may not have a `vendor` column (may be `company`). Create index conditionally.
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'vendor'
  ) then
    execute 'create index if not exists idx_invoices_vendor on public.invoices(vendor)';
  elsif exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'company'
  ) then
    execute 'create index if not exists idx_invoices_vendor on public.invoices(company)';
  end if;
end$$;

-- Create index on format for faster filtering
create index if not exists idx_invoices_format on public.invoices(format);

-- Create index on created_at for date range queries
create index if not exists idx_invoices_created_at on public.invoices(created_at desc);

-- Add check constraint for status values
alter table public.invoices drop constraint if exists check_invoice_status;
alter table public.invoices add constraint check_invoice_status 
  check (status in ('Parsed', 'Error', 'Pending', 'Assigned', 'Approved'));

-- Add check constraint for format values
alter table public.invoices drop constraint if exists check_invoice_format;
alter table public.invoices add constraint check_invoice_format 
  check (format in ('PDF', 'XML', 'Scan'));

-- Update trigger to automatically set updated_at
create or replace function update_modified_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists update_invoices_modtime on public.invoices;
create trigger update_invoices_modtime
    before update on public.invoices
    for each row
    execute function update_modified_column();
