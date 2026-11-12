# Part 2 — Cryptographic JWT Auth Bridge & Strict PostgreSQL RLS

> **Execution Status**: **COMPLETED & VERIFIED** on production Supabase project `xrnawvpypkggpjervppb` (2026-11-11).
> **Prerequisite**: Part 1 verified with `0` NULL `company_id` rows across all 20 tables.
> **Migration SQL**: `supabase/migrations/20261111_part2_auth_rls_lockdown.sql`
> **Rollback SQL**: `supabase/rollbacks/20261111_part2_rollback_policies.sql`
> **Note**: **CRITICAL SECURITY GATE** — PostgreSQL RLS cannot read client `localStorage` (`simplecrm_user_session`). Without cryptographic JWT claims, any anon client could read or delete every company's data.

---

## 1. Current Auth & RLS Baseline (Verified Risks)

1. **`src/lib/auth.js` (`verifyUserCredentials`)**:
   - Currently queries `public.crm_users` using the **public anon key** and verifies either PBKDF2 password hashes or legacy 4-digit PINs in browser JavaScript.
   - Because `crm_users` currently allows public `SELECT` / `INSERT` / `UPDATE` (`for all using (true) with check (true)`), `password_hash`, `pin`, Resend API keys in `email_settings`, and all customer PII in `leads` are exposed if an unauthenticated client hits Supabase REST directly.
2. **Unauthenticated Forgot-Password Flow (`src/lib/auth.js:293-489`)**:
   - `requestPasswordResetCode(email)` queries `crm_users` and `email_settings` directly from the browser before login, and falls back to client-side `.from('password_reset_codes').insert(...)`.
   - `resetPasswordWithCode` falls back to direct `.from('crm_users').update(...)` if RPC fails.
   - **Once RLS is locked down, anon browser clients CANNOT read `crm_users`, `email_settings`, or `password_reset_codes`**, so these must execute inside server-side Edge Functions / `SECURITY DEFINER` RPCs.

---

## 2. Target Architecture: Custom Edge Function `auth-login` + Supabase HS256 JWT

Instead of migrating every **saladO** rep to Supabase Auth (`auth.users`) — which would break 4-digit PIN users and require re-hashing/resetting passwords — we issue **standard Supabase-compatible JWTs directly from a server-side `auth-login` Edge Function**:

### 2.1 How the JWT Works
1. User enters email + password (or legacy 4-digit PIN) on `LoginView.jsx`.
2. `verifyUserCredentials` calls `supabase.functions.invoke('auth-login', { body: { email, password } })`.
3. `auth-login` (`service_role` in Deno):
   - Looks up `crm_users` + joins `public.companies` (`subscription_status`, `trial_ends_at`, `seat_limit`, `is_billing_exempt`).
   - Verifies PBKDF2 hash (`pbkdf2_sha256:`) OR legacy 4-digit `pin` (preserving `must_change_password` & `SecurityUpgradeModal` seamlessly!).
   - Rejects or marks expired trial if `company.subscription_status IN ('expired', 'cancelled')` *(Note: still return signed JWT or limited paywall session so Admin can see the Day-15 Razorpay paywall screen cleanly in Stage 2!)*.
   - Mints an HS256 JWT signed with Supabase's `JWT_SECRET` (or `SUPABASE_JWT_SECRET`) containing:
     ```json
     {
       "aud": "authenticated",
       "role": "authenticated",
       "sub": "<crm_users.id>",
       "email": "<crm_users.email>",
       "company_id": "<crm_users.company_id>",
       "app_role": "<crm_users.role>",
       "exp": 1794900000
     }
     ```
4. Client receives `{ access_token, user, company }`:
   - Stores session securely in `localStorage` (`SESSION_STORAGE_KEY = 'simplecrm_user_session'`).
   - Configures the singleton `supabase` client in `src/lib/supabase.js` so **all PostgREST, Edge Function, and Realtime calls send `Authorization: Bearer <access_token>`** + calls `supabase.realtime.setAuth(access_token)`.
   - Adds transparent token refresh (`auth-refresh` endpoint or rolling session renewal before `exp`).
