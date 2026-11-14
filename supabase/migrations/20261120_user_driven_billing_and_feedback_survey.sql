-- ============================================================================
-- User-Driven Billing + Day-15 Member Trial Feedback Surveys
-- ============================================================================
-- 1. Removes the crm_users seat-limit insert trigger & empty-seat removal RPC
--    so 14-day trials have unlimited users and paid workspaces add/remove team
--    members freely (settled on monthly renewal via active user count).
-- 2. Updates discovery autopilot gate to respect active current_period_end + 3d grace.
-- 3. Adds public.trial_feedback_surveys with strict tenant + role RLS.
-- ============================================================================

BEGIN;

-- 1. Remove hard seat-limit trigger & empty-seat removal RPC
DROP TRIGGER IF EXISTS trg_crm_users_enforce_seat_limit ON public.crm_users;
DROP FUNCTION IF EXISTS public.enforce_company_seat_limit();
DROP FUNCTION IF EXISTS public.remove_empty_seats(integer);

-- 2. Align cron autopilot check with active cycle + 3-day renewal grace
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
    AND (
      c.is_billing_exempt = true
      OR (
        c.subscription_status = 'active'
        AND (c.current_period_end IS NULL OR c.current_period_end + interval '3 days' > now())
      )
      OR (c.subscription_status IN ('trialing', 'pilot_extended') AND c.trial_ends_at > now())
    )
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

-- 3. Day-15 Team Member Feedback Survey responses
CREATE TABLE IF NOT EXISTS public.trial_feedback_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.crm_users(id) ON DELETE CASCADE,
  cycle_key text NOT NULL DEFAULT 'trial',
  helps_sales boolean NOT NULL,
  keeps_organized boolean NOT NULL,
  experience_rating smallint NOT NULL CHECK (experience_rating BETWEEN 1 AND 5),
  wants_to_continue boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trial_feedback_user_cycle UNIQUE (company_id, user_id, cycle_key)
);

CREATE INDEX IF NOT EXISTS idx_trial_feedback_company
  ON public.trial_feedback_surveys (company_id, created_at DESC);

ALTER TABLE public.trial_feedback_surveys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trial_feedback_surveys FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.trial_feedback_surveys TO authenticated;
GRANT ALL ON public.trial_feedback_surveys TO service_role;

DROP POLICY IF EXISTS "tenant_feedback_member_select" ON public.trial_feedback_surveys;
CREATE POLICY "tenant_feedback_member_select"
  ON public.trial_feedback_surveys
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (
      user_id = auth.uid()
      OR public.can_manage_billing()
      OR public.is_company_admin()
    )
  );

DROP POLICY IF EXISTS "tenant_feedback_member_insert" ON public.trial_feedback_surveys;
CREATE POLICY "tenant_feedback_member_insert"
  ON public.trial_feedback_surveys
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND user_id = auth.uid()
  );

COMMIT;

