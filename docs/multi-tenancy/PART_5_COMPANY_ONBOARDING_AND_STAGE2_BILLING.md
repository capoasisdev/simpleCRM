# Part 5 — Multi-Company Trial Onboarding, Billing Integration & Isolation Verification

> **Execution Status**: Executed & verified on live Supabase (`xrnawvpypkggpjervppb`) on `2026-11-11` (all 23 live verification checks passed; Razorpay Edge Functions fail closed at `503` until `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` are added to Supabase Secrets).
> **Prerequisite**: Parts 1–4 completed and verified against staging/production checks.
> **Companion Doc**: [`RAZORPAY_BILLING_AND_TENANCY_PLAN.md`](../RAZORPAY_BILLING_AND_TENANCY_PLAN.md) (Stage 2 Razorpay Paywall & In-App Add-Seat Purchase Specification).

---

## 1. Objective
1. Persist 14-day trial signups captured from [`PricingView.jsx`](../../src/components/landing/PricingView.jsx) / landing CTAs into PostgreSQL (`trial_enrollments`) instead of a client-only mock timeout (`PricingView.jsx:71-74`).
2. Provide a clean, atomic **`provision-company` Edge Function / RPC** to spin up new customer companies cleanly (14-day trial + default pipeline + default email templates + lead routing config + first admin user + welcome invite email).
3. Enforce active seat counts (`companies.seat_limit`) when admins add reps in [`AdminUsersView.jsx`](../../src/components/AdminUsersView.jsx).
4. Wire Stage 2 **Day-15 Trial Expiration Paywall & Buy More Seats** (`billing_transactions` + Razorpay webhook) while keeping **saladO** exempt (`is_billing_exempt = true`, `subscription_status = 'active'`).
5. Run an end-to-end **Multi-Tenant Security & Reversibility Drill** before onboarding paying customers.

---

## 2. Database Schema Additions (`supabase/migrations/20261116_part5_onboarding_and_billing.sql`)

```sql
BEGIN;

-- 1. Public Trial Enrollment Intake Log
CREATE TABLE IF NOT EXISTS public.trial_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company_name text,
  work_email text NOT NULL,
  phone text NOT NULL,
  requested_seats integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'provisioned', 'converted', 'churned')),
  provisioned_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_enrollments ENABLE ROW LEVEL SECURITY;
-- Anon/public submissions go via Edge Function `enroll-trial` (service_role)
-- Prevents bots reading lead emails/phones via REST SELECT!

-- 2. Stage 2 Razorpay Billing Ledger (per docs/RAZORPAY_BILLING_AND_TENANCY_PLAN.md)
CREATE TABLE IF NOT EXISTS public.billing_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('initial_activation', 'seat_addon', 'renewal')),
  seats_delta integer NOT NULL DEFAULT 0,
  amount_inr numeric(12, 2) NOT NULL,
  razorpay_order_id text,
  razorpay_payment_id text UNIQUE,
  razorpay_signature text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_tx_company ON public.billing_transactions(company_id, created_at DESC);

ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_billing_select"
  ON public.billing_transactions
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());
-- Inserts/Updates are service_role only (Razorpay server verify/webhook)

COMMIT;
```

---

## 3. Atomic Tenant Provisioning Workflow

### 3.1 Landing / Pricing Trial Capture (`PricingView.jsx`)
- Replace the mock `setTimeout` (`PricingView.jsx:71-74`) with `supabase.functions.invoke('enroll-trial', { body: { name, workEmail, phone, companyName, requestedSeats } })`.
- `enroll-trial` (`service_role`):
  1. Validates email format & duplicate pending enrollment rate limits.
  2. Saves lead into `public.trial_enrollments`.
  3. Sends optional founder alert notification (so `simplecrm` team can follow up personally on Day 14 / trial expiry as planned).
  4. Depending on founder preference: either keeps status `'pending'` for assisted onboarding OR auto-invokes `provisionCompany(...)` to give instant sandbox access!

### 3.2 `provisionCompany(...)` Seeding Steps (Single Transaction / Edge Function)
When provisioning Company $N$ (assisted from founder console OR self-serve auto-provision):
1. Verify `admin_email` does not already exist in `crm_users` (globally unique email guarantee).
2. Insert row in `public.companies` (`subscription_status = 'trialing'`, `trial_starts_at = now()`, `trial_ends_at = now() + interval '14 days'`, `seat_limit = requested_seats`).
3. Seed 1 default Sales Pipeline (`name = 'Sales Pipeline'`, `is_default = true`, `pipeline_type = 'sales'`, standard stages) + default `lead_routing_config` (`mode = 'round_robin'`, `default_assignee = 'unassigned'`).
4. Call `SELECT public.seed_default_email_templates(new_company_id)` (defined in Part 1).
5. Insert first `crm_users` record (`role = 'admin'`, temporary PBKDF2-hashed password, `must_change_password = true`).
6. Send welcome email with credentials via `send-email` (`allow_platform_fallback: true`) so they can log in immediately on Web or Android APK!

---

## 4. Seat Enforcement & Stage 2 Billing Activation

1. **Seat Limit Enforcement**:
   - In [`AdminUsersView.jsx`](../../src/components/AdminUsersView.jsx), display `Active Seats: X / {company.seat_limit}`.
   - Disable "+ Add Member" once `X >= company.seat_limit` and surface the **Buy More Seats** action (Stage 2 modal) — also enforce the limit in a PostgreSQL `BEFORE INSERT ON public.crm_users` trigger or Edge Function so API tampering cannot bypass `seat_limit`!
