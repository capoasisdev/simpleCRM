-- Migration: Add WhatsApp connection state tracking
alter table public.meta_config
add column if not exists whatsapp_is_connected boolean default false,
add column if not exists whatsapp_account_name text default '';
