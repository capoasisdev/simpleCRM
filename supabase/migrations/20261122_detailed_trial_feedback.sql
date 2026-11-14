-- ============================================================================
-- Detailed Trial Feedback for Master Admin Insights & Tenant Admin Shield
-- ============================================================================
-- 1. Adds rich feedback columns to public.trial_feedback_surveys:
--    - favorite_features text[]
--    - pain_points text[]
--    - missing_features text
--    - feedback_notes text
--    - answers jsonb
-- 2. Sets sensible defaults for legacy boolean columns so insertions are robust.
-- ============================================================================

BEGIN;

ALTER TABLE public.trial_feedback_surveys
  ALTER COLUMN helps_sales SET DEFAULT true,
  ALTER COLUMN keeps_organized SET DEFAULT true,
  ADD COLUMN IF NOT EXISTS favorite_features text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pain_points text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS missing_features text DEFAULT '',
  ADD COLUMN IF NOT EXISTS feedback_notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS answers jsonb DEFAULT '{}'::jsonb;

COMMIT;

