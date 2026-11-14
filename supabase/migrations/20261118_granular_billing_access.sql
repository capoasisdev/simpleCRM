-- ============================================================================
-- Granular Billing Access Control (admin.manage_billing)
-- Decouples billing/seat purchasing from generic `admin` role, allows granting
-- and delegating billing access to/by non-admin users, hardens RLS/triggers,
-- and assigns saladO ownership/billing exclusively to pranav.p@capoasis.com.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Helper Functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_billing()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_users u
    LEFT JOIN public.companies c ON c.id = u.company_id
    WHERE u.id = auth.uid()
      AND u.company_id = public.current_company_id()
      AND (
        lower(COALESCE(u.permissions -> 'admin' ->> 'manage_billing', '')) = 'true'
        OR (
          c.owner_email IS NOT NULL
          AND length(trim(c.owner_email)) > 0
          AND lower(trim(u.email)) = lower(trim(c.owner_email))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_billing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_billing() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_users()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_users u
    WHERE u.id = auth.uid()
      AND u.company_id = public.current_company_id()
      AND (
        u.role = 'admin'
        OR lower(COALESCE(u.permissions -> 'admin' ->> 'manage_users', '')) = 'true'
        OR lower(COALESCE(u.permissions ->> 'manage_users', '')) = 'true'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_users() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Tighten billing_transactions SELECT RLS to billing-authorized users only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_billing_select" ON public.billing_transactions;
CREATE POLICY "tenant_billing_select"
  ON public.billing_transactions
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.can_manage_billing()
  );

-- ----------------------------------------------------------------------------
-- 3. Align crm_users INSERT/UPDATE RLS with manage_users + trigger safeguards
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_crm_users_admin_insert" ON public.crm_users;
CREATE POLICY "tenant_crm_users_admin_insert"
  ON public.crm_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_users()
    AND company_id = public.current_company_id()
  );

DROP POLICY IF EXISTS "tenant_crm_users_admin_update" ON public.crm_users;
CREATE POLICY "tenant_crm_users_admin_update"
  ON public.crm_users
  FOR UPDATE
  TO authenticated
  USING (
    public.can_manage_users()
    AND company_id = public.current_company_id()
  )
  WITH CHECK (
    public.can_manage_users()
    AND company_id = public.current_company_id()
  );

-- Trigger to prevent privilege escalation & accidental billing lockout
CREATE OR REPLACE FUNCTION public.guard_crm_users_privilege_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_billing boolean := false;
  v_new_billing boolean := false;
  v_owner_email text;
  v_remaining_billing_count integer := 0;
  v_via_billing_rpc boolean := false;
BEGIN
  -- Bypass only for privileged migrations / service_role backend operations
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_via_billing_rpc := COALESCE(current_setting('app.billing_rpc_active', true), '') = 'true';
  v_new_billing := lower(COALESCE(NEW.permissions -> 'admin' ->> 'manage_billing', '')) = 'true';

  IF TG_OP = 'INSERT' THEN
    -- Non-admins cannot create admin accounts
    IF NEW.role = 'admin' AND NOT public.is_company_admin() THEN
      RAISE EXCEPTION 'Only workspace administrators can create admin accounts.';
    END IF;

    -- Only billing managers can grant billing access at user creation
    IF v_new_billing AND NOT public.can_manage_billing() THEN
      RAISE EXCEPTION 'You do not have permission to grant billing access.';
    END IF;

    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  v_old_billing := lower(COALESCE(OLD.permissions -> 'admin' ->> 'manage_billing', '')) = 'true';

  -- Prevent non-admins from escalating roles or editing admin accounts (except via scoped billing RPC)
  IF NOT public.is_company_admin() AND NOT v_via_billing_rpc THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND NEW.role = 'admin' THEN
      RAISE EXCEPTION 'Only workspace administrators can assign the Admin role.';
    END IF;
    IF OLD.role = 'admin' THEN
      RAISE EXCEPTION 'Only workspace administrators can edit Admin accounts.';
    END IF;
  END IF;

  -- Protect billing flag modifications
  IF v_new_billing IS DISTINCT FROM v_old_billing THEN
    IF NOT public.can_manage_billing() THEN
      RAISE EXCEPTION 'Only users with billing access can modify billing permissions.';
    END IF;

    IF v_old_billing = true AND v_new_billing = false THEN
      SELECT owner_email
      INTO v_owner_email
      FROM public.companies
      WHERE id = OLD.company_id;

      IF v_owner_email IS NOT NULL
         AND length(trim(v_owner_email)) > 0
         AND lower(trim(OLD.email)) = lower(trim(v_owner_email)) THEN
        RAISE EXCEPTION 'Workspace owner billing access cannot be revoked.';
      END IF;

      SELECT count(*)
      INTO v_remaining_billing_count
      FROM public.crm_users u
      WHERE u.company_id = OLD.company_id
        AND u.id <> OLD.id
        AND (
          lower(COALESCE(u.permissions -> 'admin' ->> 'manage_billing', '')) = 'true'
          OR (
            v_owner_email IS NOT NULL
            AND length(trim(v_owner_email)) > 0
            AND lower(trim(u.email)) = lower(trim(v_owner_email))
          )
        );

      IF v_remaining_billing_count = 0 THEN
        RAISE EXCEPTION 'At least one user in the workspace must retain billing access.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_crm_users_privilege_changes ON public.crm_users;
CREATE TRIGGER trg_guard_crm_users_privilege_changes
  BEFORE INSERT OR UPDATE ON public.crm_users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_crm_users_privilege_changes();

-- ----------------------------------------------------------------------------
-- 4. Scoped RPC so ANY billing user (including non-admin members without
--    manage_users) can grant/revoke billing access to/from teammates cleanly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_billing_access(
  p_target_user_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_target public.crm_users%ROWTYPE;
  v_owner_email text;
  v_remaining_count integer;
  v_next_perms jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace session not found.');
  END IF;

  IF NOT public.can_manage_billing() THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to manage billing access.');
  END IF;

  SELECT *
  INTO v_target
  FROM public.crm_users
  WHERE id = p_target_user_id
    AND company_id = v_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target team member not found in your workspace.');
  END IF;

  SELECT owner_email
  INTO v_owner_email
  FROM public.companies
  WHERE id = v_company_id;

  IF NOT p_enabled THEN
    IF v_owner_email IS NOT NULL
       AND length(trim(v_owner_email)) > 0
       AND lower(trim(v_target.email)) = lower(trim(v_owner_email)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Workspace owner billing access cannot be revoked.');
    END IF;

    SELECT count(*)
    INTO v_remaining_count
    FROM public.crm_users u
    WHERE u.company_id = v_company_id
      AND u.id <> v_target.id
      AND (
        lower(COALESCE(u.permissions -> 'admin' ->> 'manage_billing', '')) = 'true'
        OR (
          v_owner_email IS NOT NULL
          AND length(trim(v_owner_email)) > 0
          AND lower(trim(u.email)) = lower(trim(v_owner_email))
        )
      );

    IF v_remaining_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'At least one user must keep billing access.');
    END IF;
  END IF;

  v_next_perms := jsonb_set(
    COALESCE(v_target.permissions, '{}'::jsonb),
    '{admin}',
    COALESCE(v_target.permissions -> 'admin', '{}'::jsonb) || jsonb_build_object('manage_billing', p_enabled),
    true
  );

  PERFORM set_config('app.billing_rpc_active', 'true', true);

  UPDATE public.crm_users
  SET permissions = v_next_perms
  WHERE id = v_target.id
    AND company_id = v_company_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_target.id,
    'manage_billing', p_enabled,
    'permissions', v_next_perms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_billing_access(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_billing_access(uuid, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Backfill saladO (pranav.p@capoasis.com as owner + sole billing manager)
--    and safely preserve billing manager on any other workspaces.
-- ----------------------------------------------------------------------------
UPDATE public.companies
SET owner_email = 'pranav.p@capoasis.com',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000001';

UPDATE public.crm_users
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{admin}',
  COALESCE(permissions -> 'admin', '{}'::jsonb) ||
    jsonb_build_object(
      'manage_billing',
      lower(trim(email)) = 'pranav.p@capoasis.com'
    ),
  true
)
WHERE company_id = '00000000-0000-4000-8000-000000000001';

-- Ensure any non-saladO existing workspace also retains at least one billing manager
UPDATE public.crm_users u
SET permissions = jsonb_set(
  COALESCE(u.permissions, '{}'::jsonb),
  '{admin}',
  COALESCE(u.permissions -> 'admin', '{}'::jsonb) || jsonb_build_object('manage_billing', true),
  true
)
FROM public.companies c
WHERE u.company_id = c.id
  AND c.id <> '00000000-0000-4000-8000-000000000001'
  AND (
    (c.owner_email IS NOT NULL AND lower(trim(u.email)) = lower(trim(c.owner_email)))
    OR u.id = (
      SELECT u2.id
      FROM public.crm_users u2
      WHERE u2.company_id = c.id
        AND u2.role = 'admin'
      ORDER BY u2.created_at ASC
      LIMIT 1
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.crm_users u3
    WHERE u3.company_id = c.id
      AND lower(COALESCE(u3.permissions -> 'admin' ->> 'manage_billing', '')) = 'true'
  );

COMMIT;

