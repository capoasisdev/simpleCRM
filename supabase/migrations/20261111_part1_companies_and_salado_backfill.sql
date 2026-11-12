-- ============================================================================
-- PART 1: Multi-Tenant Foundation & Non-Breaking saladO Backfill
-- Status: Zero-downtime additive migration.
-- Preserves 100% of live saladO rows as Company #1 (billing-exempt).
-- Uses temporary transitional DEFAULT on company_id so existing live clients
-- (web UI, Capacitor APK, webhooks) continue working until Parts 2-4 drop it.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create public.companies tenant directory
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  subscription_status text NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'expired', 'cancelled')),
  trial_starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  seat_limit integer NOT NULL DEFAULT 5 CHECK (seat_limit >= 1),
  price_per_seat_inr integer NOT NULL DEFAULT 999,
  is_billing_exempt boolean NOT NULL DEFAULT false,
  owner_email text,
  owner_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Protect companies table against arbitrary anon mutations right away
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Part 1 transitional read access to companies" ON public.companies;
CREATE POLICY "Part 1 transitional read access to companies"
  ON public.companies
  FOR SELECT
  USING (true);

GRANT SELECT ON public.companies TO anon, authenticated;
GRANT ALL ON public.companies TO service_role;

-- Seed Company #1: saladO (deterministic UUID)
INSERT INTO public.companies (
  id,
  name,
  slug,
  subscription_status,
  trial_starts_at,
  trial_ends_at,
  seat_limit,
  is_billing_exempt
) VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'saladO',
  'salado',
  'active',
  now(),
  now() + interval '100 years',
  100,
  true
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  subscription_status = 'active',
  is_billing_exempt = true;

-- ----------------------------------------------------------------------------
-- 2. Add nullable company_id (+ meta_config.page_id) across all live tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_users                 ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.pipelines                 ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.leads                     ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.deals                     ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activities           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups                ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.lead_routing_config       ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.meta_config               ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.meta_config               ADD COLUMN IF NOT EXISTS page_id text;
ALTER TABLE public.connected_forms           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.meta_capi_logs            ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.email_settings            ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.email_templates           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.email_logs                ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.crm_todo_lists            ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.crm_todos                 ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.ai_chat_logs              ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.support_tickets           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.password_reset_codes      ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.custom_field_definitions  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- Optional/unpushed tables from older local migrations (safe if present in staging/future)
DO $$
BEGIN
  IF to_regclass('public.crm_backups') IS NOT NULL THEN
    ALTER TABLE public.crm_backups ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Backfill 100% of existing production rows to saladO
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_salado_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_salado_id) THEN
    RAISE EXCEPTION 'saladO company record missing during Part 1 backfill';
  END IF;

  UPDATE public.crm_users                SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.pipelines                SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.leads                    SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.deals                    SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.lead_activities          SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.follow_ups               SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.lead_routing_config      SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.meta_config              SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.connected_forms          SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.meta_capi_logs           SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.email_settings           SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.email_templates          SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.email_logs               SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.crm_todo_lists           SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.crm_todos                SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.ai_chat_logs             SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.support_tickets          SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.password_reset_codes     SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.custom_field_definitions SET company_id = v_salado_id WHERE company_id IS NULL;

  IF to_regclass('public.crm_backups') IS NOT NULL THEN
    UPDATE public.crm_backups SET company_id = v_salado_id WHERE company_id IS NULL;
  END IF;
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    UPDATE public.whatsapp_messages SET company_id = v_salado_id WHERE company_id IS NULL;
  END IF;

  -- Backfill meta_config.page_id from connected_forms when available
  UPDATE public.meta_config mc
  SET page_id = (
    SELECT cf.page_id
    FROM public.connected_forms cf
    WHERE cf.company_id = v_salado_id
      AND cf.page_id IS NOT NULL
      AND cf.page_id <> ''
    ORDER BY cf.created_at DESC
    LIMIT 1
  )
  WHERE mc.company_id = v_salado_id
    AND (mc.page_id IS NULL OR mc.page_id = '');
END $$;

