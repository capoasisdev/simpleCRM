-- ============================================================================
-- ROLLBACK FOR PART 2: Restores exact pre-Part-2 pg_policies snapshot cleanly
-- Use only if cached clients need temporary emergency RLS relaxation.
-- ============================================================================

BEGIN;

-- Drop strict tenant policies created in Part 2
DROP POLICY IF EXISTS "tenant_companies_select" ON public.companies;
DROP POLICY IF EXISTS "deny_all_password_reset_codes" ON public.password_reset_codes;
DROP POLICY IF EXISTS "tenant_crm_users_select" ON public.crm_users;
DROP POLICY IF EXISTS "tenant_crm_users_admin_insert" ON public.crm_users;
DROP POLICY IF EXISTS "tenant_crm_users_admin_update" ON public.crm_users;
DROP POLICY IF EXISTS "tenant_crm_users_admin_delete" ON public.crm_users;
DROP POLICY IF EXISTS "tenant_meta_config_select" ON public.meta_config;
DROP POLICY IF EXISTS "tenant_meta_config_admin_insert" ON public.meta_config;
DROP POLICY IF EXISTS "tenant_meta_config_admin_update" ON public.meta_config;
DROP POLICY IF EXISTS "tenant_meta_config_admin_delete" ON public.meta_config;
DROP POLICY IF EXISTS "tenant_email_settings_select" ON public.email_settings;
DROP POLICY IF EXISTS "tenant_email_settings_admin_insert" ON public.email_settings;
DROP POLICY IF EXISTS "tenant_email_settings_admin_update" ON public.email_settings;
DROP POLICY IF EXISTS "tenant_email_settings_admin_delete" ON public.email_settings;
DROP POLICY IF EXISTS "tenant_lead_routing_select" ON public.lead_routing_config;
DROP POLICY IF EXISTS "tenant_lead_routing_update" ON public.lead_routing_config;
DROP POLICY IF EXISTS "tenant_lead_routing_admin_insert" ON public.lead_routing_config;
DROP POLICY IF EXISTS "tenant_lead_routing_admin_delete" ON public.lead_routing_config;
DROP POLICY IF EXISTS "tenant_isolation_leads" ON public.leads;
DROP POLICY IF EXISTS "tenant_isolation_deals" ON public.deals;
DROP POLICY IF EXISTS "tenant_isolation_pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "tenant_isolation_connected_forms" ON public.connected_forms;
DROP POLICY IF EXISTS "tenant_isolation_custom_field_definitions" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "tenant_isolation_lead_activities" ON public.lead_activities;
DROP POLICY IF EXISTS "tenant_isolation_follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "tenant_isolation_crm_todo_lists" ON public.crm_todo_lists;
DROP POLICY IF EXISTS "tenant_isolation_crm_todos" ON public.crm_todos;
DROP POLICY IF EXISTS "tenant_isolation_email_templates" ON public.email_templates;
DROP POLICY IF EXISTS "tenant_isolation_email_logs" ON public.email_logs;
DROP POLICY IF EXISTS "tenant_isolation_meta_capi_logs" ON public.meta_capi_logs;
DROP POLICY IF EXISTS "tenant_isolation_ai_chat_logs" ON public.ai_chat_logs;
DROP POLICY IF EXISTS "tenant_isolation_support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "tenant_isolation_crm_backups" ON public.crm_backups;
DROP POLICY IF EXISTS "tenant_isolation_whatsapp_messages" ON public.whatsapp_messages;

-- Restore prior grants and view settings
GRANT SELECT ON public.companies TO anon, authenticated;
ALTER VIEW public.crm_users_safe SET (security_invoker = false);
GRANT SELECT ON public.crm_users_safe TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_password_reset_code(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_and_consume_reset_code(text, text, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.is_company_admin();
DROP FUNCTION IF EXISTS public.current_company_id();

-- Restore exact pre-Part-2 policies captured from remote pg_policies
CREATE POLICY "Part 1 transitional read access to companies" ON public.companies FOR SELECT USING (true);
CREATE POLICY "Allow public access to crm_users" ON public.crm_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to leads" ON public.leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to deals" ON public.deals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to pipelines" ON public.pipelines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to connected_forms" ON public.connected_forms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to custom_field_definitions" ON public.custom_field_definitions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to lead_activities" ON public.lead_activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to follow_ups" ON public.follow_ups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to lead_routing_config" ON public.lead_routing_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to meta_config" ON public.meta_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to meta_capi_logs" ON public.meta_capi_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to crm_todo_lists" ON public.crm_todo_lists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to crm_todos" ON public.crm_todos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow insert ai_chat_logs" ON public.ai_chat_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select ai_chat_logs" ON public.ai_chat_logs FOR SELECT USING (true);
CREATE POLICY "Allow update feedback on ai_chat_logs" ON public.ai_chat_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all read/write support_tickets" ON public.support_tickets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Deny public select on password_reset_codes" ON public.password_reset_codes FOR SELECT USING (false);

ALTER TABLE public.email_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs DISABLE ROW LEVEL SECURITY;

COMMIT;