2. **14-Day Trial Expiration Gate (`App.jsx` & `auth-login`)**:
   - When `company.is_billing_exempt === false` AND `company.subscription_status === 'trialing'` AND `now() > company.trial_ends_at`:
     - Show trial expiry paywall UI (Stage 2 Razorpay checkout per [`RAZORPAY_BILLING_AND_TENANCY_PLAN.md`](../RAZORPAY_BILLING_AND_TENANCY_PLAN.md)) — allow Admin to purchase initial seats (`seats * 999`) or contact sales, while displaying read-only/locked notice for non-admin reps.
   - **saladO Protection**: `saladO` has `subscription_status = 'active'` and `is_billing_exempt = true` (set in Part 1), so saladO **never triggers trial expiration**!
3. **Razorpay Server Verification**:
   - Follow [`RAZORPAY_BILLING_AND_TENANCY_PLAN.md`](../RAZORPAY_BILLING_AND_TENANCY_PLAN.md): verify `razorpay_signature` (`HMAC-SHA256`) in a `razorpay-verify` Edge Function (`service_role`) + idempotent `razorpay-webhook` before mutating `billing_transactions`, `companies.subscription_status = 'active'`, and incrementing `companies.seat_limit`.

---

## 5. Final End-to-End Verification Matrix (Pre-Launch Gate)

Before inviting the first external trial company onto `simplecrm`:

| Verification Check | Observed Verification Outcome (`2026-11-11`) |
|---|---|
| **1. saladO Continuity & Exemption** | Verified `saladO` (`00000000-0000-4000-8000-000000000001`) untouched (`subscription_status='active'`, `is_billing_exempt=true`, `seat_limit=100`; baseline counts identical before & after: `5` users, `865` leads, `4` pipelines, `3` connected_forms, `2` email_templates, `0` billing_transactions). Frontend `isCompanyAccessLocked(company)` never locks billing-exempt companies |
| **2. Database Cross-Tenant Isolation** | Provisioned Company A via `enroll-trial` and Company B via `provision-company`; authenticated as Company B Admin (`auth-login`) -> confirmed 0 rows visible from `saladO`/Alpha across tenant tables + `billing_transactions`; confirmed `trial_enrollments` blocked (`403`); confirmed spoofed `INSERT` into `leads` and `crm_users` with `saladO` UUID rejected (`403`) |
| **3. Webhook & Autopilot Isolation** | Triggered `website-webhook` for Company B active trial -> lead ingested (`200`); expired Company B -> `website-webhook` blocked (`403`) and `discovery-autopilot` skipped (`200`, 0 runs); set Company B to `'pilot_extended'` with future expiry -> `website-webhook` resumed accepting (`200`); `saladO` connected forms (`3`) remained untouched |
| **4. Provisioning & Global Uniqueness** | `enroll-trial` creates `trial_enrollments` (`status='provisioned'`), `companies` (14-day trial), default `'Sales Pipeline'`, `lead_routing_config`, 2 seeded `email_templates`, and Admin `crm_users` (`must_change_password=true`); rejects duplicate email (`409 EMAIL_EXISTS`); `provision-company` rejects unauthenticated/anon (`401`) and succeeds with verified `service_role` (`201`) |
| **5. Seat Limit & Billing Endpoints** | DB trigger `trg_crm_users_enforce_seat_limit` allowed 2/2 seats for Company B and rejected 3rd insert under both Admin JWT (`400`) and `service_role` (`400`); `razorpay-create-order` blocked non-admin (`403`), below-active seats (`400`), expired `seat_addon` (`400`), and missing `RAZORPAY_*` keys (`503`); `razorpay-verify`/`razorpay-webhook` failed closed (`503`); `billing_transactions` allowed tenant `SELECT` and blocked client `INSERT` (`403`) |
| **6. Frontend Build & Integration** | `PricingView.jsx` wired to `enroll-trial`, `LoginView.jsx` supports `initialEmail` prefill, `AdminUsersView.jsx` enforces DB-first add-user error handling + `X / seat_limit` badge, `DashboardView.jsx` adds `Seats & Billing` + trial chip, and `App.jsx` gates expired non-exempt workspaces with `TrialExpiredPaywall` (`npm run build` clean; synthetic fixtures cleaned up after test) |

### Post-Launch / Razorpay Live Key Activation Note
- Live Razorpay charge & webhook signature verification in production requires configuring `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in Supabase Edge Function Secrets, then placing a ₹1 test transaction end-to-end.
- Follow-up (`2026-11-12`): `public.crm_backups` and `public.whatsapp_messages` have now been created, added to `supabase_realtime`, protected by tenant RLS, and live-verified via [`20261117_add_backups_and_whatsapp_tables.sql`](../../supabase/migrations/20261117_add_backups_and_whatsapp_tables.sql).

---

## 6. Reversible Rollback Summary
- `trial_enrollments` and `billing_transactions` are purely additive tables; dropping them (before live paid transactions) leaves Parts 1–4 intact.
- Disabling self-serve auto-provisioning only requires toggling `enroll-trial` to store `'pending'` rows instead of invoking `provisionCompany`.
- Full emergency revert documentation across Parts 1–5 guarantees **saladO** never loses production state at any stage.

