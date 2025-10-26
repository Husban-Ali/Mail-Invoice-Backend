-- NEW: Core Flow Implementation - Enhanced suppliers schema with identity, VAT, contacts, keywords, and audit

-- Drop and recreate suppliers with extended schema
DROP TABLE IF EXISTS public.suppliers CASCADE;

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  name text NOT NULL,
  legal_name text,
  aliases text[], -- alternative names
  
  -- VAT and location
  vat_number text, -- structured VAT (e.g., DE123456789)
  vat_status text DEFAULT 'Unknown', -- Unknown | Valid | Invalid | Pending
  vat_validated_at timestamptz,
  country text,
  
  -- Address
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  
  -- Contact
  website text,
  email text,
  phone text,
  
  -- Business details
  category text,
  
  -- Status and confidence
  status text DEFAULT 'Active', -- Active | Inactive | Merged | Blocked
  confidence_score numeric DEFAULT 0, -- 0-100, computed from validation signals
  
  -- Keywords for email matching (additional search terms per supplier)
  keywords text[], -- e.g., ["Amazon", "AWS", "amazon.com"]
  
  -- Accounting/ERP integration fields
  accounting_code text,
  payment_terms text,
  currency text DEFAULT 'USD',
  
  -- Metadata and timestamps
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_suppliers_status ON public.suppliers (status);
CREATE INDEX idx_suppliers_vat_number ON public.suppliers (vat_number);
CREATE INDEX idx_suppliers_country ON public.suppliers (country);
CREATE INDEX idx_suppliers_name_lower ON public.suppliers (lower(name));
CREATE INDEX idx_suppliers_keywords ON public.suppliers USING gin(keywords);

-- Supplier contacts (1:many)
CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  email text,
  phone text,
  is_primary boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_supplier_contacts_supplier_id ON public.supplier_contacts (supplier_id);
CREATE INDEX idx_supplier_contacts_email ON public.supplier_contacts (email);

-- Supplier audit log (track all changes)
CREATE TABLE IF NOT EXISTS public.supplier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  action text NOT NULL, -- created | updated | merged | blocked | activated | deactivated
  changed_fields jsonb, -- before/after snapshot
  changed_by text, -- user email or system
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_supplier_audit_supplier_id ON public.supplier_audit (supplier_id);
CREATE INDEX idx_supplier_audit_created_at ON public.supplier_audit (created_at DESC);

-- Link invoices to suppliers (add foreign key to invoices table if it doesn't exist)
-- NOTE: Run this only if your invoices table exists and doesn't already have supplier_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoices') THEN
    -- Add supplier_id column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='supplier_id') THEN
      ALTER TABLE public.invoices ADD COLUMN supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
      CREATE INDEX idx_invoices_supplier_id ON public.invoices (supplier_id);
    END IF;
  END IF;
END $$;

-- Create a view for supplier summary (used by directory list)
CREATE OR REPLACE VIEW public.supplier_summary AS
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
  COUNT(DISTINCT i.id) as invoice_count,
  MAX(i.date) as last_activity,
  s.created_at,
  s.updated_at
FROM public.suppliers s
LEFT JOIN public.invoices i ON i.supplier_id = s.id
GROUP BY s.id, s.name, s.legal_name, s.country, s.vat_number, s.vat_status, s.status, s.confidence_score, s.category, s.keywords, s.created_at, s.updated_at;

-- Create a view for uncertain matches / review queue (suppliers with low confidence or pending VAT)
CREATE OR REPLACE VIEW public.supplier_review_queue AS
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

COMMENT ON TABLE public.suppliers IS 'Master supplier data with identity, VAT, contacts, and keywords for email matching';
COMMENT ON TABLE public.supplier_contacts IS 'Contact persons for each supplier';
COMMENT ON TABLE public.supplier_audit IS 'Audit trail for all supplier changes';
COMMENT ON VIEW public.supplier_summary IS 'Summary view with invoice count and last activity for directory list';
COMMENT ON VIEW public.supplier_review_queue IS 'Suppliers requiring review (low confidence, missing VAT, etc.)';
