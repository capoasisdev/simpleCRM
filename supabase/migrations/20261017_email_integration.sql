-- Migration: Email Integration via Resend API and Email Templates / Logs
-- 1. Email Settings Table
create table if not exists public.email_settings (
  id uuid primary key default gen_random_uuid(),
  provider text default 'resend',
  api_key text,
  from_name text default 'SimpleCRM',
  from_email text default 'onboarding@resend.dev',
  reply_to text,
  is_connected boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Email Templates Table
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_html text not null,
  created_at timestamptz default now()
);

-- Seed default initial templates if none exist
insert into public.email_templates (name, subject, body_html)
select 'Welcome Introduction', 'Thank you for connecting with us, {{name}}', '<p>Hi {{name}},</p><p>Thank you for reaching out to us. We have received your inquiry and our team is reviewing your requirements.</p><p>Feel free to reply directly to this email if you have any questions in the meantime.</p><p>Best regards,<br/>The Team</p>'
where not exists (select 1 from public.email_templates where name = 'Welcome Introduction');

insert into public.email_templates (name, subject, body_html)
select 'Proposal Follow-up', 'Following up on your proposal - {{company}}', '<p>Hi {{name}},</p><p>I wanted to follow up on the proposal we shared with you recently.</p><p>Let us know if you would like to schedule a quick call to walk through the details or discuss any customizations.</p><p>Looking forward to hearing from you,<br/>The Team</p>'
where not exists (select 1 from public.email_templates where name = 'Proposal Follow-up');

-- 3. Email Logs Table
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text,
  lead_email text not null,
  pipeline_id text,
  stage_id text,
  template_name text,
  subject text,
  body text,
  status text default 'sent', -- 'sent' | 'delivered' | 'failed'
  error_message text,
  is_automated boolean default true,
  created_at timestamptz default now()
);

-- Indexes for performance
create index if not exists idx_email_logs_lead_id on public.email_logs(lead_id);
create index if not exists idx_email_logs_created_at on public.email_logs(created_at desc);

-- Realtime subscription publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
    and schemaname = 'public' 
    and tablename = 'email_logs'
  ) then
    alter publication supabase_realtime add table public.email_logs;
  end if;
end $$;
