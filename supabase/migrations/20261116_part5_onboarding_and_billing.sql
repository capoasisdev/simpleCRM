-- ============================================================================
-- PART 5: Multi-Company Onboarding, Seat Enforcement & Stage 2 Billing Schema
-- Companion Doc: docs/RAZORPAY_BILLING_AND_TENANCY_PLAN.md
-- Reversible Rollback: supabase/rollbacks/20261116_part5_rollback.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extend public.companies for Stage 2 Razorpay & Extended Pilot Lifecycle
-- ----------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS razorpay_customer_id text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_subscription_status_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_subscription_status_check
  CHECK (
    subscription_status IN (
      'trialing',
      'pilot_extended',
      'active',
      'past_due',
      'expired',
      'cancelled'
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Public Trial Enrollment Intake Log (service_role only via enroll-trial)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trial_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company_name text,
  work_email text NOT NULL,
  phone text NOT NULL,
  requested_seats integer NOT NULL DEFAULT 5 CHECK (requested_seats >= 1),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'provisioned', 'converted', 'churned')),
  provisioned_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_enrollments_email
  ON public.trial_enrollments (lower(work_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trial_enrollments_company
  ON public.trial_enrollments (provisioned_company_id);

ALTER TABLE public.trial_enrollments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trial_enrollments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trial_enrollments TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Stage 2 Razorpay Billing Transactions Ledger (RLS Read for Own Tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  transaction_type text NOT NULL
    CHECK (transaction_type IN ('initial_activation', 'seat_addon', 'renewal')),
  seats_delta integer NOT NULL DEFAULT 0,
  amount_inr numeric(12, 2) NOT NULL,
  unit_price_inr integer NOT NULL DEFAULT 999,
  currency text NOT NULL DEFAULT 'INR',
  razorpay_order_id text UNIQUE,
  razorpay_payment_id text UNIQUE,
  razorpay_signature text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_tx_company
  ON public.billing_transactions (company_id, created_at DESC);

ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_transactions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.billing_transactions FROM authenticated;
GRANT SELECT ON public.billing_transactions TO authenticated;
GRANT ALL ON public.billing_transactions TO service_role;

DROP POLICY IF EXISTS "tenant_billing_select" ON public.billing_transactions;
CREATE POLICY "tenant_billing_select"
  ON public.billing_transactions
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

-- ----------------------------------------------------------------------------
-- 4. Server-Side Seat Limit Trigger on public.crm_users (Tamper-Proof)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_company_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat_limit integer;
  v_current_count integer;
BEGIN
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required when adding a team member';
  END IF;

  -- Serialize concurrent insertions for the same company to block race-condition seat bypasses
  PERFORM pg_advisory_xact_lock(hashtext('crm_seat_limit:' || NEW.company_id::text));

  SELECT seat_limit
  INTO v_seat_limit
  FROM public.companies
  WHERE id = NEW.company_id;

  IF v_seat_limit IS NULL THEN
    RAISE EXCEPTION 'Workspace company % does not exist', NEW.company_id;
  END IF;

  SELECT count(*)
  INTO v_current_count
  FROM public.crm_users
  WHERE company_id = NEW.company_id;

  IF v_current_count >= v_seat_limit THEN
    RAISE EXCEPTION 'Workspace seat limit reached (% / %). Purchase additional seats to invite more team members.',
      v_current_count, v_seat_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_users_enforce_seat_limit ON public.crm_users;
CREATE TRIGGER trg_crm_users_enforce_seat_limit
  BEFORE INSERT ON public.crm_users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_company_seat_limit();

-- ----------------------------------------------------------------------------
-- 5. Align Cron Pre-Check with pilot_extended & trial_ends_at Expiration Gate
-- ----------------------------------------------------------------------------
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
      OR c.subscription_status = 'active'
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

COMMIT;

