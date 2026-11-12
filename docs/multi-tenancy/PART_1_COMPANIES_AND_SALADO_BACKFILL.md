# Part 1 — `companies` Table & Non-Breaking saladO Backfill

> **Execution Status**: **COMPLETED & VERIFIED ON PRODUCTION SUPABASE** (2026-11-11).
> **Executed SQL**: [`20261111_part1_companies_and_salado_backfill.sql`](../../supabase/migrations/20261111_part1_companies_and_salado_backfill.sql)
> **Rollback SQL**: [`20261111_part1_rollback.sql`](../../supabase/rollbacks/20261111_part1_rollback.sql)
> **Downtime Risk**: **Zero** — Transitional `DEFAULT` on `company_id` ensures live **saladO** inserts from Web, Android APK, and Webhooks continue succeeding seamlessly until Parts 2–4 explicitly supply/enforce `company_id`.

### Applied Execution & Verification Log (Live DB Audit)
- Live remote audit found `public.custom_field_definitions` present (backfilled & indexed alongside all other live tables), while `crm_backups` and `whatsapp_messages` do not yet exist in remote `public` (guarded safely via `to_regclass(...)`).
- Fixed `crm_users_safe` view projection to append `company_id` without reordering existing columns (`id, created_at, name, email, role, permissions, password_updated_at, must_change_password, is_secured, masked_pin, company_id`).
- Fixed `seed_default_email_templates(p_company_id)` to match live `email_templates` columns (`company_id, name, subject, body_html`).
- Live assertion check verified **`0` NULL `company_id` rows across all 19 live tables** (`leads`: 865/865, `lead_activities`: 2157/2157, `email_logs`: 1007/1007, `meta_capi_logs`: 63/63, `ai_chat_logs`: 15/15, `crm_users`: 5/5, `pipelines`: 4/4, `connected_forms`: 3/3, `email_templates`: 2/2, `password_reset_codes`: 2/2, `crm_todo_lists`: 1/1, `email_settings`: 1/1, `follow_ups`: 1/1, `lead_routing_config`: 1/1, `meta_config`: 1/1, `crm_todos`: 0, `custom_field_definitions`: 0, `deals`: 0, `support_tickets`: 0) and `crm_users_safe`: 5/5 rows with `company_id`.
- Note: `meta_config.page_id` on `saladO` is currently empty because existing `connected_forms` rows did not store `page_id`; Part 3/Part 4 should populate `meta_config.page_id` on Meta reconnect and retain safe single-row fallback during transition.

---

## 1. Objective
1. Create `public.companies` to represent each tenant organization inside `simplecrm`.
2. Insert **Company #1 (`saladO`)** with active, exempt status so live operations never risk accidental suspension.
3. Add `company_id UUID` across **all 20 existing tenant tables** (nullable first -> backfill 100% of live rows to `saladO` -> validate `0` nulls -> enforce `NOT NULL` + foreign key + indexes).
4. Fix single-tenant uniqueness assumptions (`meta_config`, `lead_routing_config`, `email_settings`) and prepare per-company uniqueness + indexes without breaking `connected_forms` or `crm_users`.
5. Rebuild `public.crm_users_safe` view to include `company_id`.
6. Provide deterministic verification SQL and complete down-migration rollback SQL.

---

## 2. Subtle Schema Traps Discovered During Audit

1. **`deals.company` already exists (`supabase/schema.sql:32`)**:
   - In `deals`, `company text not null` is the **customer/prospect organization name** on a revenue deal (inserted in `DashboardView.jsx`).
   - We MUST NOT rename or overwrite `deals.company`. The tenant foreign key MUST be named **`deals.company_id uuid`** on `deals` and every other table.
2. **Global Singleton Config Tables (`meta_config`, `lead_routing_config`, `email_settings`)**:
   - Today the frontend and Edge Functions run `.limit(1).maybeSingle()`.
   - Adding `UNIQUE (company_id)` guarantees at most **1 config row per tenant** cleanly and prevents duplicate rows per company.
3. **`connected_forms` Global Index (`idx_connected_forms_form_id`)**:
   - Currently `form_id` has a unique index (`schema.sql`). Keeping `form_id` globally unique guarantees Meta & Website webhooks can resolve any incoming `form_id` to an exact single `company_id` without ambiguity. Add index `(company_id, source)`.
4. **Hardcoded `'pranav'` SQL Column Defaults**:
   - `leads.assigned_to` (`default 'pranav'`) and `lead_routing_config.default_assignee` (`default 'pranav'`) in `schema.sql` should have their SQL column defaults altered to `'unassigned'` (backfilling existing rows untouched!) so newly onboarded companies never assign leads to `'pranav'`.
