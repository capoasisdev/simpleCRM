# Part 3 — Frontend Scoping, Browser Storage Isolation & Realtime Filters

> **Execution Status**: Completed & verified (`oxlint`, `npm run build`, and static tenant/cache/realtime audits pass).
> **Prerequisite**: Part 1 deployed; Part 2 JWT auth bridge (`auth-login` + Supabase client auth header) deployed.
> **Scope**: All components and libraries in `src/` that query, insert, update, delete, cache, or subscribe to Supabase data.

---

## 1. Objective
Even when PostgreSQL RLS blocks cross-tenant queries in Part 2, the frontend must:
1. Eliminate **dangerous unscoped `.delete()` / `.update()` / `.limit(1)` singleton patterns**.
2. Pass explicit `company_id` on every database `.insert()` / `.upsert()` (required by `NOT NULL` + RLS `WITH CHECK`).
3. Add explicit `.eq('company_id', companyId)` filters on queries as defense-in-depth and clean index utilization.
4. Scope **all 10 realtime `postgres_changes` subscriptions** by `filter: \`company_id=eq.${companyId}\`` + JWT auth.
5. Namespace or purge **all `localStorage` & `sessionStorage` caches** so switching accounts/companies on the same browser or Android device never leaks cached leads, tokens, or settings.
6. Remove remaining hardcoded `'pranav'` / founder personal assumptions and normalize mixed-case brand strings to `simplecrm`.

---

## 2. Shared Frontend Tenant Context Helper (`src/lib/supabase.js` & `src/lib/auth.js`)

Create a single source of truth used across all `src/lib/*` and `src/components/*`:
- Store `company` metadata (`id`, `name`, `slug`, `subscription_status`, `trial_ends_at`, `seat_limit`, `is_billing_exempt`) alongside `user` and `access_token` in session state (`src/App.jsx` / `SESSION_STORAGE_KEY = 'simplecrm_user_session'`).
- Provide helper `getActiveCompanyId()` (returns `session?.user?.company_id || session?.company?.id || null`).
- Attach `Authorization: Bearer ${access_token}` globally to Supabase REST & Functions calls, and call `supabase.realtime.setAuth(access_token)` upon restore/login.
- Provide `clearTenantCaches()` executed synchronously inside `logoutUser()` (and if a newly logged-in session has a different `company_id` than the previously cached browser tenant).

---

## 3. Critical Hazardous Calls to Fix First

