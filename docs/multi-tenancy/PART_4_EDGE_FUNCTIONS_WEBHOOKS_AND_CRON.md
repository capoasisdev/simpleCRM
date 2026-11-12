# Part 4 — Edge Functions, Webhooks & Scheduled Autopilot Isolation

> **Execution Status**: Completed, deployed to live Supabase (`xrnawvpypkggpjervppb`), and verified end-to-end.
> **Prerequisite**: Part 1 deployed (`company_id` + `meta_config.page_id` exist); Part 2 JWT claims ready for authenticated client invocations.
> **Scope**: All 4 Edge Functions in `supabase/functions/` and the cron job in `20261105_discovery_autopilot_cron.sql`.

---

## 1. Objective
All 4 Supabase Edge Functions currently use `service_role` (bypassing RLS!). Once multi-tenancy goes live, an unscoped `.limit(1)` query inside a `service_role` Edge Function is a **severe cross-tenant data leak**. Part 4 isolates every webhook, outbound email dispatch, and autonomous discovery job per `company_id`.

---

## 2. Edge Function-by-Function Refactoring Plan

### 2.1 [`supabase/functions/meta-webhook/index.ts`](../../supabase/functions/meta-webhook/index.ts)
**Current Problem**:
- Uses single `.from("meta_config").limit(1)` reads (`lines 35, 73, 151, 557`).
- Checks duplicate `leadgen_id` globally without company scoping (`line 92`).
- Queries `pipelines` (`lines 274, 306, 441, 450`), `lead_routing_config` (`lines 347, 379`), `email_settings` (`line 467`), `email_templates` (`line 474`) globally without `company_id`.
- Inserts into `leads` (`line 415`), `email_logs` (`line 519`), `lead_activities` (`lines 534, 618, 629`) without `company_id`.
- Falls back to `'pranav'` (`lines 226, 230, 238, 266, 282, 355`).

