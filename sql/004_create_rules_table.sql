-- Creates the rules table for Rules & Automation
-- id: primary key
-- name: text
-- conditions: jsonb
-- actions: jsonb
-- active: boolean
-- created_at, updated_at: timestamptz

CREATE TABLE IF NOT EXISTS public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  conditions jsonb DEFAULT '{}'::jsonb,
  actions jsonb DEFAULT '{}'::jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_active ON public.rules (active);
