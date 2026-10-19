-- Migration: Add whatsapp_templates column to meta_config
ALTER TABLE public.meta_config 
ADD COLUMN IF NOT EXISTS whatsapp_templates jsonb DEFAULT '[]'::jsonb;