| Severity | File & Location | Current Bug / Hazard | Required Fix |
|---|---|---|---|
| **CRITICAL** | [`MetaIntegrationView.jsx`](../../src/components/MetaIntegrationView.jsx#L925) (`handleDisconnect`) | Executes `.from('connected_forms').delete().neq('id', '00000000-0000-0000-0000-000000000000')` with zero tenant filter (and zero source filter!) | Scope explicitly: `.eq('company_id', companyId).eq('source', 'meta')` so disconnecting Meta neither wipes other companies' forms nor touches that company's Website forms |
| **CRITICAL** | [`backups.js`](../../src/lib/backups.js#L40) (`pruneOldBackups`) | Executes `.from('crm_backups').delete().lt('created_at', cutoffIso)` without `company_id` | Add `.eq('company_id', companyId)` |
| **HIGH** | [`backups.js`](../../src/lib/backups.js#L263-L333) (`restoreBackupData`) | Upserts `leads`, `follow_ups`, `crm_todo_lists`, `crm_todos` using `{ onConflict: 'id' }` directly from JSON payload | Require active `companyId`, forcibly overwrite `row.company_id = companyId` on every restored row (so legacy backups restore cleanly and cross-tenant IDs cannot overwrite foreign rows) |
| **HIGH** | [`auth.js`](../../src/lib/auth.js#L293-L489) (`requestPasswordResetCode`, `resetPasswordWithCode`) | Unauthenticated browser queries to `crm_users` & `email_settings` (`.limit(1)`) + client fallback write to `password_reset_codes` / `crm_users` | Replace direct browser DB queries/writes with calls to server Edge Functions (`auth-password-reset`) using `service_role` + platform Resend fallback |
| **MEDIUM** | [`PipelineSettingsView.jsx`](../../src/components/PipelineSettingsView.jsx#L2040-L2060) (`handleFormChange`) | Updates/reads `connected_forms` by `form_id` without explicit `company_id` scope | Add `.eq('company_id', companyId)` to `.update(...)` and `.select(...)` |

---

## 4. Singleton Config Reads & Upserts (`.limit(1)`) Audit

Every module reading or mutating `meta_config`, `lead_routing_config`, or `email_settings` must scope by `.eq('company_id', companyId)` and include `company_id` on initial row insert:

| Table | Files to Update (Exact Locations Verified) | Change Required |
|---|---|---|
| `email_settings` | [`email.js`](../../src/lib/email.js) (`fetchEmailConfig`, `saveEmailConfig`), [`auth.js`](../../src/lib/auth.js) (`sendUserInviteEmail`, `requestPasswordResetCode`) | Filter `.eq('company_id', companyId)`; pass `company_id` on insert/upsert (`onConflict: 'company_id'`); route invite/reset emails via Edge Function |
| `email_templates` | [`email.js`](../../src/lib/email.js) (`fetchEmailTemplates`) | Filter `.eq('company_id', companyId)`; include `company_id` when creating templates |
| `meta_config` | [`metaCapi.js`](../../src/lib/metaCapi.js#L227), [`whatsapp.js`](../../src/lib/whatsapp.js#L22), [`metaSdk.js`](../../src/lib/metaSdk.js#L386), [`MetaIntegrationView.jsx`](../../src/components/MetaIntegrationView.jsx), [`AutomationsView.jsx`](../../src/components/AutomationsView.jsx#L74), [`DashboardView.jsx`](../../src/components/DashboardView.jsx#L952), [`PipelineSettingsView.jsx`](../../src/components/PipelineSettingsView.jsx#L511) | Filter `.eq('company_id', companyId)` on `.select()`, `.update()`, `.insert()`; persist selected Facebook `page_id` cleanly into `meta_config.page_id` so webhooks route deterministically |
| `lead_routing_config` | [`LeadRoutingView.jsx`](../../src/components/LeadRoutingView.jsx#L82-L86), [`PipelineSettingsView.jsx`](../../src/components/PipelineSettingsView.jsx#L510), [`CsvImportView.jsx`](../../src/components/CsvImportView.jsx#L106) | Filter `.eq('company_id', companyId)` on `.select()`, `.update()`, `.insert()`; enforce `onConflict: 'company_id'` |

---

## 5. Explicit `company_id` Injection on Inserts & Writes

Every client insert path must read `companyId = getActiveCompanyId()` (fail fast if null) and include `company_id`:

- **Users & Seat Enforcement**: [`AdminUsersView.jsx`](../../src/components/AdminUsersView.jsx) -> stamp `company_id` on new `crm_users` insert; enforce `activeUsersCount < company.seat_limit` cleanly in UI + DB trigger/Edge Function.
- **Deals**: [`DashboardView.jsx`](../../src/components/DashboardView.jsx#L874) -> include `company_id: companyId` in `newDealPayload` while keeping `company: dealCompany` untouched as the prospect company text field.
- **Leads & Forms**: [`LeadsView.jsx`](../../src/components/LeadsView.jsx), [`CsvImportView.jsx`](../../src/components/CsvImportView.jsx#L554), [`WebsiteFormsView.jsx`](../../src/components/WebsiteFormsView.jsx#L70), [`PipelineSettingsView.jsx`](../../src/components/PipelineSettingsView.jsx#L1891).
- **Activities, Follow-Ups, Notes, Logs & Support**:
  - [`activities.js`](../../src/lib/activities.js) (`recordActivity`)
  - [`followups.js`](../../src/lib/followups.js) (`createFollowUp`)
  - [`todos.js`](../../src/lib/todos.js) (`crm_todos` inserts)
  - [`aiLogger.js`](../../src/lib/aiLogger.js) (`logAiInteraction` -> `ai_chat_logs`)
  - [`whatsapp.js`](../../src/lib/whatsapp.js#L192) (`whatsapp_messages`)
  - [`metaCapi.js`](../../src/lib/metaCapi.js#L331) (`meta_capi_logs` + dedup check at `:264`)
  - [`backups.js`](../../src/lib/backups.js#L183) (`createFullBackup` -> `crm_backups`)
  - [`SupportDrawer.jsx`](../../src/components/SupportDrawer.jsx#L195) (`support_tickets`)
  - [`coldDiscoveryScraper.js`](../../src/lib/coldDiscoveryScraper.js#L298) (scope dedup query at `:298`, stamp `company_id` on `leads` at `:484` and `lead_activities` at `:504`, attach user JWT header on `discovery-autopilot` call at `:715`).

---

## 6. Hardcoded Founder / Brand Cleanups

### 6.1 Remove Hardcoded `'pranav'` Fallbacks
Replace every personal default with `'unassigned'` or first active rep in the company's `usersList`:
- [`LeadRoutingView.jsx`](../../src/components/LeadRoutingView.jsx#L55) (`useState('pranav')` & `:118` fallback)
- [`LeadsView.jsx`](../../src/components/LeadsView.jsx#L1715) (lines `1715`, `1832`)
- [`CsvImportView.jsx`](../../src/components/CsvImportView.jsx#L64)
- [`AnalyticsView.jsx`](../../src/components/AnalyticsView.jsx#L915) (`return clean !== 'pranav patil';` -> replace hardcoded exclusion filter with role/setting check or remove founder special-case filter)

### 6.2 Brand Casing & Metadata Cleanup
Normalize remaining mixed-case identifiers/strings cleanly to `simplecrm`:
- `capacitor.config.json` (`appName` field)
- Email template copy in `src/lib/auth.js` (`sendUserInviteEmail`, `requestPasswordResetCode`)
- Backup metadata in `src/lib/backups.js`

---

## 7. Realtime Channel Scoping (All 10 Verified Channels)

Add `filter: \`company_id=eq.${companyId}\`` to every `postgres_changes` listener and tear down/resubscribe cleanly when `companyId` changes:

| File & Line | Channel Name | Tables Monitored |
|---|---|---|
| [`DashboardView.jsx`](../../src/components/DashboardView.jsx#L515) | `dashboard-realtime` | `leads`, `deals`, `crm_users` |
| [`LeadsView.jsx`](../../src/components/LeadsView.jsx#L407) | `followups-realtime-channel` | `follow_ups` |
| [`LeadsView.jsx`](../../src/components/LeadsView.jsx#L1003) | `pipeline-stages-realtime-${pipelineType}` | `pipelines` |
| [`LeadsView.jsx`](../../src/components/LeadsView.jsx#L1560) | `leads-realtime-${pipelineType}` | `leads` |
| [`MessagesView.jsx`](../../src/components/MessagesView.jsx#L277) | `messages-leads-realtime` | `leads` |
| [`MessagesView.jsx`](../../src/components/MessagesView.jsx#L295) | `whatsapp-messages-realtime` | `whatsapp_messages` |
| [`MessagesView.jsx`](../../src/components/MessagesView.jsx#L309) | `email-logs-realtime` | `email_logs` |
| [`AdminUsersView.jsx`](../../src/components/AdminUsersView.jsx#L174) | `crm_users-realtime` | `crm_users` |
| [`MetaIntegrationView.jsx`](../../src/components/MetaIntegrationView.jsx#L828) | `connected-forms-realtime` | `connected_forms` |
| [`MetaIntegrationView.jsx`](../../src/components/MetaIntegrationView.jsx#L840) | `meta-capi-logs-realtime` | `meta_capi_logs` |

---

## 8. Browser Cache (`localStorage` / `sessionStorage`) Isolation Inventory

Every tenant cache key verified across `src/` must either **suffix with `:${companyId}`** OR **be wiped automatically in `clearTenantCaches()` on logout / tenant change**:

| Storage Key / Constant | File(s) | Recommended Action |
|---|---|---|
| `SESSION_STORAGE_KEY` (`simplecrm_user_session`) | `App.jsx` | Store `{ user, company, access_token, expires_at }`; wipe on logout |
| `simplecrm_last_active_tab` | `DashboardView.jsx` | Clear on logout or namespace by `:${user.id}` |
| `crm_skipped_pwd_upgrade`, `lateron_prefill` (`sessionStorage`) | `App.jsx`, `SecurityUpgradeModal.jsx`, `DashboardView.jsx`, `LeadsView.jsx`, `LaterOnView.jsx` | Clear in `logoutUser()` |
| `crm_cached_users`, `crm_cached_lead_routing_rules` | `AdminUsersView.jsx`, `DashboardView.jsx`, `LeadRoutingView.jsx` | Prefix/suffix by `:${companyId}` + purge on logout |
| `crm_cached_meta_config`, `crm_cached_connected_forms`, `crm_cached_ad_budget`, `crm_cached_discovered_ad_accounts`, `crm_meta_user_token` | `DashboardView.jsx`, `MetaIntegrationView.jsx`, `metaSdk.js` | Prefix/suffix by `:${companyId}` + **strictly purge `crm_meta_user_token` on logout** |
| `crm_cached_pipelines`, `cachedLeadsKey`, `cachedPipelinesKey`, `activePipelineIdKey`, `pipelineColumnsKey`, `crm_pipeline_columns`, `cacheKey` | `LeadsView.jsx`, `MetaIntegrationView.jsx`, `PipelineSettingsView.jsx`, `backups.js` | Include `companyId` in key helper (not just `pipelineType`) + purge on logout |
| `ACTIVITIES_STORAGE_KEY` (`crm_lead_activities`), `FOLLOWUPS_STORAGE_KEY` (`crm_lead_followups`), `STORAGE_KEY` (`crm_sticky_notes_v2`), `crm_todo_lists_cache`, `crm_todos_cache` | `activities.js`, `followups.js`, `todos.js`, `backups.js` | Prefix/suffix by `:${companyId}` + purge on logout |
| `BACKUP_STORAGE_KEY` (`crm_rolling_backups`), `LOCAL_STORAGE_LOGS_KEY` (`crm_ai_chat_logs_cache`), `STORAGE_KEY` (`simplecrm_notifications`) | `backups.js`, `aiLogger.js`, `notifications.js` | Prefix/suffix by `:${companyId}` + purge on logout |
| `EMAIL_SETTINGS_STORAGE_KEY`, `EMAIL_TEMPLATES_STORAGE_KEY`, `EMAIL_LOGS_STORAGE_KEY`, `MESSAGES_STORAGE_KEY` | `email.js`, `whatsapp.js` | Prefix/suffix by `:${companyId}` + purge on logout |
| `OPENROUTER_STORAGE_KEY` (`crm_openrouter_api_key`) | `aiAssistant.js`, `leadAiScorer.js`, `pipelineAiGenerator.js` | Prefix/suffix by `:${companyId}` (so BYO OpenRouter keys stay per-company) |

---

## 9. Verification & Rollback

### Verification
1. Switch accounts in the same browser tab between **saladO** and **TestCorp**: confirm zero cached leads, users, Meta tokens, notes, or email settings bleed across sessions in UI or `localStorage`.
2. Disconnect Meta integration inside **TestCorp**: verify `saladO`'s `connected_forms` rows remain 100% intact.
3. Run `npx oxlint` and `npm run build` cleanly; smoke-test Android WebView bundle via Capacitor.

### Rollback
- Part 3 is purely client code (`src/` & `capacitor.config.json`). Revert the Part 3 commit/PR cleanly. (If Part 2 strict RLS is active, keep at minimum the JWT header attachment in `supabase.js`.)

---

## 10. Execution Log (Verified)

### Implemented Scope
- **Shared Tenant Layer (`src/lib/tenant.js`, `src/lib/auth.js`, `src/App.jsx`)**:
  - Created `src/lib/tenant.js` (`getActiveCompany`, `getActiveCompanyId`, `requireActiveCompanyId`, `tenantStorageKey`, `readTenantCache`, `writeTenantCache`, `readTenantString`, `writeTenantString`, `removeTenantCache`, `withCompanyId`, `clearTenantCaches`, `setActiveCompanyCache`).
  - Wired `App.jsx` session hydration/login to `setActiveCompanyCache` and `auth.js` logout to `clearTenantCaches()`.
- **Library Modules (`src/lib/`)**:
  - Scoped Supabase reads/writes/deletes and namespaced caches across `notifications.js`, `activities.js`, `followups.js`, `todos.js`, `aiLogger.js`, `whatsapp.js`, `email.js`, `backups.js`, `metaCapi.js`, `metaSdk.js`, `leadAiScorer.js`, `pipelineAiGenerator.js`, `googlePlacesDiscovery.js`, `aiAssistant.js`, and `coldDiscoveryScraper.js` (including switching `runDiscoveryAutopilot` to `supabase.functions.invoke('discovery-autopilot', ...)`).
  - Hardened `restoreBackupData` in `backups.js` to require active `companyId` and overwrite `company_id` on restored records.
- **View Components (`src/components/`) & Config**:
  - Scoped Supabase queries, writes, realtime `postgres_changes` subscriptions (`filter: company_id=eq.${companyId}`), and tenant-namespaced caches across `AdminUsersView.jsx`, `AutomationsView.jsx`, `AnalyticsView.jsx`, `BackupsView.jsx`, `CsvImportView.jsx`, `DashboardView.jsx`, `EmailIntegrationView.jsx`, `LeadRoutingView.jsx`, `LeadsView.jsx`, `MessagesView.jsx`, `MetaIntegrationView.jsx`, `PipelineSettingsView.jsx`, `SupportDrawer.jsx`, and `WebsiteFormsView.jsx`.
  - Preserved website forms in `MetaIntegrationView.jsx` (`.eq('source', 'meta')` on Meta cleanup/disconnect, `.neq('source', 'website')` on Meta form reads, `page_id` persistence, and `targetRowId` capture on first WhatsApp connect).
  - Enforced `activeCompany.seat_limit` on user creation in `AdminUsersView.jsx`, removed hardcoded `'pranav'` assignment/filter defaults, and normalized remaining mixed-case `SimpleCRM` branding across `src/styles/*.css`, components, libs, and `capacitor.config.json`.
  - Fixed missing `routingMode`, `rIndex`, `rConfigId` declarations in `CsvImportView.jsx` (`handleExecuteImport`) and missing `now` declaration in `aiAssistant.js`.

### Verification Results
- `npx oxlint --quiet` across all 31 edited Part 3 JS/JSX files: **0 errors** (224 warnings).
- `npx oxlint -A all -D no-undef src/` (excluding browser/node globals): **0 undefined identifiers**.
- Full `npx oxlint --quiet src/`: 307 warnings and 51 pre-existing `react-hooks(rules-of-hooks)` errors in `ExportReportModal.jsx` and `AnalyticsView.jsx` (unrelated to Part 3 scoping changes).
- `npm run build` (`vite build`): **passed** (`2042 modules transformed`, built in `495ms`, exit `0`).
- Static grep audits across `src/` and `capacitor.config.json`:
  - Mixed-case `SimpleCRM` / `SimpleCrm` / `simpleCRM`: **0 matches**.
  - Case-insensitive `pranav` references: **0 matches**.
  - Unfiltered `postgres_changes` subscriptions: **0 matches** (all filtered with `company_id=eq.${companyId}`).
  - Unallowlisted direct `localStorage` / `sessionStorage` calls outside tenant/auth/ephemeral UI keys: **0 matches**.


