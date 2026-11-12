-- Migration: Create password_reset_codes table for self-service password recovery
create table if not exists public.password_reset_codes (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean default false
);

create index if not exists idx_pwd_reset_email on public.password_reset_codes(email);
create index if not exists idx_pwd_reset_code on public.password_reset_codes(code);

alter table public.password_reset_codes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'password_reset_codes' and policyname = 'Allow read/write password_reset_codes'
  ) then
    create policy "Allow read/write password_reset_codes"
      on public.password_reset_codes for all
      using (true) with check (true);
  end if;
end;
$$;

