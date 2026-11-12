-- ============================================================================
-- PART 2: Cryptographic JWT RLS Functions, View Hardening & Tenant Isolation
-- Prerequisite: Part 1 complete + auth-login / auth-password-* Edge Functions
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Core Tenant & Role Resolution Functions (backed by auth.uid() + app_metadata)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.crm_users
  WHERE id = auth.uid()
    AND company_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_users
    WHERE id = auth.uid()
      AND company_id = public.current_company_id()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_company_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_admin() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Harden public.crm_users_safe view so RLS runs as invoker (never bypasses RLS)
-- ----------------------------------------------------------------------------
ALTER VIEW public.crm_users_safe SET (security_invoker = true);
REVOKE ALL ON public.crm_users_safe FROM anon;
GRANT SELECT ON public.crm_users_safe TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Harden OTP RPCs & lock password_reset_codes strictly to service_role
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_password_reset_code(
  p_email text,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trimmed_email text;
  v_company_id uuid;
BEGIN
  v_trimmed_email := lower(trim(p_email));

  SELECT company_id INTO v_company_id
  FROM public.crm_users
  WHERE lower(email) = v_trimmed_email
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No account found matching this email address.');
  END IF;

  UPDATE public.password_reset_codes
  SET used = true
  WHERE lower(email) = v_trimmed_email AND used = false;

  INSERT INTO public.password_reset_codes (company_id, email, code, expires_at, used)
  VALUES (v_company_id, v_trimmed_email, trim(p_code), now() + interval '15 minutes', false);

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_password_reset_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_password_reset_code(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_and_consume_reset_code(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_consume_reset_code(text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Drop legacy permissive policies safely & enable RLS on email tables
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Part 1 transitional read access to companies" ON public.companies;
DROP POLICY IF EXISTS "Allow public access to crm_users" ON public.crm_users;
DROP POLICY IF EXISTS "Allow public access to leads" ON public.leads;
DROP POLICY IF EXISTS "Allow public access to deals" ON public.deals;
DROP POLICY IF EXISTS "Allow public access to pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Allow public access to connected_forms" ON public.connected_forms;
DROP POLICY IF EXISTS "Allow public access to custom_field_definitions" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "Allow public access to lead_activities" ON public.lead_activities;
DROP POLICY IF EXISTS "Allow public access to follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Allow public access to lead_routing_config" ON public.lead_routing_config;
DROP POLICY IF EXISTS "Allow public access to meta_config" ON public.meta_config;
DROP POLICY IF EXISTS "Allow public access to meta_capi_logs" ON public.meta_capi_logs;
DROP POLICY IF EXISTS "Allow public access to crm_todo_lists" ON public.crm_todo_lists;
DROP POLICY IF EXISTS "Allow public access to crm_todos" ON public.crm_todos;
DROP POLICY IF EXISTS "Allow insert ai_chat_logs" ON public.ai_chat_logs;
DROP POLICY IF EXISTS "Allow select ai_chat_logs" ON public.ai_chat_logs;
DROP POLICY IF EXISTS "Allow update feedback on ai_chat_logs" ON public.ai_chat_logs;
DROP POLICY IF EXISTS "Allow all read/write support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Allow public access to password_reset_codes" ON public.password_reset_codes;
DROP POLICY IF EXISTS "Deny public select on password_reset_codes" ON public.password_reset_codes;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_routing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_capi_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_todo_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. Strict Multi-Tenant RLS Policies
-- ----------------------------------------------------------------------------

-- companies: authenticated users may read ONLY their own company; mutations are service_role only
REVOKE INSERT, UPDATE, DELETE ON public.companies FROM anon, authenticated;
REVOKE SELECT ON public.companies FROM anon;
GRANT SELECT ON public.companies TO authenticated;

CREATE POLICY "tenant_companies_select"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (id = public.current_company_id());

-- password_reset_codes: deny all direct client access (Edge Functions via service_role only)
CREATE POLICY "deny_all_password_reset_codes"
  ON public.password_reset_codes
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- crm_users: tenant users can read team members; ONLY admins can insert/update/delete within same company
CREATE POLICY "tenant_crm_users_select"
  ON public.crm_users
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "tenant_crm_users_admin_insert"
  ON public.crm_users
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_crm_users_admin_update"
  ON public.crm_users
  FOR UPDATE
  TO authenticated
  USING (public.is_company_admin() AND company_id = public.current_company_id())
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_crm_users_admin_delete"
  ON public.crm_users
  FOR DELETE
  TO authenticated
  USING (
    public.is_company_admin()
    AND company_id = public.current_company_id()
    AND id <> auth.uid()
  );

-- meta_config & email_settings: same-company members can read; ONLY admins can mutate
CREATE POLICY "tenant_meta_config_select"
  ON public.meta_config
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "tenant_meta_config_admin_insert"
  ON public.meta_config
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_meta_config_admin_update"
  ON public.meta_config
  FOR UPDATE
  TO authenticated
  USING (public.is_company_admin() AND company_id = public.current_company_id())
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_meta_config_admin_delete"
  ON public.meta_config
  FOR DELETE
  TO authenticated
  USING (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_email_settings_select"
  ON public.email_settings
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "tenant_email_settings_admin_insert"
  ON public.email_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_email_settings_admin_update"
  ON public.email_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_company_admin() AND company_id = public.current_company_id())
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_email_settings_admin_delete"
  ON public.email_settings
  FOR DELETE
  TO authenticated
  USING (public.is_company_admin() AND company_id = public.current_company_id());

-- lead_routing_config: same-company users can select/update (CSV round-robin cursor); admin-only insert/delete
CREATE POLICY "tenant_lead_routing_select"
  ON public.lead_routing_config
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "tenant_lead_routing_update"
  ON public.lead_routing_config
  FOR UPDATE
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_lead_routing_admin_insert"
  ON public.lead_routing_config
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin() AND company_id = public.current_company_id());

CREATE POLICY "tenant_lead_routing_admin_delete"
  ON public.lead_routing_config
  FOR DELETE
  TO authenticated
  USING (public.is_company_admin() AND company_id = public.current_company_id());

-- Operational tenant tables: strict authenticated company_id isolation for all operations
CREATE POLICY "tenant_isolation_leads"
  ON public.leads FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_deals"
  ON public.deals FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_pipelines"
  ON public.pipelines FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_connected_forms"
  ON public.connected_forms FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_custom_field_definitions"
  ON public.custom_field_definitions FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_lead_activities"
  ON public.lead_activities FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_follow_ups"
  ON public.follow_ups FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_crm_todo_lists"
  ON public.crm_todo_lists FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_crm_todos"
  ON public.crm_todos FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_email_templates"
  ON public.email_templates FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_email_logs"
  ON public.email_logs FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_meta_capi_logs"
  ON public.meta_capi_logs FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_ai_chat_logs"
  ON public.ai_chat_logs FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_support_tickets"
  ON public.support_tickets FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- Conditionally guard crm_backups & whatsapp_messages if present in environment
DO $$
BEGIN
  IF to_regclass('public.crm_backups') IS NOT NULL THEN
    ALTER TABLE public.crm_backups ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow public access to crm_backups" ON public.crm_backups;
    CREATE POLICY "tenant_isolation_crm_backups"
      ON public.crm_backups FOR ALL TO authenticated
      USING (company_id = public.current_company_id())
      WITH CHECK (company_id = public.current_company_id());
  END IF;

  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow public access to whatsapp_messages" ON public.whatsapp_messages;
    CREATE POLICY "tenant_isolation_whatsapp_messages"
      ON public.whatsapp_messages FOR ALL TO authenticated
      USING (company_id = public.current_company_id())
      WITH CHECK (company_id = public.current_company_id());
  END IF;
END $$;

COMMIT;

