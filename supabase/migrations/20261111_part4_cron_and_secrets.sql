-- ============================================================================
-- PART 4: Tenant-Gated & Vault-Authenticated Discovery Autopilot Cron Trigger
-- Prerequisite: Store 'discovery_autopilot_cron_secret' in vault.secrets and set
-- matching CRON_SECRET in Supabase Edge Function secrets.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trigger_discovery_autopilot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  project_url text := 'https://xrnawvpypkggpjervppb.supabase.co';
  cron_secret text;
  request_id bigint;
  due_count int;
BEGIN
  -- Fast pre-check: only wake Edge Function when an active/trialing workspace
  -- has a cold pipeline due for a scheduled discovery sweep.
  SELECT count(*)
  INTO due_count
  FROM public.pipelines p
  JOIN public.companies c ON c.id = p.company_id
  WHERE p.pipeline_type = 'cold'
    AND c.subscription_status IN ('trialing', 'active')
    AND (p.discovery_config->>'autopilot_enabled')::boolean = true
    AND (
      p.discovery_config->>'next_run_at' IS NULL
      OR (p.discovery_config->>'next_run_at')::timestamptz <= now()
    );

  IF due_count = 0 THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'no_pipelines_due');
  END IF;

  SELECT ds.decrypted_secret
  INTO cron_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'discovery_autopilot_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL OR length(trim(cron_secret)) = 0 THEN
    RETURN jsonb_build_object('status', 'error', 'reason', 'missing_vault_cron_secret');
  END IF;

  SELECT net.http_post(
    url := project_url || '/functions/v1/discovery-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', cron_secret
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron')
  ) INTO request_id;

  RETURN jsonb_build_object(
    'request_id', request_id,
    'status', 'queued',
    'due_pipelines', due_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_discovery_autopilot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_discovery_autopilot() TO postgres, service_role;

COMMIT;

