-- ============================================================================
-- PART 5 ROLLBACK: Revert Onboarding, Seat Enforcement & Billing Schema Changes
-- Reversible only before live paid billing_transactions exist (drops Part 5 objects cleanly).
-- Preserves 100% of Parts 1-4 tables and saladO data.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_crm_users_enforce_seat_limit ON public.crm_users;
DROP FUNCTION IF EXISTS public.enforce_company_seat_limit();

DROP TABLE IF EXISTS public.billing_transactions;
DROP TABLE IF EXISTS public.trial_enrollments;

-- Normalize any 'pilot_extended' status before restoring prior CHECK constraint
UPDATE public.companies
SET subscription_status = 'trialing'
WHERE subscription_status = 'pilot_extended';

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_subscription_status_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_subscription_status_check
  CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'expired', 'cancelled'));

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS razorpay_customer_id,
  DROP COLUMN IF EXISTS razorpay_subscription_id,
  DROP COLUMN IF EXISTS current_period_start,
  DROP COLUMN IF EXISTS current_period_end;

-- Restore Part 4 trigger_discovery_autopilot() definition
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

