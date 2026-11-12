-- Migration: Phase 3 Database Security & Row-Level Security (RLS) Lockdown
-- 1. LOCK DOWN PASSWORD RESET CODES TABLE
-- Drop open public policies so OTP recovery codes cannot be sniffed or enumerated
drop policy if exists "Allow public access to password_reset_codes" on public.password_reset_codes;
drop policy if exists "Allow read/write password_reset_codes" on public.password_reset_codes;

alter table public.password_reset_codes enable row level security;

-- Deny direct public SELECT to prevent OTP sniffing
drop policy if exists "Deny public select on password_reset_codes" on public.password_reset_codes;
create policy "Deny public select on password_reset_codes"
  on public.password_reset_codes
  for select
  using (false);

-- 2. CREATE SECURE ATOMIC RPC FUNCTION FOR OTP REQUEST
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

  -- Verify user exists in crm_users
  select exists(
    select 1 from public.crm_users where lower(email) = v_trimmed_email
  ) into v_user_exists;

  if not v_user_exists then
    return jsonb_build_object('success', false, 'error', 'No account found matching this email address.');
  end if;

  -- Invalidate any previous unused codes for this email
  update public.password_reset_codes
  set used = true
  where lower(email) = v_trimmed_email and used = false;

  -- Insert new 15-minute OTP code
  insert into public.password_reset_codes (email, code, expires_at, used)
  values (v_trimmed_email, trim(p_code), now() + interval '15 minutes', false);

  return jsonb_build_object('success', true);
end;
$$;

-- 3. CREATE SECURE ATOMIC RPC FUNCTION FOR OTP VERIFICATION & PASSWORD RESET
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

  -- Check if valid unused code exists and is not expired
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

  -- Mark the OTP code as used immediately
  update public.password_reset_codes
  set used = true
  where id = v_record_id;

  -- Update the user's password in crm_users
  update public.crm_users
  set password_hash = p_new_password_hash,
      password_updated_at = now(),
      must_change_password = false
  where lower(email) = v_trimmed_email;

  return jsonb_build_object('success', true);
end;
$$;

-- 4. SECURE VIEW FOR SAFE CRM USERS QUERYING
-- Allows frontend to query user profiles without exposing password hashes
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

-- Grant execution to anon and authenticated roles for the security functions
grant execute on function public.create_password_reset_code(text, text) to anon, authenticated, service_role;
grant execute on function public.verify_and_consume_reset_code(text, text, text) to anon, authenticated, service_role;

