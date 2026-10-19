-- Migration: Create whatsapp_messages table for tracking automated and manual messages
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text,
  phone text not null,
  pipeline_id text,
  stage_id text,
  template_name text,
  message_body text,
  direction text default 'outbound', -- 'outbound' | 'inbound'
  status text default 'sent',        -- 'sent' | 'delivered' | 'read' | 'failed'
  is_automated boolean default false,
  created_at timestamptz default now()
);

-- Index for efficient contact grouping and thread queries
create index if not exists idx_whatsapp_messages_phone on public.whatsapp_messages(phone);
create index if not exists idx_whatsapp_messages_lead_id on public.whatsapp_messages(lead_id);
create index if not exists idx_whatsapp_messages_created_at on public.whatsapp_messages(created_at desc);

-- Realtime subscription publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
    and schemaname = 'public' 
    and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime add table public.whatsapp_messages;
  end if;
end $$;