**Target Multi-Tenant Design**:
1. **Webhook Challenge (`GET`)**: Validate `hub.verify_token` against platform secret `META_VERIFY_TOKEN` (shared across the `simplecrm` Meta App), or fall back to matching an existing row in `meta_config`.
2. **Deterministic Tenant Resolution (`POST`)**:
   - Inspect incoming Meta `entry.id` (`page_id`) AND `value.form_id`.
   - **Step A**: Lookup `connected_forms` by `form_id` (select `company_id, pipeline_id, entry_stage_id, allocation_mode`).
   - **Step B**: If form not yet registered, lookup `meta_config` by `.eq("page_id", entry.id)` to resolve `company_id` and its Page `access_token`.
   - If neither resolves a valid `company_id`, log structured warning and return HTTP 200 `{ skipped: "unmapped_page_or_form" }` (so Meta doesn't spam retries for unconfigured test pages).
   - Fetch that company's `companies.subscription_status`: process normally if `'trialing' | 'active' | 'past_due'`.
3. **Strict Tenant Queries & Writes**:
   - Scope `meta_config`, `pipelines`, `lead_routing_config`, `email_settings`, `email_templates`, and `leadgen_id` deduplication strictly by `.eq("company_id", companyId)`.
   - Stamp `company_id: companyId` on all inserts into `leads`, `email_logs`, and `lead_activities`.
   - Replace `'pranav'` fallbacks with `'unassigned'` (or first enabled user in that company's routing config).

---

### 2.2 [`supabase/functions/website-webhook/index.ts`](../../supabase/functions/website-webhook/index.ts)
**Current Problem**:
- Resolves `connected_forms` (`lines 91, 130, 136, 142`) and `pipelines` (`lines 189, 219`), inserts `leads` (`line 330`) without `company_id`, and defaults assignee to `'pranav'` (`lines 185, 197`).

**Target Multi-Tenant Design**:
1. Extract `form_id` (plus optional `company_slug` / site validation) from incoming website form payload.
2. Lookup `connected_forms` by `form_id` and require non-null `form.company_id`.
3. Scope fallback `pipelines` query (`.eq("company_id", companyId)`), round-robin updates (`.eq("company_id", companyId)`), and lead creation (`company_id: companyId`).
4. Replace `'pranav'` fallback (`lines 185, 197`) with `'unassigned'`.

---

### 2.3 [`supabase/functions/send-email/index.ts`](../../supabase/functions/send-email/index.ts)
**Current Problem**:
- Reads `.from("email_settings").order("created_at", { ascending: false }).limit(1).maybeSingle()` (`lines 39-44`) globally and inserts `email_logs` (`line 140`) without `company_id`.
- Any company invoking `send-email` could accidentally send mail through **saladO**'s Resend API key & verified sender domain!

**Target Multi-Tenant Design**:
1. **Determine Caller Authority & `company_id` Safely (NEVER trust raw client-supplied `company_id` on anon/user tokens)**:
   - Parse `Authorization: Bearer <token>`.
   - **If User JWT**: Verify signature using Supabase JWT verification / `supabase.auth.getUser(token)` / JWT claim decode -> extract verified `company_id` from token claims. Reject unauthenticated callers (`401`).
   - **If `service_role` / Internal Trigger** (e.g., `auth-password-reset`, `provision-company`, or `meta-webhook`): Allow explicit `body.company_id` + optional `body.allow_platform_fallback` flag.
2. Lookup `email_settings` with `.eq("company_id", companyId).maybeSingle()`.
   - If company Resend isn't connected:
     - For normal CRM emails (`MessagesView` / workflows): return clear `400` `"Email integration not configured for your company"`.
     - For system auth/invite emails (`allow_platform_fallback: true`): use platform secret `PLATFORM_RESEND_API_KEY` + platform sender (`noreply@simplecrm.capoasis.com` or configured sender) so trials/OTP resets work out-of-the-box!
3. Stamp `company_id` on `email_logs.insert` (`line 140`).

---

### 2.4 [`supabase/functions/discovery-autopilot/index.ts`](../../supabase/functions/discovery-autopilot/index.ts) & [`20261105_discovery_autopilot_cron.sql`](../../supabase/migrations/20261105_discovery_autopilot_cron.sql)
**Current Problem**:
- Line `113` contains a hardcoded `FALLBACK_SERPER_KEY`.
- Line `428` scans all `pipeline_type = 'cold'` pipelines across the DB without checking company subscription status or caller authorization.
- Line `472` fetches `leads` for deduplication globally (could mistakenly treat Company A's prospect phone/email as a duplicate for Company B!).
- Line `600` inserts `readyToInsert` into `leads` without `company_id`.
- `20261105_discovery_autopilot_cron.sql` invokes `discovery-autopilot` using a hardcoded anon key header.

**Target Multi-Tenant Design**:
1. **Remove Hardcoded Key**: Delete `FALLBACK_SERPER_KEY` (`line 113`); rotate exposed key and configure `SERPER_API_KEY` strictly via Supabase Secrets (`supabase secrets set`).
2. **Caller Authorization**:
   - If invoked manually from UI with `pipeline_id`: verify User JWT `company_id === pipeline.company_id` (prevent Company B triggering/reading Company A's pipeline!).
   - If invoked by `pg_cron`: validate a shared `X-Cron-Secret` header stored in Postgres Vault / Edge Secrets (instead of only checking anon JWT).
3. **Active Tenant Gate & Isolation**:
   - Join or query `companies` so cron sweeps ONLY run for companies where `subscription_status IN ('trialing', 'active')` (plus optional per-tenant daily discovery quota cap to protect platform Serper credits!).
   - Scope `leads` dedup query (`line 472`) by `.eq("company_id", pipe.company_id)`.
   - Inject `company_id: pipe.company_id` on every lead in `readyToInsert` (`line 600`) and any `lead_activities` inserts.

---

## 3. Rollout & Verification Checklist

1. Set secrets first: `PLATFORM_RESEND_API_KEY`, `SERPER_API_KEY` (rotated), `META_APP_SECRET`, `META_VERIFY_TOKEN`, `CRON_SECRET`.
2. Deploy updated Edge Functions one by one (`meta-webhook`, `website-webhook`, `send-email`, `discovery-autopilot`).
3. Update `pg_cron` function in DB to pass `X-Cron-Secret`.
4. **Tests**:
   - Send test `website-webhook` POST with **Company B** `form_id` -> verify lead appears under Company B (`company_id = B`), assigned `'unassigned'` (not `'pranav'`), invisible to `saladO`.
   - Call `send-email` using **Company B** JWT -> verify it fails cleanly (if Company B has no Resend settings) and NEVER uses `saladO`'s Resend key!
   - Simulate `meta-webhook` for two mock `page_id`s -> verify strict tenant routing and `company_id`-scoped dedup.
   - Trigger `discovery-autopilot` for Company B cold pipeline -> verify Company A existing lead phone number does NOT block Company B from ingesting the same public business lead.

---

## 4. Reversible Rollback Plan
- Every Supabase Edge Function keeps deployment history in git + Supabase dashboard.
- If a regression impacts **saladO** webhooks or email sending:
  1. Immediately check out the pre-Part-4 Edge Function code commit and run `supabase functions deploy <fn-name> --no-verify-jwt --project-ref xrnawvpypkggpjervppb` to restore behavior in seconds, alongside applying [`20261111_part4_rollback_cron.sql`](../../supabase/rollbacks/20261111_part4_rollback_cron.sql) if restoring `public.trigger_discovery_autopilot()`.
  2. Notice `company_id` NOT NULL from Part 1 means even a rolled-back function should only be restored briefly alongside a fallback default, OR fixed in-place cleanly since saladO data already has `company_id` mapped.

---

## 5. Execution Log & Live Verification (`xrnawvpypkggpjervppb`)

### Deployed & Applied Artifacts
- **Shared Auth & Lead Distribution (`supabase/functions/_shared/`)**:
  - Updated [`authBridge.ts`](../../supabase/functions/_shared/authBridge.ts) with `constantTimeEqual`, `extractBearerToken`, `isServiceRoleRequest`, and `isCronSecretRequest`.
  - Created [`leadDistribution.ts`](../../supabase/functions/_shared/leadDistribution.ts) (`pickWeightedRule`, `resolveCompanyLeadAssignee`) to isolate form/pipeline/routing-config assignment per `company_id` with `'unassigned'` fallback (zero `'pranav'` defaults).
- **Updated & Deployed Edge Functions (`--no-verify-jwt`, internal cryptographic auth/signature gates)**:
  - [`meta-webhook`](../../supabase/functions/meta-webhook/index.ts) (v17): deterministic `connected_forms.form_id` -> `meta_config.page_id` tenant resolution, optional `X-Hub-Signature-256` HMAC verification against `META_APP_SECRET` or tenant `meta_config.app_secret`, subscription gating (`trialing | active | past_due`), strict `META_VERIFY_TOKEN` / DB token match on `GET`, company-scoped `leadgen_id` deduplication, `company_id` stamped on `leads`, `email_logs`, and `lead_activities`, and `email_settings` / `email_templates` / `meta_config` isolation.
  - [`website-webhook`](../../supabase/functions/website-webhook/index.ts) (v7): authoritative tenant lookup via `connected_forms.form_id`, subscription status gating, company-scoped domain tracking & pipeline check, assignee resolution via `resolveCompanyLeadAssignee`, and `company_id` stamped on `leads` (fixed pre-existing schema mismatch by moving `source: 'website'` into `custom_fields` and omitting non-existent top-level `source` / `updated_at` columns on `public.leads`).
  - [`send-email`](../../supabase/functions/send-email/index.ts) (v4): rejects unauthenticated callers (`401`); binds user JWT callers strictly to their verified `crm_users.company_id` (`400` if company Resend is unconfigured); permits `PLATFORM_RESEND_API_KEY` fallback only for verified `service_role` calls with `allow_platform_fallback: true`; stamps `company_id` on `email_logs`.
  - [`discovery-autopilot`](../../supabase/functions/discovery-autopilot/index.ts) (v12): static health `GET`; requires `X-Cron-Secret`, `service_role`, or valid user JWT on `POST` (`401` otherwise); binds user calls to caller `company_id` (`404` on foreign `pipeline_id`); gates runs on `companies.subscription_status IN ('trialing', 'active')`; deleted hardcoded `FALLBACK_SERPER_KEY` (uses tenant BYO key or `SERPER_API_KEY` secret); enforces 24h per-tenant platform discovery cap (`PLATFORM_DAILY_DISCOVERY_CAP`, default 150); scopes deduplication and `leads` inserts by `company_id`.
- **Secrets Synced (`supabase secrets set` & Postgres Vault)**:
  - Synced `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `OPENROUTER_API_KEY`, `SERPER_API_KEY` (verified matching `.env`), generated 64-hex `CRON_SECRET` (mirrored in `vault.secrets` as `discovery_autopilot_cron_secret`), and configured `PLATFORM_RESEND_API_KEY`, `PLATFORM_RESEND_FROM_NAME=simplecrm`, `PLATFORM_RESEND_FROM_EMAIL=noreply@mail.capoasis.com` (using approved **saladO** Resend key fallback without mutating `email_settings`).
- **Database Cron Hardening**:
  - Executed [`20261111_part4_cron_and_secrets.sql`](../../supabase/migrations/20261111_part4_cron_and_secrets.sql): updated `public.trigger_discovery_autopilot()` to filter due cold pipelines joined with active/trialing `companies`, read `discovery_autopilot_cron_secret` from `vault.decrypted_secrets`, send `X-Cron-Secret` via `net.http_post`, and revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`.
  - Created rollback script [`20261111_part4_rollback_cron.sql`](../../supabase/rollbacks/20261111_part4_rollback_cron.sql).

### Live Verification Results (`ALL_PART4_TESTS_PASSED`)
1. `website-webhook`: Routed test submission strictly to synthetic Company B (`assigned_to = 'unassigned'`, `custom_fields.source = 'website'`), blocked cancelled company (`403`), and passed health `GET` (`simplecrm`).
2. `send-email`: Rejected unauthenticated `POST` (`401`), and blocked Company B JWT from spoofing `company_id` or triggering platform fallback (`400`, zero leak of **saladO**'s Resend credentials).
3. `meta-webhook`: Accepted platform `META_VERIFY_TOKEN` and Company B tenant verify token (`200`), rejected bad verify token (`403`), returned `skipped: "unmapped_page_or_form"` (`200`) for unmapped IDs, rejected forged `X-Hub-Signature-256` (`403`), and processed valid HMAC payload across two mock tenants proving company-scoped `leadgen_id` deduplication without cross-tenant collision.
4. `discovery-autopilot` & Vault Cron: Returned static health JSON on `GET`, rejected unauthenticated `POST` and bad `X-Cron-Secret` (`401`), returned `404` when Company B targeted **saladO**'s `HRMS` pipeline, ingested `+919999900001` into Company B despite pre-existing match in Company C, skipped intra-company duplicate cleanly on re-run, accepted Vault `X-Cron-Secret`, and confirmed `trigger_discovery_autopilot()` `EXECUTE` denied to `anon`/`authenticated` (`false`) and granted to `postgres` (`true`).
5. **saladO Baseline Preserved**: Before and after cleanup counts matched identically (`companies: 1`, `crm_users: 5`, `auth_users: 0`, `leads: 865`, `meta_config: 1`, `email_settings: 1`, `connected_forms: 3`, `pipelines: 4`, `HRMS.last_run_at: 2026-11-10T12:00:24.598Z`, `salado_meta_connected: true`).


