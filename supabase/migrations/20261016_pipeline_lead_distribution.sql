-- Migration: Add Pipeline-Scoped Lead Distribution
-- 1. Add lead_distribution column to pipelines
alter table public.pipelines 
add column if not exists lead_distribution jsonb default null;

-- 2. Populate existing pipelines with current lead_routing_config if present
do $$
declare
  default_config record;
begin
  select mode, default_assignee, user_rules, round_robin_index 
  into default_config 
  from public.lead_routing_config 
  order by created_at asc 
  limit 1;

  if found then
    update public.pipelines
    set lead_distribution = jsonb_build_object(
      'mode', coalesce(default_config.mode, 'round_robin'),
      'default_assignee', coalesce(default_config.default_assignee, 'pranav'),
      'user_rules', coalesce(default_config.user_rules, '[]'::jsonb),
      'round_robin_index', coalesce(default_config.round_robin_index, 0)
    )
    where lead_distribution is null;
  end if;
end $$;
