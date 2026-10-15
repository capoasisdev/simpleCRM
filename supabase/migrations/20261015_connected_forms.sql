-- Migration: Multi-Form Support with Pipeline and User Allocation
-- 1. Add pipeline_id to leads table
alter table public.leads add column if not exists pipeline_id uuid references public.pipelines(id) on delete set null;
create index if not exists idx_leads_pipeline_id on public.leads(pipeline_id);

-- 2. Create connected_forms table
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

-- Enable Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
    and schemaname = 'public' 
    and tablename = 'connected_forms'
  ) then
    alter publication supabase_realtime add table public.connected_forms;
  end if;
end $$;
