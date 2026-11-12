-- ============================================================================
-- Create Multi-Tenant public.crm_backups and public.whatsapp_messages Tables
-- Reversible Rollback: supabase/rollbacks/20261117_backups_whatsapp_rollback.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.crm_backups (Rolling 7-Day Multi-Tenant Backups)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  backup_name text NOT NULL,
  backup_type text NOT NULL DEFAULT 'auto',
  record_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_size_bytes integer DEFAULT 0,
  created_by text DEFAULT 'system',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.crm_backups
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_crm_backups_created_at
  ON public.crm_backups (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_backups_company
  ON public.crm_backups (company_id, created_at DESC);

ALTER TABLE public.crm_backups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_backups FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_backups TO authenticated;
GRANT ALL ON public.crm_backups TO service_role;

DROP POLICY IF EXISTS "Allow public access to crm_backups" ON public.crm_backups;
DROP POLICY IF EXISTS "tenant_isolation_crm_backups" ON public.crm_backups;
CREATE POLICY "tenant_isolation_crm_backups"
  ON public.crm_backups
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ----------------------------------------------------------------------------
-- 2. public.whatsapp_messages (Per-Tenant WhatsApp Cloud Dispatch History)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_name text,
  phone text NOT NULL,
  pipeline_id text,
  stage_id text,
  template_name text,
  message_body text,
  direction text DEFAULT 'outbound',
  status text DEFAULT 'sent',
  is_automated boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone
  ON public.whatsapp_messages (phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id
  ON public.whatsapp_messages (lead_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at
  ON public.whatsapp_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_company
  ON public.whatsapp_messages (company_id, created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

DROP POLICY IF EXISTS "Allow public access to whatsapp_messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "tenant_isolation_whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "tenant_isolation_whatsapp_messages"
  ON public.whatsapp_messages
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ----------------------------------------------------------------------------
-- 3. Add both tables to supabase_realtime publication idempotently
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'crm_backups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_backups;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END $$;

COMMIT;

