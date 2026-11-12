-- ============================================================================
-- ROLLBACK PART 4: Restore Pre-Part-4 trigger_discovery_autopilot() Cron Hook
-- Use alongside deploying pre-Part-4 discovery-autopilot Edge Function if needed.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trigger_discovery_autopilot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  project_url text := 'https://xrnawvpypkggpjervppb.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhybmF3dnB5cGtnZ3BqZXJ2cHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4ODE1MzcsImV4cCI6MjEwNzQ1NzUzN30.SD6l96hY1pYEfqy4Vjch5deWHwM3nI52NS5wJ0CbnNc';
  request_id bigint;
  due_count int;
begin
  -- Fast pre-check: is any cold pipeline actually due for a sweep?
  select count(*)
  into due_count
  from public.pipelines
  where pipeline_type = 'cold'
    and (discovery_config->>'autopilot_enabled')::boolean = true
    and (
      discovery_config->>'next_run_at' is null
      or (discovery_config->>'next_run_at')::timestamptz <= now()
    );

  if due_count = 0 then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_pipelines_due');
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/discovery-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron')
  ) into request_id;

  return jsonb_build_object('request_id', request_id, 'status', 'queued', 'due_pipelines', due_count);
end;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_discovery_autopilot() TO postgres, service_role;

COMMIT;