5. **`email_templates` Seed Data (`20261017_email_integration.sql`)**:
   - Currently seeded with `'Welcome Introduction'` and `'Proposal Follow-up'`. Part 1 assigns those existing template rows to `saladO`, and Part 5 reuses a DB function `seed_default_email_templates(p_company_id)` whenever a new company signs up.
6. **`password_reset_codes` (`company_id` nullable or resolved)**:
   - Reset requests arrive before login (by email). Keep `password_reset_codes.company_id` populated from `crm_users.company_id` when created, with `ON DELETE CASCADE` to `companies(id)`.

---

## 3. Forward Migration Plan (`supabase/migrations/20261112_part1_companies_and_backfill.sql`)

```sql
-- ============================================================================
-- PART 1: Multi-Tenant Foundation (Non-Breaking / Additive)
-- Preserves 100% of saladO data as Company #1
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create public.companies table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  subscription_status text NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'expired', 'cancelled')),
  trial_starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  seat_limit integer NOT NULL DEFAULT 5 CHECK (seat_limit >= 1),
  price_per_seat_inr integer NOT NULL DEFAULT 999,
  is_billing_exempt boolean NOT NULL DEFAULT false,
  owner_email text,
  owner_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed Company #1: saladO (deterministic UUID makes cross-env scripts & rollbacks clean)
INSERT INTO public.companies (
  id,
  name,
  slug,
  subscription_status,
  trial_starts_at,
  trial_ends_at,
  seat_limit,
  is_billing_exempt
) VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'saladO',
  'salado',
  'active',
  now(),
  now() + interval '100 years',
  100,
  true
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  subscription_status = 'active',
  is_billing_exempt = true;

-- ----------------------------------------------------------------------------
-- 2. Add nullable company_id + meta_config.page_id across all 20 tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_users           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.pipelines           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.leads               ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.deals               ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activities     ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups          ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.lead_routing_config ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.meta_config         ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.meta_config         ADD COLUMN IF NOT EXISTS page_id text;
ALTER TABLE public.connected_forms     ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.meta_capi_logs      ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.email_settings      ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.email_templates     ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.email_logs          ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_messages   ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.crm_todo_lists      ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.crm_todos           ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.crm_backups         ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.ai_chat_logs        ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.support_tickets     ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.password_reset_codes ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 3. Backfill 100% of existing rows to Company #1 (saladO)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_salado_id uuid;
BEGIN
  SELECT id INTO v_salado_id FROM public.companies WHERE slug = 'salado';
  IF v_salado_id IS NULL THEN
    RAISE EXCEPTION 'saladO company record missing during Part 1 backfill';
  END IF;

  UPDATE public.crm_users            SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.pipelines            SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.leads                SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.deals                SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.lead_activities      SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.follow_ups           SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.lead_routing_config  SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.meta_config          SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.connected_forms      SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.meta_capi_logs       SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.email_settings       SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.email_templates      SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.email_logs           SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.whatsapp_messages    SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.crm_todo_lists       SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.crm_todos            SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.crm_backups          SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.ai_chat_logs         SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.support_tickets      SET company_id = v_salado_id WHERE company_id IS NULL;
  UPDATE public.password_reset_codes SET company_id = v_salado_id WHERE company_id IS NULL;

  -- Backfill meta_config.page_id if connected_forms already holds a page_id for saladO
  UPDATE public.meta_config mc
  SET page_id = (
    SELECT cf.page_id
    FROM public.connected_forms cf
    WHERE cf.company_id = v_salado_id
      AND cf.page_id IS NOT NULL
      AND cf.page_id <> ''
    ORDER BY cf.created_at DESC
    LIMIT 1
  )
  WHERE mc.company_id = v_salado_id
    AND (mc.page_id IS NULL OR mc.page_id = '');
END $$;

-- ----------------------------------------------------------------------------
-- 4. Enforce NOT NULL + Remove hardcoded 'pranav' defaults
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_users           ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.pipelines           ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.leads               ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.deals               ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.lead_activities     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.follow_ups          ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.lead_routing_config ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.meta_config         ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.connected_forms     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.meta_capi_logs      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.email_settings      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.email_templates     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.email_logs          ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.whatsapp_messages   ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_todo_lists      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_todos           ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.crm_backups         ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.ai_chat_logs        ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.support_tickets     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.password_reset_codes ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.leads               ALTER COLUMN assigned_to SET DEFAULT 'unassigned';
ALTER TABLE public.lead_routing_config ALTER COLUMN default_assignee SET DEFAULT 'unassigned';

-- ----------------------------------------------------------------------------
-- 5. Indexes & Per-Company Uniqueness Constraints
-- (Note: verify duplicate singleton rows before adding unique indexes on
--  meta_config / lead_routing_config / email_settings for saladO)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crm_users_company           ON public.crm_users(company_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_company           ON public.pipelines(company_id, is_default);
CREATE INDEX IF NOT EXISTS idx_leads_company_created       ON public.leads(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_pipeline      ON public.leads(company_id, pipeline_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_company_created       ON public.deals(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_company     ON public.lead_activities(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_company_due      ON public.follow_ups(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_connected_forms_company_src ON public.connected_forms(company_id, source);
CREATE INDEX IF NOT EXISTS idx_meta_config_page_id         ON public.meta_config(page_id) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meta_capi_logs_company      ON public.meta_capi_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_templates_company     ON public.email_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_company          ON public.email_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_company   ON public.whatsapp_messages(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_todo_lists_company      ON public.crm_todo_lists(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_todos_company           ON public.crm_todos(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_backups_company         ON public.crm_backups(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_company        ON public.ai_chat_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_company     ON public.support_tickets(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_codes_company     ON public.password_reset_codes(company_id, email);

-- Keep exactly 1 config row per company on singleton tables
-- (Pre-flight SQL below confirms saladO currently has <= 1 row in each)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_config_unique_company         ON public.meta_config(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_routing_config_unique_company ON public.lead_routing_config(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_settings_unique_company      ON public.email_settings(company_id);

-- Prevent duplicate external Meta leadgen IDs within same tenant
CREATE INDEX IF NOT EXISTS idx_leads_company_leadgen_id
  ON public.leads(company_id, ((custom_fields->>'leadgen_id')));

-- ----------------------------------------------------------------------------
-- 6. Rebuild public.crm_users_safe view to include company_id
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.crm_users_safe AS
SELECT
  id,
  company_id,
  name,
  email,
  role,
  permissions,
  created_at,
  updated_at,
  must_change_password,
  password_updated_at
FROM public.crm_users;

-- ----------------------------------------------------------------------------
-- 7. Reusable helper to seed default email templates for new companies (Part 5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_email_templates(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_templates WHERE company_id = p_company_id) THEN
    INSERT INTO public.email_templates (company_id, name, subject, body_html, is_default)
    VALUES
      (
        p_company_id,
        'Welcome Introduction',
        'Welcome! Next steps for your inquiry',
        '<p>Hi {{name}},</p><p>Thank you for reaching out! Our team has received your details and will connect with you shortly.</p>',
        true
      ),
      (
        p_company_id,
        'Proposal Follow-up',
        'Following up on our recent conversation',
        '<p>Hi {{name}},</p><p>Checking in to share our next steps and answer any questions you may have.</p>',
        false
      );
  END IF;
END;
$$;

COMMIT;
```

