-- Migration: Add Discovery & Scraping Configuration to Pipelines
-- Enables autonomous lead scraping and outbound prospecting scoped to specific cold pipelines

alter table public.pipelines
add column if not exists discovery_config jsonb default null;

comment on column public.pipelines.discovery_config is 
'Holds cold lead discovery & scraping settings, target criteria, deduplication rules, and run history for cold engine pipelines.';

