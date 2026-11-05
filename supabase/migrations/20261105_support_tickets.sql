-- Migration: Create support_tickets table for in-app support, suggestions, and queries
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  user_id text,
  user_name text,
  user_email text,
  type text default 'query', -- 'query', 'suggestion', 'support', 'feedback'
  subject text,
  message text not null,
  status text default 'open', -- 'open', 'in_progress', 'resolved', 'closed'
  metadata jsonb default '{}'::jsonb
);

-- Enable RLS and add public access policies for authenticated and anon users
alter table public.support_tickets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'support_tickets' and policyname = 'Allow all read/write support_tickets'
  ) then
    create policy "Allow all read/write support_tickets"
      on public.support_tickets for all
      using (true) with check (true);
  end if;
end;
$$;

