-- Add connected_sites column to track domains where the form script is installed
alter table public.connected_forms 
add column if not exists connected_sites text[] default '{}';
