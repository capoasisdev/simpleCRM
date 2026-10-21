-- Migration: Add Pipeline-Scoped Fields Configuration
-- Stores list of mapped fields for the pipeline: [{"key": "phone", "label": "Phone Number", "show_on_card": true, "is_core": true}]

alter table public.pipelines
add column if not exists pipeline_fields jsonb default '[]'::jsonb;

-- Ensure leads table has custom_fields JSONB column for extra fields
alter table public.leads
add column if not exists custom_fields jsonb default '{}'::jsonb;
