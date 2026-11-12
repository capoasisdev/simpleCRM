-- ============================================================================
-- ROLLBACK: Remove public.crm_backups and public.whatsapp_messages Tables
-- WARNING: Permanently removes server-stored backups and WhatsApp history rows.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "tenant_isolation_crm_backups" ON public.crm_backups;
DROP POLICY IF EXISTS "tenant_isolation_whatsapp_messages" ON public.whatsapp_messages;

DROP TABLE IF EXISTS public.crm_backups CASCADE;
DROP TABLE IF EXISTS public.whatsapp_messages CASCADE;

COMMIT;

