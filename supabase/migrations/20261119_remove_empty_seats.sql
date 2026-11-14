-- ============================================================================
-- Allow Workspace Billing Managers to Remove Unoccupied (Empty) Seats
-- ============================================================================
-- Safely decrements public.companies.seat_limit under pg_advisory_xact_lock
-- matching public.enforce_company_seat_limit(), preventing race conditions
-- with simultaneous team member additions and enforcing that seat_limit never
-- drops below MAX(1, active crm_users count).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.remove_empty_seats(
  p_seats_to_remove integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_current_seat_limit integer;
  v_active_users_count integer;
  v_new_seat_limit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace session not found.');
  END IF;

  IF NOT public.can_manage_billing() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only billing managers can remove workspace seats.');
  END IF;

  IF p_seats_to_remove IS NULL OR p_seats_to_remove < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Specify at least 1 empty seat to remove.');
  END IF;

  -- Serialize against concurrent crm_users inserts and seat updates for this company
  PERFORM pg_advisory_xact_lock(hashtext('crm_seat_limit:' || v_company_id::text));

  SELECT seat_limit
  INTO v_current_seat_limit
  FROM public.companies
  WHERE id = v_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace company not found.');
  END IF;

  SELECT count(*)::integer
  INTO v_active_users_count
  FROM public.crm_users
  WHERE company_id = v_company_id;

  IF v_current_seat_limit <= v_active_users_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'All workspace seats are currently occupied. Delete a user in Admin -> Users before removing a seat.'
    );
  END IF;

  v_new_seat_limit := v_current_seat_limit - p_seats_to_remove;

  IF v_new_seat_limit < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Workspace must keep at least 1 seat.');
  END IF;

  IF v_new_seat_limit < v_active_users_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format(
        'Cannot reduce seats below active team members (%s). Remove users first.',
        v_active_users_count
      )
    );
  END IF;

  UPDATE public.companies
  SET seat_limit = v_new_seat_limit,
      updated_at = now()
  WHERE id = v_company_id;

  RETURN jsonb_build_object(
    'success', true,
    'seat_limit', v_new_seat_limit,
    'active_users_count', v_active_users_count,
    'empty_seats', GREATEST(0, v_new_seat_limit - v_active_users_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_empty_seats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_empty_seats(integer) TO authenticated, service_role;

COMMIT;