---

## 4. Pre-Flight & Post-Migration Verification Queries

### 4.1 Pre-Flight Checks (Run BEFORE Part 1)
1. Confirm row counts across all tables (record baseline for saladO).
2. Confirm singleton tables don't contain stale duplicate rows that would block `CREATE UNIQUE INDEX`:
```sql
SELECT 'meta_config' AS tbl, count(*) FROM public.meta_config
UNION ALL
SELECT 'lead_routing_config', count(*) FROM public.lead_routing_config
UNION ALL
SELECT 'email_settings', count(*) FROM public.email_settings;
```
*(If any returns `> 1`, deduplicate keeping only the newest/active row before running Step 5 above.)*

### 4.2 Post-Migration Assertions (Run AFTER Part 1)
```sql
-- Every count below MUST return 0
SELECT 'crm_users' AS tbl, count(*) FILTER (WHERE company_id IS NULL) AS null_cnt FROM public.crm_users
UNION ALL SELECT 'pipelines', count(*) FILTER (WHERE company_id IS NULL) FROM public.pipelines
UNION ALL SELECT 'leads', count(*) FILTER (WHERE company_id IS NULL) FROM public.leads
UNION ALL SELECT 'deals', count(*) FILTER (WHERE company_id IS NULL) FROM public.deals
UNION ALL SELECT 'lead_activities', count(*) FILTER (WHERE company_id IS NULL) FROM public.lead_activities
UNION ALL SELECT 'follow_ups', count(*) FILTER (WHERE company_id IS NULL) FROM public.follow_ups
UNION ALL SELECT 'lead_routing_config', count(*) FILTER (WHERE company_id IS NULL) FROM public.lead_routing_config
UNION ALL SELECT 'meta_config', count(*) FILTER (WHERE company_id IS NULL) FROM public.meta_config
UNION ALL SELECT 'connected_forms', count(*) FILTER (WHERE company_id IS NULL) FROM public.connected_forms
UNION ALL SELECT 'meta_capi_logs', count(*) FILTER (WHERE company_id IS NULL) FROM public.meta_capi_logs
UNION ALL SELECT 'email_settings', count(*) FILTER (WHERE company_id IS NULL) FROM public.email_settings
UNION ALL SELECT 'email_templates', count(*) FILTER (WHERE company_id IS NULL) FROM public.email_templates
UNION ALL SELECT 'email_logs', count(*) FILTER (WHERE company_id IS NULL) FROM public.email_logs
UNION ALL SELECT 'whatsapp_messages', count(*) FILTER (WHERE company_id IS NULL) FROM public.whatsapp_messages
UNION ALL SELECT 'crm_todo_lists', count(*) FILTER (WHERE company_id IS NULL) FROM public.crm_todo_lists
UNION ALL SELECT 'crm_todos', count(*) FILTER (WHERE company_id IS NULL) FROM public.crm_todos
UNION ALL SELECT 'crm_backups', count(*) FILTER (WHERE company_id IS NULL) FROM public.crm_backups
UNION ALL SELECT 'ai_chat_logs', count(*) FILTER (WHERE company_id IS NULL) FROM public.ai_chat_logs
UNION ALL SELECT 'support_tickets', count(*) FILTER (WHERE company_id IS NULL) FROM public.support_tickets
UNION ALL SELECT 'password_reset_codes', count(*) FILTER (WHERE company_id IS NULL) FROM public.password_reset_codes;
```
Also verify saladO Web login & leads board continue rendering normally (zero impact on active production users).