5. **Password Upgrades & Changes**:
   - Move `setUserPassword` (`src/lib/auth.js:516+`) and `resetPasswordWithCode` (`requestPasswordResetCode` + `resetPasswordWithCode`) to `auth-password` Edge Function / hardened `SECURITY DEFINER` RPCs so the browser NEVER touches `crm_users.password_hash` or `email_settings` unauthenticated!
   - Replace `src/App.jsx` mount verification query (`supabase.from('crm_users').select(...).eq('id', ...)`) with JWT-authenticated user + company state refresh (`auth-session` or JWT-protected `crm_users_safe`).

---

## 3. PostgreSQL RLS Helper Functions & Strict Policies

### 3.1 SQL Helper Functions (`supabase/migrations/20261113_part2_rls_helpers.sql`)

```sql
-- Extracts authenticated tenant UUID from verified Supabase JWT claims
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      auth.jwt() ->> 'company_id',
      current_setting('request.jwt.claims', true)::jsonb ->> 'company_id'
    ),
    ''
  )::uuid;
$$;

-- Extracts app-level user role ('admin' | 'member')
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'app_role',
    current_setting('request.jwt.claims', true)::jsonb ->> 'app_role',
    'member'
  );
$$;

-- Extracts current crm_users.id
CREATE OR REPLACE FUNCTION public.current_crm_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid();
$$;
```

### 3.2 Dynamic Clean Drop of Permissive Legacy Policies + Strict Tenant Policies

> **Important**: Earlier migrations created policies with auto-generated or varied names (e.g. `Allow all`, `Enable read access for all users`, etc.). The safest reversible migration drops existing permissive policies via `pg_policies` inspection or explicitly recorded policy snapshots, then installs strict tenant policies.

```sql
-- Template applied per tenant table (repeat explicitly for clarity & auditability):
ALTER TABLE public.<TABLE_NAME> ENABLE ROW LEVEL SECURITY;

-- DROP known permissive policies (verified via SELECT * FROM pg_policies WHERE schemaname = 'public')
-- DROP POLICY IF EXISTS "..." ON public.<TABLE_NAME>;

-- Enforce tenant read/write boundaries
CREATE POLICY "tenant_isolation_select"
  ON public.<TABLE_NAME>
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_insert"
  ON public.<TABLE_NAME>
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_update"
  ON public.<TABLE_NAME>
  FOR UPDATE
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tenant_isolation_delete"
  ON public.<TABLE_NAME>
  FOR DELETE
  TO authenticated
  USING (company_id = public.current_company_id());
```

### 3.3 Table-by-Table Policy Specialization Matrix

| Table | `SELECT` Rule | `INSERT` / `UPDATE` / `DELETE` Rule | Special Restriction |
|---|---|---|---|
| `companies` | `id = current_company_id()` | Admin only or `service_role` only (`subscription_status`, `seat_limit`, `is_billing_exempt` MUST ONLY be mutated by `service_role`) | Prevents tenant self-extending trial or hacking `seat_limit`! |
| `crm_users` | `company_id = current_company_id()` | **Admin-only write** (`current_app_role() = 'admin'`) or own profile update excluding `role`/`company_id` | Anon CANNOT read `crm_users`; login goes through `auth-login` |
| `email_settings`, `meta_config`, `lead_routing_config` | `company_id = current_company_id()` | **Admin-only write** (`current_app_role() = 'admin'`) | Keeps Resend & Meta access tokens invisible to `anon` |
| `leads`, `deals`, `pipelines`, `connected_forms`, `custom_field_definitions`, `lead_activities`, `follow_ups`, `crm_todo_lists`, `crm_todos`, `email_templates`, `email_logs`, `whatsapp_messages`, `meta_capi_logs`, `crm_backups`, `ai_chat_logs`, `support_tickets` | `company_id = current_company_id()` | `company_id = current_company_id()` (respecting existing role gating in UI + DB `WITH CHECK`) | Blocks cross-tenant spoofing on `company_id` even on `INSERT`/`UPDATE` |
| `password_reset_codes` | **DENY ALL** (`USING (false)`) | Only Edge Functions (`service_role`) / `SECURITY DEFINER` RPCs touch this table | Remove direct client table fallback from `src/lib/auth.js` |

> **Transition Cleanup (after Parts 3 & 4 cut over)**: Drop the temporary `'00000000-0000-4000-8000-000000000001'` `DEFAULT` on `company_id` (and revoke `anon` `SELECT` on `public.companies`) once all Edge Functions and clients send JWTs & `company_id`.

