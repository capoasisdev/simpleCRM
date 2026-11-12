-- ============================================================================
-- ROLLBACK FOR PART 1: Reverts Part 1 cleanly while keeping ALL saladO rows intact
-- NOTE: Run ONLY while no external second company has active data.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.seed_default_email_templates(uuid);

-- Restore exact pre-Part-1 public.crm_users_safe view definition
DROP VIEW IF EXISTS public.crm_users_safe;
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
  END AS masked_pin
FROM public.crm_users;

GRANT ALL ON public.crm_users_safe TO anon, authenticated, service_role;

-- Restore prior column defaults
ALTER TABLE public.leads               ALTER COLUMN assigned_to SET DEFAULT 'pranav';
ALTER TABLE public.lead_routing_config ALTER COLUMN default_assignee SET DEFAULT 'pranav';

-- Drop unique & performance indexes created in Part 1
DROP INDEX IF EXISTS public.idx_meta_config_unique_company;
DROP INDEX IF EXISTS public.idx_lead_routing_config_unique_company;
DROP INDEX IF EXISTS public.idx_email_settings_unique_company;
DROP INDEX IF EXISTS public.idx_crm_users_company;
DROP INDEX IF EXISTS public.idx_pipelines_company;
DROP INDEX IF EXISTS public.idx_leads_company_created;
DROP INDEX IF EXISTS public.idx_leads_company_pipeline;
DROP INDEX IF EXISTS public.idx_leads_company_leadgen_top;
DROP INDEX IF EXISTS public.idx_leads_company_leadgen_json;
DROP INDEX IF EXISTS public.idx_deals_company_created;
DROP INDEX IF EXISTS public.idx_lead_activities_company;
DROP INDEX IF EXISTS public.idx_follow_ups_company_due;
DROP INDEX IF EXISTS public.idx_connected_forms_company_src;
DROP INDEX IF EXISTS public.idx_meta_config_page_id;
DROP INDEX IF EXISTS public.idx_meta_capi_logs_company;
DROP INDEX IF EXISTS public.idx_email_templates_company;
DROP INDEX IF EXISTS public.idx_email_logs_company;
DROP INDEX IF EXISTS public.idx_crm_todo_lists_company;
DROP INDEX IF EXISTS public.idx_crm_todos_company;
DROP INDEX IF EXISTS public.idx_ai_chat_logs_company;
DROP INDEX IF EXISTS public.idx_support_tickets_company;
DROP INDEX IF EXISTS public.idx_pwd_reset_codes_company;
DROP INDEX IF EXISTS public.idx_custom_field_defs_company;
DROP INDEX IF EXISTS public.idx_crm_backups_company;
DROP INDEX IF EXISTS public.idx_whatsapp_messages_company;

-- Drop company_id columns (leaves 100% of saladO data untouched)
ALTER TABLE public.crm_users                 DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.pipelines                 DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.leads                     DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.deals                     DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.lead_activities           DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.follow_ups                DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.lead_routing_config       DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.meta_config               DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.meta_config               DROP COLUMN IF EXISTS page_id;
ALTER TABLE public.connected_forms           DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.meta_capi_logs            DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.email_settings            DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.email_templates           DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.email_logs                DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.crm_todo_lists            DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.crm_todos                 DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.ai_chat_logs              DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.support_tickets           DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.password_reset_codes      DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.custom_field_definitions  DROP COLUMN IF EXISTS company_id;

DO $$
BEGIN
  IF to_regclass('public.crm_backups') IS NOT NULL THEN
    ALTER TABLE public.crm_backups DROP COLUMN IF EXISTS company_id;
  END IF;
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS company_id;
  END IF;
END $$;

DROP TABLE IF EXISTS public.companies;

COMMIT;

