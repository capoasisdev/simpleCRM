-- Migration: Add pipeline_type to support Cold Engine / Outbound Pipelines
alter table public.pipelines
add column if not exists pipeline_type text not null default 'sales';

-- Ensure all existing pipelines are typed as 'sales'
update public.pipelines
set pipeline_type = 'sales'
where pipeline_type is null or pipeline_type = '';

create index if not exists idx_pipelines_pipeline_type on public.pipelines(pipeline_type);