### 3.4 Secure RPC Refactor (`20261107_database_security_lockdown.sql` cleanup)
- Populate `company_id` automatically inside `create_password_reset_code(p_email, p_code)` from `crm_users` (never trusting client input) and revoke `anon` direct `EXECUTE` if handled purely inside the new `auth-reset` Edge Function (`service_role`).
- Update `verify_and_consume_reset_code` to validate OTP atomically using server-side PBKDF2 / hash and revoke/rotate tokens cleanly.

---

## 4. Safe Dual-Mode Deployment Sequence (Zero Cutoff for saladO)

To avoid locking out cached browser tabs or existing saladO Android APKs mid-rollout:

1. **Step 2A (Server Deploy — Zero Breaking Changes)**:
   - Deploy `auth-login`, `auth-password-reset`, `auth-session` Edge Functions with Supabase `JWT_SECRET`.
   - Keep old permissive RLS enabled temporarily while verifying JWT generation via curl/integration tests for a saladO user.
2. **Step 2B (Client Deploy — Frontend & APK)**:
   - Update `src/lib/supabase.js` & `src/lib/auth.js` to obtain the JWT on login and attach it to REST + Realtime.
   - Wait for saladO team members to refresh Web & update Android APK (verify `currentUser` sessions have valid JWTs; force re-login cleanly once if missing `access_token` in legacy `simplecrm_user_session`).
3. **Step 2C (Database RLS Lock)**:
   - Snapshot all existing `pg_policies` definitions into `supabase/rollbacks/snapshot_pre_part2_policies.sql` **before executing**.
   - Enable strict tenant RLS on all tables (`auth.role() = 'authenticated'` + `company_id = public.current_company_id()`).

---

## 5. Verification Checklist

1. **Anon Access Rejection**: Run unauthenticated REST queries against `/rest/v1/leads`, `/rest/v1/crm_users`, `/rest/v1/meta_config`, `/rest/v1/email_settings` with only the anon key -> **MUST return `0` rows / HTTP 401/403**.
2. **Cross-Tenant Penetration Test**:
   - Create synthetic Company B user JWT (`company_id = '00000000-...-0002'`) alongside saladO JWT (`company_id = '00000000-...-0001'`).
   - Query every one of the 20 tables using Company B JWT -> **0 saladO rows returned**.
   - Attempt `INSERT INTO leads (..., company_id = <saladO_id>)` using Company B JWT -> **PostgreSQL RLS violation (`42501`)**.
   - Attempt `DELETE FROM connected_forms` using Company B JWT -> **0 saladO rows affected**.
3. **saladO Auth Continuity Test**: Log in with existing saladO PBKDF2 password AND verify a legacy 4-digit PIN account can still sign in and get prompted by `SecurityUpgradeModal`.
4. **Password Reset Test**: Verify Forgot Password OTP works end-to-end without exposing `email_settings` or `crm_users` to anon queries.

---

## 6. Exact Reversible Rollback Plan

1. **If Step 2C RLS lock causes an unexpected issue for saladO users**:
   - Execute the pre-Part-2 policy snapshot (`supabase/rollbacks/part2_rollback_policies.sql`):
     ```sql
     BEGIN;
     -- Drop strict tenant policies across all 20 tables + companies
     -- Re-apply original permissive policies captured in pg_policies snapshot BEFORE Step 2C
     -- Keep auth-login Edge Function deployed (harmless alongside open RLS)
     COMMIT;
     ```
2. **If Step 2B frontend JWT integration fails**:
   - Revert client commit cleanly; old anon client code still operates if Step 2C is rolled back (or not yet applied).
3. **Zero data loss**: Part 2 creates no destructive schema drops and mutates zero customer rows.

---

## 7. Executed Implementation & Live Verification Record

### 7.1 Architectural Refinement Applied
Instead of extracting raw `JWT_SECRET` manually, `_shared/authBridge.ts` provisions a **1-to-1 shadow Supabase Auth identity** (`auth.users.id = crm_users.id`) with `app_metadata: { company_id, crm_user_id, app_role }` and mints native Supabase Auth tokens via `admin.generateLink` + `verifyOtp`. This preserves **saladO** PBKDF2 password hashes and legacy 4-digit PINs with zero forced resets while enabling native 1-hour token refresh (`autoRefreshToken`) and authenticated Realtime WebSockets.

