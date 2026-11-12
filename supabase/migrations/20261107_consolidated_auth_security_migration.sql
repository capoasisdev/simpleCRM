-- ==============================================================================
-- SimpleCRM: Consolidated Authentication & Database Security Migration
-- Description:
--   1. Upgrades crm_users to support PBKDF2 hashed passwords (zero downtime for existing PINs)
--   2. Creates password_reset_codes for OTP recovery
--   3. Locks down RLS so recovery codes cannot be sniffed or enumerated via public SELECT
--   4. Adds atomic SECURITY DEFINER functions for reset-code issuance and verification
--   5. Creates crm_users_safe view for non-sensitive client user listings
-- ==============================================================================

-- 1. UPGRADE CRM_USERS TABLE
alter table public.crm_users
  add column if not exists password_hash text default null,
  add column if not exists password_updated_at timestamptz default null,
  add column if not exists must_change_password boolean default false;

-- Allow pin to be nullable for future password-only accounts (existing PINs preserved untouched)
alter table public.crm_users
  alter column pin drop not null;

comment on column public.crm_users.password_hash is 'PBKDF2 secure password hash (pbkdf2:iterations:saltHex:hashHex)';
comment on column public.crm_users.must_change_password is 'Flag forcing password change upon first sign-in';

-- 2. CREATE PASSWORD RESET CODES TABLE
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

-- 3. LOCK DOWN RLS ON PASSWORD RESET CODES
-- Drop any previous permissive policies
drop policy if exists "Allow public access to password_reset_codes" on public.password_reset_codes;
drop policy if exists "Allow read/write password_reset_codes" on public.password_reset_codes;

alter table public.password_reset_codes enable row level security;

-- Deny public select to prevent OTP code enumeration
drop policy if exists "Deny public select on password_reset_codes" on public.password_reset_codes;
create policy "Deny public select on password_reset_codes"
  on public.password_reset_codes
  for select
  using (false);

-- 4. ATOMIC RPC FUNCTION: REQUEST / CREATE RESET CODE
create or replace function public.create_password_reset_code(
  p_email text,
  p_code text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_exists boolean;
  v_trimmed_email text;
begin
  v_trimmed_email := lower(trim(p_email));

  -- Check user existence in crm_users
  select exists(
    select 1 from public.crm_users where lower(email) = v_trimmed_email
  ) into v_user_exists;

  if not v_user_exists then
    return jsonb_build_object('success', false, 'error', 'No account found matching this email address.');
  end if;

  -- Invalidate any prior unused codes for this account
  update public.password_reset_codes
  set used = true
  where lower(email) = v_trimmed_email and used = false;

  -- Store new 15-minute OTP code
  insert into public.password_reset_codes (email, code, expires_at, used)
  values (v_trimmed_email, trim(p_code), now() + interval '15 minutes', false);

  return jsonb_build_object('success', true);
end;
$$;

-- 5. ATOMIC RPC FUNCTION: VERIFY CODE & UPDATE PASSWORD
create or replace function public.verify_and_consume_reset_code(
  p_email text,
  p_code text,
  p_new_password_hash text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_record_id uuid;
  v_trimmed_email text;
  v_trimmed_code text;
begin
  v_trimmed_email := lower(trim(p_email));
  v_trimmed_code := trim(p_code);

  -- Check if valid, active, unexpired code exists
  select id into v_record_id
  from public.password_reset_codes
  where lower(email) = v_trimmed_email
    and code = v_trimmed_code
    and used = false
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_record_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired 6-digit code. Please request a new code.');
  end if;

  -- Mark OTP code as consumed immediately
  update public.password_reset_codes
  set used = true
  where id = v_record_id;

  -- Update user password in crm_users
  update public.crm_users
  set password_hash = p_new_password_hash,
      password_updated_at = now(),
      must_change_password = false
  where lower(email) = v_trimmed_email;

  return jsonb_build_object('success', true);
end;
$$;

-- 6. PERMISSIONS & SAFE VIEW
grant execute on function public.create_password_reset_code(text, text) to anon, authenticated, service_role;
grant execute on function public.verify_and_consume_reset_code(text, text, text) to anon, authenticated, service_role;

create or replace view public.crm_users_safe as
select
  id,
  created_at,
  name,
  email,
  role,
  permissions,
  password_updated_at,
  must_change_password,
  (password_hash is not null and password_hash != '') as is_secured,
  case when pin is not null then '••••' else null end as masked_pin
from public.crm_users;

grant select on public.crm_users_safe to anon, authenticated, service_role;

