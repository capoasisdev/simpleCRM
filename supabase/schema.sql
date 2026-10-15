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
  leadgen_id text
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
  whatsapp_auto_welcome boolean default false
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


