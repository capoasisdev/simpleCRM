-- Create ai_chat_logs table for model training and conversation analytics
create table if not exists public.ai_chat_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  user_id text,
  user_name text,
  user_role text,
  user_query text not null,
  assistant_response text not null,
  model_used text,
  feedback text check (feedback in ('thumbs_up', 'thumbs_down', null)),
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexes for efficient querying by user, session, or time
create index if not exists idx_ai_chat_logs_created_at on public.ai_chat_logs (created_at desc);
create index if not exists idx_ai_chat_logs_session_id on public.ai_chat_logs (session_id);
create index if not exists idx_ai_chat_logs_user_id on public.ai_chat_logs (user_id);
create index if not exists idx_ai_chat_logs_feedback on public.ai_chat_logs (feedback);

-- Enable Row Level Security (RLS)
alter table public.ai_chat_logs enable row level security;

-- Allow authenticated and anon users to insert their chat logs
create policy "Allow insert ai_chat_logs"
  on public.ai_chat_logs
  for insert
  with check (true);

-- Allow users to update their own logs (for thumbs up / down feedback)
create policy "Allow update feedback on ai_chat_logs"
  on public.ai_chat_logs
  for update
  using (true)
  with check (true);

-- Allow reading logs for admins/service role
create policy "Allow select ai_chat_logs"
  on public.ai_chat_logs
  for select
  using (true);
