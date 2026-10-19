-- Migration: Add Pipeline-Scoped Stage Automations
-- Stores array of stage automation configs: [{"stage_id": "...", "is_active": true, "template_name": "..."}]

alter table public.pipelines 
add column if not exists stage_automations jsonb default '[]'::jsonb;
