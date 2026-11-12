-- Migration: Upgrade crm_users authentication to support secure hashed passwords
-- Preserves all existing active users and their current 4-digit PINs with zero downtime.

alter table public.crm_users
  add column if not exists password_hash text default null,
  add column if not exists password_updated_at timestamptz default null,
  add column if not exists must_change_password boolean default false;

-- Allow pin to be nullable in future for users created exclusively with passwords
alter table public.crm_users
  alter column pin drop not null;

comment on column public.crm_users.password_hash is 'PBKDF2 secure password hash (format: pbkdf2:iterations:saltHex:hashHex)';
comment on column public.crm_users.must_change_password is 'Flag indicating user must set a new password on their next login session';

