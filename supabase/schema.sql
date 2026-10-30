-- Supabase SQL Schema for CRM Leads, Deals & Users tables
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run

-- 1. LEADS TABLE
create table if not exists public.leads (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  phone text,
  email text,
  city text,
  form_id text,
  form_name text,
  custom_fields jsonb default '{}'::jsonb,
  notes text,
  date text,
  stage text not null default 'new',
  assigned_to text default 'pranav',
  leadgen_id text,
  pipeline_id uuid references public.pipelines(id) on delete set null
);

alter table public.leads enable row level security;

create policy "Allow public access to leads" on public.leads
  for all using (true) with check (true);

-- 2. DEALS TABLE
create table if not exists public.deals (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  company text not null,
  stage text not null default 'Discovery',
  value numeric not null default 0,
  period text not null default 'Today'
);

alter table public.deals enable row level security;

create policy "Allow public access to deals" on public.deals
  for all using (true) with check (true);

-- 3. CRM USERS & PERMISSIONS TABLE
create table if not exists public.crm_users (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  email text not null unique,
  pin varchar(4) not null, -- 4-digit PIN
  role text not null default 'member', -- 'admin' | 'member'
  permissions jsonb not null default '{
    "view_dashboard": true,
    "manage_leads": true,
    "manage_deals": true,
    "manage_users": false
  }'::jsonb
);

alter table public.crm_users enable row level security;

create policy "Allow public access to crm_users" on public.crm_users
  for all using (true) with check (true);

-- Default Admin User
insert into public.crm_users (name, email, pin, role, permissions)
values (
  'Pranav Patil',
  'pranav.p@capoasis.com',
  '1234',
  'admin',
  '{"view_dashboard": true, "manage_leads": true, "manage_deals": true, "manage_users": true}'::jsonb
)
on conflict (email) do nothing;

-- 4. ENABLE REALTIME PUBLICATION
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.deals;
alter publication supabase_realtime add table public.crm_users;

-- 5. META INTEGRATION CONFIG TABLE
-- Single-row table that stores Meta (Facebook) API credentials for lead sync
create table if not exists public.meta_config (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  app_id text,
  app_secret text,
  access_token text,
  verify_token text,
  ad_account_id text,
  lead_form_ids text[] default '{}',
  is_connected boolean default false,
  connected_page_name text,
  connected_account_name text,
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_access_token text,
  whatsapp_template text default 'salado_lead_welcome',
  whatsapp_auto_welcome boolean default false,
  whatsapp_templates jsonb default '[]'::jsonb,
  whatsapp_is_connected boolean default false,
  whatsapp_account_name text default '',
  dataset_id text default '',
  capi_enabled boolean default false,
  test_event_code text default '',
  capi_access_token text default null
);

alter table public.meta_config enable row level security;

create policy "Allow public access to meta_config" on public.meta_config
  for all using (true) with check (true);

-- 6. INBOUND LEAD DISTRIBUTION / ROUTING CONFIG TABLE
create table if not exists public.lead_routing_config (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  mode text not null default 'round_robin', -- 'round_robin' | 'weighted' | 'single' | 'unassigned'
  default_assignee text default 'pranav',
  user_rules jsonb default '[]'::jsonb,
  round_robin_index integer default 0
);

alter table public.lead_routing_config enable row level security;

create policy "Allow public access to lead_routing_config" on public.lead_routing_config
  for all using (true) with check (true);

-- 7. DYNAMIC PIPELINES & STAGES TABLE
create table if not exists public.pipelines (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  name text not null default 'Sales Pipeline',
  is_default boolean default true,
  stages jsonb not null default '[]'::jsonb
);

alter table public.pipelines enable row level security;

create policy "Allow public access to pipelines" on public.pipelines
  for all using (true) with check (true);

-- 8. LEAD & PIPELINE ACTIVITIES TABLE
create table if not exists public.lead_activities (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  lead_id uuid references public.leads(id) on delete cascade,
  lead_name text not null,
  type text not null default 'stage_change',
  from_stage text,
  to_stage text,
  assigned_to text,
  user_name text,
  details text
);

alter table public.lead_activities enable row level security;

drop policy if exists "Allow public access to lead_activities" on public.lead_activities;
create policy "Allow public access to lead_activities" on public.lead_activities
  for all using (true) with check (true);

create index if not exists idx_lead_activities_lead_id on public.lead_activities(lead_id);
alter publication supabase_realtime add table public.lead_activities;

-- 9. FOLLOW-UPS TABLE
create table if not exists public.follow_ups (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  lead_id uuid references public.leads(id) on delete cascade,
  lead_name text not null,
  lead_phone text,
  lead_email text,
  title text not null,
  description text,
  due_date timestamptz not null,
  status text not null default 'pending', -- 'pending' | 'completed'
  completed_at timestamptz,
  created_by text
);

