-- Add user_id column to suppliers table for multi-tenant support
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS user_id uuid;

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_suppliers_user_id ON public.suppliers (user_id);

-- Drop existing views that depend on suppliers table
DROP VIEW IF EXISTS public.supplier_summary CASCADE;
DROP VIEW IF EXISTS public.supplier_review_queue CASCADE;

-- Recreate the supplier_summary view to include user_id
CREATE VIEW public.supplier_summary AS
SELECT
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
  s.user_id,
  COUNT(DISTINCT i.id) as invoice_count,
  MAX(i.date) as last_activity,
  s.created_at,
  s.updated_at
FROM public.suppliers s
LEFT JOIN public.invoices i ON i.supplier_id = s.id
GROUP BY s.id, s.name, s.legal_name, s.country, s.vat_number, s.vat_status, s.status, s.confidence_score, s.category, s.keywords, s.user_id, s.created_at, s.updated_at;

-- Recreate the supplier_review_queue view to include user_id
CREATE VIEW public.supplier_review_queue AS
SELECT
  s.*,
  COUNT(DISTINCT i.id) as invoice_count
FROM public.suppliers s
LEFT JOIN public.invoices i ON i.supplier_id = s.id
WHERE
  s.status NOT IN ('Merged', 'Blocked')
  AND (
    s.confidence_score < 50
    OR s.vat_status IN ('Pending', 'Invalid', 'Unknown')
    OR s.vat_number IS NULL
  )
GROUP BY s.id
ORDER BY s.confidence_score ASC, s.created_at DESC;

-- Add RLS policies for suppliers
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own suppliers
CREATE POLICY suppliers_select_own ON public.suppliers
  FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Policy: Users can insert their own suppliers
CREATE POLICY suppliers_insert_own ON public.suppliers
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own suppliers
CREATE POLICY suppliers_update_own ON public.suppliers
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can delete their own suppliers
CREATE POLICY suppliers_delete_own ON public.suppliers
  FOR DELETE
  USING (user_id = auth.uid());

-- Add RLS to supplier_contacts
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can access contacts of their suppliers
CREATE POLICY supplier_contacts_select ON public.supplier_contacts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE suppliers.id = supplier_contacts.supplier_id
      AND (suppliers.user_id = auth.uid() OR suppliers.user_id IS NULL)
    )
  );

CREATE POLICY supplier_contacts_insert ON public.supplier_contacts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE suppliers.id = supplier_contacts.supplier_id
      AND suppliers.user_id = auth.uid()
    )
  );

CREATE POLICY supplier_contacts_update ON public.supplier_contacts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE suppliers.id = supplier_contacts.supplier_id
      AND suppliers.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE suppliers.id = supplier_contacts.supplier_id
      AND suppliers.user_id = auth.uid()
    )
  );

CREATE POLICY supplier_contacts_delete ON public.supplier_contacts
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE suppliers.id = supplier_contacts.supplier_id
      AND suppliers.user_id = auth.uid()
    )
  );

-- Add RLS to supplier_audit
ALTER TABLE public.supplier_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see audit logs of their suppliers
CREATE POLICY supplier_audit_select ON public.supplier_audit
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE suppliers.id = supplier_audit.supplier_id
      AND (suppliers.user_id = auth.uid() OR suppliers.user_id IS NULL)
    )
  );

-- Policy: Service role can insert audit logs
CREATE POLICY supplier_audit_insert_service ON public.supplier_audit
  FOR INSERT
  WITH CHECK (true);

COMMENT ON COLUMN public.suppliers.user_id IS 'User ID for multi-tenant data isolation';
