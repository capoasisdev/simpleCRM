-- Migration: Schedule Discovery Autopilot via pg_cron & pg_net
-- Automatically checks and executes scheduled cold lead sweeps in the cloud 24/7

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Function to securely call the discovery-autopilot edge function
create or replace function public.trigger_discovery_autopilot()
returns jsonb
language plpgsql
security definer
as $$
declare
  project_url text := 'https://xrnawvpypkggpjervppb.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhybmF3dnB5cGtnZ3BqZXJ2cHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4ODE1MzcsImV4cCI6MjEwNzQ1NzUzN30.SD6l96hY1pYEfqy4Vjch5deWHwM3nI52NS5wJ0CbnNc';
  request_id bigint;
begin
  select net.http_post(
    url := project_url || '/functions/v1/discovery-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron')
  ) into request_id;

  return jsonb_build_object('request_id', request_id, 'status', 'queued');
end;
$$;

-- Unschedule previous job if it exists to prevent duplication
do $$
begin
  if exists (select 1 from cron.job where jobname = 'discovery-autopilot-sweep') then
    perform cron.unschedule('discovery-autopilot-sweep');
  end if;
end;
$$;

-- Schedule discovery sweep to check every 10 minutes
select cron.schedule(
  'discovery-autopilot-sweep',
  '*/10 * * * *',
  'select public.trigger_discovery_autopilot();'
);