-- ----------------------------------------------------------------------------
-- 4. Enforce NOT NULL + Transitional saladO DEFAULT (removed in Parts 2-4)
--    Clean up hardcoded 'pranav' SQL column defaults on future rows
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_users                 ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.pipelines                 ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.leads                     ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.deals                     ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.lead_activities           ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.follow_ups                ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.lead_routing_config       ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.meta_config               ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.connected_forms           ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.meta_capi_logs            ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.email_settings            ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.email_templates           ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.email_logs                ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_todo_lists            ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_todos                 ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.ai_chat_logs              ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.support_tickets           ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.password_reset_codes      ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.custom_field_definitions  ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.crm_backups') IS NOT NULL THEN
    ALTER TABLE public.crm_backups ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
  END IF;
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_messages ALTER COLUMN company_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid, ALTER COLUMN company_id SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.leads               ALTER COLUMN assigned_to SET DEFAULT 'unassigned';
ALTER TABLE public.lead_routing_config ALTER COLUMN default_assignee SET DEFAULT 'unassigned';

-- ----------------------------------------------------------------------------
-- 5. Indexes & Per-Company Uniqueness Constraints
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crm_users_company           ON public.crm_users(company_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_company           ON public.pipelines(company_id, is_default);
CREATE INDEX IF NOT EXISTS idx_leads_company_created       ON public.leads(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_pipeline      ON public.leads(company_id, pipeline_id, stage);
CREATE INDEX IF NOT EXISTS idx_leads_company_leadgen_top   ON public.leads(company_id, leadgen_id) WHERE leadgen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_company_leadgen_json  ON public.leads(company_id, ((custom_fields->>'leadgen_id')));
CREATE INDEX IF NOT EXISTS idx_deals_company_created       ON public.deals(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_company     ON public.lead_activities(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_company_due      ON public.follow_ups(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_connected_forms_company_src ON public.connected_forms(company_id, source);
CREATE INDEX IF NOT EXISTS idx_meta_config_page_id         ON public.meta_config(page_id) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meta_capi_logs_company      ON public.meta_capi_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_templates_company     ON public.email_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_company          ON public.email_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_todo_lists_company      ON public.crm_todo_lists(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_todos_company           ON public.crm_todos(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_company        ON public.ai_chat_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_company     ON public.support_tickets(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_codes_company     ON public.password_reset_codes(company_id, email);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs_company   ON public.custom_field_definitions(company_id, pipeline_id);

DO $$
BEGIN
  IF to_regclass('public.crm_backups') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_crm_backups_company ON public.crm_backups(company_id, created_at DESC);
  END IF;
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_company ON public.whatsapp_messages(company_id, created_at DESC);
  END IF;
END $$;

-- Guarantee at most 1 singleton configuration row per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_config_unique_company         ON public.meta_config(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_routing_config_unique_company ON public.lead_routing_config(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_settings_unique_company      ON public.email_settings(company_id);

-- ----------------------------------------------------------------------------
-- 6. Append company_id to public.crm_users_safe (preserving exact existing column order)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.crm_users_safe AS
SELECT
  id,
  created_at,
  name,
  email,
  role,
  permissions,
  password_updated_at,
  must_change_password,
  (password_hash IS NOT NULL AND password_hash <> ''::text) AS is_secured,
  CASE
    WHEN pin IS NOT NULL THEN '••••'::text
    ELSE NULL::text
  END AS masked_pin,
  company_id
FROM public.crm_users;

-- ----------------------------------------------------------------------------
-- 7. Seed helper for default email templates when provisioning new companies
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_email_templates(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_templates WHERE company_id = p_company_id) THEN
    INSERT INTO public.email_templates (company_id, name, subject, body_html)
    VALUES
      (
        p_company_id,
        'Welcome Introduction',
        'Thank you for connecting with us, {{name}}',
        '<p>Hi {{name}},</p><p>Thank you for reaching out to us. We have received your inquiry and our team is reviewing your requirements.</p><p>Feel free to reply directly to this email if you have any questions in the meantime.</p><p>Best regards,<br/>The Team</p>'
      ),
      (
        p_company_id,
        'Proposal Follow-up',
        'Following up on your proposal - {{company}}',
        '<p>Hi {{name}},</p><p>I wanted to follow up on the proposal we shared with you recently.</p><p>Let us know if you would like to schedule a quick call to walk through the details or discuss any customizations.</p><p>Looking forward to hearing from you,<br/>The Team</p>'
      );
  END IF;
END;
$$;

COMMIT;