alter table public.follow_ups enable row level security;

drop policy if exists "Allow public access to follow_ups" on public.follow_ups;
create policy "Allow public access to follow_ups" on public.follow_ups
  for all using (true) with check (true);

create index if not exists idx_follow_ups_due_date on public.follow_ups(due_date asc);
create index if not exists idx_follow_ups_lead_id on public.follow_ups(lead_id);
create index if not exists idx_follow_ups_status on public.follow_ups(status);

alter publication supabase_realtime add table public.follow_ups;

-- 10. CRM BACKUPS TABLE (Rolling 7-day backups)
create table if not exists public.crm_backups (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  backup_name text not null,
  backup_type text not null default 'auto', -- 'auto' | 'manual'
  record_counts jsonb not null default '{}'::jsonb,
  file_size_bytes integer default 0,
  created_by text default 'system',
  payload jsonb not null default '{}'::jsonb
);

alter table public.crm_backups enable row level security;

drop policy if exists "Allow public access to crm_backups" on public.crm_backups;
create policy "Allow public access to crm_backups" on public.crm_backups
  for all using (true) with check (true);

create index if not exists idx_crm_backups_created_at on public.crm_backups(created_at desc);
alter publication supabase_realtime add table public.crm_backups;

-- 11. CRM TO-DO LISTS & CUSTOM PIPELINES TABLE
create table if not exists public.crm_todo_lists (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  name text not null,
  description text,
  stages jsonb not null default '[
    {"id": "todo", "name": "To Do", "color": "#64748b"},
    {"id": "in_progress", "name": "In Progress", "color": "#3b82f6"},
    {"id": "done", "name": "Done", "color": "#10b981"}
  ]'::jsonb,
  created_by text
);

alter table public.crm_todo_lists enable row level security;
drop policy if exists "Allow public access to crm_todo_lists" on public.crm_todo_lists;
create policy "Allow public access to crm_todo_lists" on public.crm_todo_lists
  for all using (true) with check (true);

-- 12. CRM TO-DO TASKS TABLE
create table if not exists public.crm_todos (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  list_id uuid references public.crm_todo_lists(id) on delete cascade,
  title text not null,
  description text,
  stage_id text not null default 'todo',
  priority text not null default 'medium', -- 'low' | 'medium' | 'high' | 'urgent'
  due_date timestamptz,
  is_completed boolean default false,
  completed_at timestamptz,
  assigned_to text,
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text,
  sort_order integer default 0,
  created_by text
);

alter table public.crm_todos enable row level security;
drop policy if exists "Allow public access to crm_todos" on public.crm_todos;
create policy "Allow public access to crm_todos" on public.crm_todos
  for all using (true) with check (true);

create index if not exists idx_crm_todos_list_id on public.crm_todos(list_id);
create index if not exists idx_crm_todos_due_date on public.crm_todos(due_date asc);
alter publication supabase_realtime add table public.crm_todos;

-- 13. CONNECTED LEAD FORMS (Multi-Form Ingestion & Dedicated Routing)
create table if not exists public.connected_forms (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  form_id text not null,
  form_name text not null,
  source text default 'meta',
  page_name text,
  page_id text,
  access_token text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  entry_stage_id text default 'new',
  allocation_mode text default 'inherit_global', -- 'inherit_global' | 'specific_user' | 'round_robin' | 'weighted' | 'unassigned'
  assigned_to text,
  user_rules jsonb default '[]'::jsonb,
  round_robin_index integer default 0,
  whatsapp_template text,
  whatsapp_auto_welcome boolean default false,
  tags text[] default '{}',
  is_active boolean default true
);

create unique index if not exists idx_connected_forms_form_id on public.connected_forms(form_id);

alter table public.connected_forms enable row level security;
drop policy if exists "Allow public access to connected_forms" on public.connected_forms;
create policy "Allow public access to connected_forms" on public.connected_forms
  for all using (true) with check (true);

alter publication supabase_realtime add table public.connected_forms;

-- 14. META CONVERSIONS API LOGS (CAPI Downstream Milestones)
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

create index if not exists idx_meta_capi_logs_lead_id on public.meta_capi_logs(lead_id);
create index if not exists idx_meta_capi_logs_created_at on public.meta_capi_logs(created_at desc);
create index if not exists idx_meta_capi_logs_status on public.meta_capi_logs(status);
create index if not exists idx_meta_capi_logs_event_name on public.meta_capi_logs(event_name);

alter table public.meta_capi_logs enable row level security;
drop policy if exists "Allow public access to meta_capi_logs" on public.meta_capi_logs;
create policy "Allow public access to meta_capi_logs" on public.meta_capi_logs
  for all using (true) with check (true);

alter publication supabase_realtime add table public.meta_capi_logs;