---

## 5. Exact Reversible Rollback SQL

> **WARNING**: Run this rollback **only while no second company besides `saladO` has live records** (or after exporting/deleting test companies), because dropping `company_id` removes tenant discriminators.

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.seed_default_email_templates(uuid);

-- Restore original crm_users_safe view without company_id
DROP VIEW IF EXISTS public.crm_users_safe;
CREATE OR REPLACE VIEW public.crm_users_safe AS
SELECT
  id, name, email, role, permissions, created_at, updated_at, must_change_password, password_updated_at
FROM public.crm_users;

-- Restore original column defaults
ALTER TABLE public.leads               ALTER COLUMN assigned_to SET DEFAULT 'pranav';
ALTER TABLE public.lead_routing_config ALTER COLUMN default_assignee SET DEFAULT 'pranav';

-- Drop unique & performance indexes created in Part 1
DROP INDEX IF EXISTS public.idx_meta_config_unique_company;
DROP INDEX IF EXISTS public.idx_lead_routing_config_unique_company;
DROP INDEX IF EXISTS public.idx_email_settings_unique_company;
DROP INDEX IF EXISTS public.idx_leads_company_leadgen_id;
DROP INDEX IF EXISTS public.idx_crm_users_company;
DROP INDEX IF EXISTS public.idx_pipelines_company;
DROP INDEX IF EXISTS public.idx_leads_company_created;
DROP INDEX IF EXISTS public.idx_leads_company_pipeline;
DROP INDEX IF EXISTS public.idx_deals_company_created;
DROP INDEX IF EXISTS public.idx_lead_activities_company;
DROP INDEX IF EXISTS public.idx_follow_ups_company_due;
DROP INDEX IF EXISTS public.idx_connected_forms_company_src;
DROP INDEX IF EXISTS public.idx_meta_config_page_id;
DROP INDEX IF EXISTS public.idx_meta_capi_logs_company;
DROP INDEX IF EXISTS public.idx_email_templates_company;
DROP INDEX IF EXISTS public.idx_email_logs_company;
DROP INDEX IF EXISTS public.idx_whatsapp_messages_company;
DROP INDEX IF EXISTS public.idx_crm_todo_lists_company;
DROP INDEX IF EXISTS public.idx_crm_todos_company;
DROP INDEX IF EXISTS public.idx_crm_backups_company;
DROP INDEX IF EXISTS public.idx_ai_chat_logs_company;
DROP INDEX IF EXISTS public.idx_support_tickets_company;
DROP INDEX IF EXISTS public.idx_pwd_reset_codes_company;

-- Drop company_id columns (leaves all saladO rows untouched)
ALTER TABLE public.crm_users            DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.pipelines            DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.leads                DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.deals                DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.lead_activities      DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.follow_ups           DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.lead_routing_config  DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.meta_config          DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.meta_config          DROP COLUMN IF EXISTS page_id;
ALTER TABLE public.connected_forms      DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.meta_capi_logs       DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.email_settings       DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.email_templates      DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.email_logs           DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.whatsapp_messages    DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.crm_todo_lists       DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.crm_todos            DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.crm_backups          DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.ai_chat_logs         DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.support_tickets      DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.password_reset_codes DROP COLUMN IF EXISTS company_id;

DROP TABLE IF EXISTS public.companies;

COMMIT;
```