### 7.2 Deployed Artifacts
- **Edge Functions** (`xrnawvpypkggpjervppb`, `--no-verify-jwt` for public auth endpoints; caller JWT verified inside handlers where required):
  - `supabase/functions/_shared/authBridge.ts` — PBKDF2 hash/verify, `sanitizeCrmUser`, shadow session minting, `getAuthenticatedCrmCaller`, and `sendSystemResendEmail` (company `email_settings` first, optional `PLATFORM_RESEND_API_KEY` fallback).
  - `supabase/functions/auth-login/index.ts` — `login` (password or legacy PIN) and `session_profile`.
  - `supabase/functions/auth-password-reset/index.ts` — server-side OTP `request` and atomic `verify`.
  - `supabase/functions/auth-password-update/index.ts` — authenticated `set_password` and admin-only `invite_email`.
- **Frontend Auth Integration**:
  - `src/lib/supabase.js` — session persistence (`storageKey: 'simplecrm_supabase_auth'`), `onAuthStateChange` Realtime sync, `attachSupabaseSession`, and `clearSupabaseSession`.
  - `src/lib/auth.js` — routed login, profile refresh, password updates, invites, and password reset OTP flows through the Edge Functions (removed direct anon REST/table fallbacks on `crm_users`, `email_settings`, and `password_reset_codes`).
  - `src/App.jsx`, `src/components/LoginView.jsx`, `src/components/AdminUsersView.jsx` — session refresh (`fetchAuthenticatedProfile`), company cache updates, sanitized `is_secured` checks, and `{ attachSession: false }` on admin delete verification.
- **Database Lockdown & Rollback**:
  - `supabase/migrations/20261111_part2_auth_rls_lockdown.sql` — creates `public.current_company_id()` and `public.is_company_admin()`, sets `crm_users_safe` to `security_invoker = true` (revoking `anon`), enables RLS across all 20 `public` tables, drops legacy permissive policies, enforces strict `TO authenticated` tenant isolation (`admin`-gated writes on `crm_users`, `meta_config`, `email_settings`; `authenticated` `UPDATE` preserved on `lead_routing_config` for CSV imports), and restricts OTP RPCs to `service_role`.
  - `supabase/rollbacks/20261111_part2_rollback_policies.sql` — exact snapshot of pre-Part-2 policies and grants for clean one-shot rollback.

### 7.3 Live Verification Results
- **RLS Coverage**: `20 / 20` `public` tables confirmed `relrowsecurity = true` (`0` disabled).
- **Anon Lockdown**: Unauthenticated REST `GET` queries across `crm_users_safe`, `companies` (HTTP `401`) and all 19 other live/system tables (HTTP `200`, `0` rows) returned zero **saladO** records; anon RPC calls to `create_password_reset_code` and `verify_and_consume_reset_code` returned HTTP `401` (`42501`).
- **Cross-Tenant & Role Penetration Test** (synthetic Company B `member` fixture, cleaned up in `finally`):
  - `auth-login` issued valid JWT for legacy PIN (`isLegacyPin: true`); `auth-password-update` upgraded to PBKDF2 (`is_secured: true`), subsequent password login succeeded, old PIN login returned `success: false`, and `session_profile` returned HTTP `200`.
  - Authenticated Company B reads returned only Company B rows (`1` row each on `leads`, `crm_users`, `crm_users_safe`, `companies`, `meta_config`, `email_settings`) and `0` **saladO** rows across `lead_activities`, `email_logs`, `pipelines`, `connected_forms`, `ai_chat_logs`, `follow_ups`, `lead_routing_config`, and `password_reset_codes`.
  - Spoof `INSERT` into **saladO** `leads` failed with HTTP `403` (`42501`); non-admin `PATCH`/`DELETE` on `crm_users`, `meta_config`, and `email_settings` matched `0` rows (`[]`); authenticated RPC calls returned HTTP `403`.
  - Post-cleanup row counts matched Part 1 baseline (`companies: 1`, `crm_users: 5`, `auth_users: 0`, `leads: 865`, `meta_config: 1`, `email_settings: 1`).
- **Operational Notes**:
  - Existing **saladO** browser/APK sessions cached without a Supabase Auth JWT will sign out once on mount (`App.jsx`) and receive a valid JWT upon next sign-in.
  - Before onboarding external trial companies without custom Resend credentials, set the optional fallback secrets in Supabase:
    `supabase secrets set PLATFORM_RESEND_API_KEY=<key> PLATFORM_RESEND_FROM_EMAIL=noreply@mail.capoasis.com`


