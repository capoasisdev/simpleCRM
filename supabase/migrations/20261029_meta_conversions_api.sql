-- Migration: Meta Conversions API (CAPI) for Lead Quality Optimization
-- Enables sending downstream CRM lead qualification milestones back to Meta

-- 1. Extend meta_config with CAPI settings
alter table public.meta_config
add column if not exists dataset_id text default '',
add column if not exists capi_enabled boolean default false,
add column if not exists test_event_code text default '',
add column if not exists capi_access_token text default null;

-- 2. Create meta_capi_logs table for audit trail and debugging
create table if not exists public.meta_capi_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default timezone('utc'::text, now()) not null,
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text,
  leadgen_id text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id text,
  event_name text not null,
  event_time timestamptz default timezone('utc'::text, now()) not null,
  event_id text not null,
  dataset_id text not null,
  status text not null default 'pending', -- 'sent' | 'failed' | 'skipped'
  meta_trace_id text,
  events_received integer default 0,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  is_test boolean default false,
  created_by text default 'automation'
);

-- Indexes for performance & query speed
create index if not exists idx_meta_capi_logs_lead_id on public.meta_capi_logs(lead_id);
create index if not exists idx_meta_capi_logs_created_at on public.meta_capi_logs(created_at desc);
create index if not exists idx_meta_capi_logs_status on public.meta_capi_logs(status);
create index if not exists idx_meta_capi_logs_event_name on public.meta_capi_logs(event_name);

-- Row Level Security
alter table public.meta_capi_logs enable row level security;

drop policy if exists "Allow public access to meta_capi_logs" on public.meta_capi_logs;
create policy "Allow public access to meta_capi_logs" on public.meta_capi_logs
  for all using (true) with check (true);

-- Enable Realtime publication for live log feeds
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
    and schemaname = 'public' 
    and tablename = 'meta_capi_logs'
  ) then
    alter publication supabase_realtime add table public.meta_capi_logs;
  end if;
end $$;
