-- Multi-tenant ownership: add user_id to all core tables and enable RLS
-- NOTE: This migration is additive and non-destructive. Existing rows will have NULL user_id
-- and will be inaccessible to non-service-role clients once RLS is enabled unless policies allow NULL.
-- The backend uses the service role and will continue to access data, but controllers will scope by user_id.

-- Helper: add column if missing
DO $$
BEGIN
  -- invoices
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN user_id uuid NULL;
    CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON public.invoices(user_id);
  END IF;

  -- suppliers
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suppliers' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.suppliers ADD COLUMN user_id uuid NULL;
    CREATE INDEX IF NOT EXISTS idx_suppliers_user_id ON public.suppliers(user_id);
  END IF;

  -- supplier_contacts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_contacts' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.supplier_contacts ADD COLUMN user_id uuid NULL;
    CREATE INDEX IF NOT EXISTS idx_supplier_contacts_user_id ON public.supplier_contacts(user_id);
  END IF;

  -- supplier_audit
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_audit' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.supplier_audit ADD COLUMN user_id uuid NULL;
    CREATE INDEX IF NOT EXISTS idx_supplier_audit_user_id ON public.supplier_audit(user_id);
  END IF;

  -- rules
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rules' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.rules ADD COLUMN user_id uuid NULL;
    CREATE INDEX IF NOT EXISTS idx_rules_user_id ON public.rules(user_id);
  END IF;

  -- accounts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name='user_id'
    ) THEN
      ALTER TABLE public.accounts ADD COLUMN user_id uuid NULL;
      CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
    END IF;
  END IF;

  -- app_settings (per-user config)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_settings' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.app_settings ADD COLUMN user_id uuid NULL;
    -- Create a unique composite key while preserving existing PK on key
    -- If you want to strictly enforce per-user uniqueness, consider dropping the old PK and creating a composite PK.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_app_settings_user_key ON public.app_settings(COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
    CREATE INDEX IF NOT EXISTS idx_app_settings_user_id ON public.app_settings(user_id);
  END IF;

  -- retrieval_logs (per-user history)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='retrieval_logs' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.retrieval_logs ADD COLUMN user_id uuid NULL;
    CREATE INDEX IF NOT EXISTS idx_retrieval_logs_user_id ON public.retrieval_logs(user_id);
  END IF;
END$$;

-- Recreate supplier views to include user_id for controller filtering
-- Note: CREATE OR REPLACE VIEW cannot change column names/order/arity. Drop first to avoid 42P16 errors.
DROP VIEW IF EXISTS public.supplier_summary;
CREATE OR REPLACE VIEW public.supplier_summary AS
SELECT
  s.user_id,
  s.id,
  s.name,
  s.legal_name,
  s.country,
  s.vat_number,
  s.vat_status,
  s.status,
  s.confidence_score,
  s.category,
  s.keywords,
  COUNT(DISTINCT i.id) as invoice_count,
  MAX(i.date) as last_activity,
  s.created_at,
  s.updated_at
FROM public.suppliers s
LEFT JOIN public.invoices i ON i.supplier_id = s.id AND (i.user_id = s.user_id OR i.user_id IS NULL)
GROUP BY s.user_id, s.id, s.name, s.legal_name, s.country, s.vat_number, s.vat_status, s.status, s.confidence_score, s.category, s.keywords, s.created_at, s.updated_at;

DROP VIEW IF EXISTS public.supplier_review_queue;
CREATE OR REPLACE VIEW public.supplier_review_queue AS
SELECT
  s.*,
  COUNT(DISTINCT i.id) as invoice_count
FROM public.suppliers s
LEFT JOIN public.invoices i ON i.supplier_id = s.id AND (i.user_id = s.user_id OR i.user_id IS NULL)
WHERE
  s.status NOT IN ('Merged', 'Blocked')
  AND (
    s.confidence_score < 50
    OR s.vat_status IN ('Pending', 'Invalid', 'Unknown')
    OR s.vat_number IS NULL
  )
GROUP BY s.user_id, s.id
ORDER BY s.confidence_score ASC, s.created_at DESC;

-- Enable RLS and add per-user policies (no effect for service role)
DO $$
BEGIN
  PERFORM 1 FROM pg_policy WHERE polname = 'invoices_rls_select';
  EXCEPTION WHEN undefined_table THEN
    -- ignore
END$$;

-- Enable row level security
ALTER TABLE IF EXISTS public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.supplier_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.retrieval_logs ENABLE ROW LEVEL SECURITY;

-- Create or replace simple owner-based policies
DO $$
BEGIN
  -- invoices
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='inv_owner_select') THEN
    CREATE POLICY inv_owner_select ON public.invoices FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='inv_owner_insert') THEN
    CREATE POLICY inv_owner_insert ON public.invoices FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='inv_owner_update') THEN
    CREATE POLICY inv_owner_update ON public.invoices FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='inv_owner_delete') THEN
    CREATE POLICY inv_owner_delete ON public.invoices FOR DELETE USING (user_id = auth.uid());
  END IF;

  -- suppliers
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='sup_owner_select') THEN
    CREATE POLICY sup_owner_select ON public.suppliers FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='sup_owner_insert') THEN
    CREATE POLICY sup_owner_insert ON public.suppliers FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='sup_owner_update') THEN
    CREATE POLICY sup_owner_update ON public.suppliers FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='sup_owner_delete') THEN
    CREATE POLICY sup_owner_delete ON public.suppliers FOR DELETE USING (user_id = auth.uid());
  END IF;

  -- supplier_contacts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_contacts' AND policyname='supc_owner_select') THEN
    CREATE POLICY supc_owner_select ON public.supplier_contacts FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_contacts' AND policyname='supc_owner_insert') THEN
    CREATE POLICY supc_owner_insert ON public.supplier_contacts FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_contacts' AND policyname='supc_owner_update') THEN
    CREATE POLICY supc_owner_update ON public.supplier_contacts FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_contacts' AND policyname='supc_owner_delete') THEN
    CREATE POLICY supc_owner_delete ON public.supplier_contacts FOR DELETE USING (user_id = auth.uid());
  END IF;

  -- supplier_audit
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_audit' AND policyname='supa_owner_select') THEN
    CREATE POLICY supa_owner_select ON public.supplier_audit FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_audit' AND policyname='supa_owner_insert') THEN
    CREATE POLICY supa_owner_insert ON public.supplier_audit FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;

  -- rules
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rules' AND policyname='rules_owner_select') THEN
    CREATE POLICY rules_owner_select ON public.rules FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rules' AND policyname='rules_owner_insert') THEN
    CREATE POLICY rules_owner_insert ON public.rules FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rules' AND policyname='rules_owner_update') THEN
    CREATE POLICY rules_owner_update ON public.rules FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rules' AND policyname='rules_owner_delete') THEN
    CREATE POLICY rules_owner_delete ON public.rules FOR DELETE USING (user_id = auth.uid());
  END IF;

  -- accounts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounts' AND policyname='acc_owner_select') THEN
      CREATE POLICY acc_owner_select ON public.accounts FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounts' AND policyname='acc_owner_insert') THEN
      CREATE POLICY acc_owner_insert ON public.accounts FOR INSERT WITH CHECK (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounts' AND policyname='acc_owner_update') THEN
      CREATE POLICY acc_owner_update ON public.accounts FOR UPDATE USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounts' AND policyname='acc_owner_delete') THEN
      CREATE POLICY acc_owner_delete ON public.accounts FOR DELETE USING (user_id = auth.uid());
    END IF;
  END IF;

  -- app_settings
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='apps_owner_select') THEN
    CREATE POLICY apps_owner_select ON public.app_settings FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='apps_owner_upsert') THEN
    CREATE POLICY apps_owner_upsert ON public.app_settings FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='apps_owner_update') THEN
    CREATE POLICY apps_owner_update ON public.app_settings FOR UPDATE USING (user_id = auth.uid());
  END IF;

  -- retrieval_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='retrieval_logs' AND policyname='logs_owner_select') THEN
    CREATE POLICY logs_owner_select ON public.retrieval_logs FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='retrieval_logs' AND policyname='logs_owner_insert') THEN
    CREATE POLICY logs_owner_insert ON public.retrieval_logs FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
END$$;
