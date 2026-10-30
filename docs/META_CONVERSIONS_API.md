# Meta Conversions API (CAPI) for Leads — SaaS CRM Architecture

## Overview
This document specifies the architecture, data models, event dispatching, and security requirements for sending downstream CRM lead conversion events back to Meta via the **Meta Conversions API (CAPI)**.

This enables:
1. **Closing the Loop:** Sending lead qualification stages (`QualifiedLead`, `Schedule`, `Purchase`, etc.) back to Meta.
2. **Meta "Conversion Leads" Optimization:** Unlocking value-based and quality-based bidding in Meta Ads Manager.
3. **Multi-Tenant SaaS Readiness:** Ensuring every tenant workspace has isolated credentials, datasets, pipelines, and audit logs.

---

## 1. Database Schema Specifications

### 1.1 `meta_config` Enhancements
Add columns to support CAPI datasets and toggles:
- `dataset_id` (text): The Meta Dataset ID or Pixel ID for Conversions API.
- `capi_enabled` (boolean, default false): Master toggle for CAPI sync.
- `test_event_code` (text, default ''): Code from Meta Events Manager "Test Events" tab for debugging.
- `capi_access_token` (text, default null): Optional dedicated System User or CAPI access token (falls back to `access_token`).

### 1.2 `meta_capi_logs` Table (Audit Trail & SaaS Telemetry)
Tracks all outgoing conversion events for auditability, client troubleshooting, and rate-limit tracking:
```sql
create table if not exists public.meta_capi_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now() not null,
  lead_id uuid references public.leads(id) on delete set null,
  lead_name text,
  leadgen_id text,
  pipeline_id text,
  stage_id text,
  event_name text not null, -- 'QualifiedLead' | 'Schedule' | 'Purchase' | 'Contact' | etc.
  event_time timestamptz default now() not null,
  event_id text not null, -- Unique UUID for deduplication
  dataset_id text not null,
  status text not null default 'pending', -- 'sent' | 'failed' | 'skipped'
  meta_trace_id text,
  events_received integer default 0,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  is_test boolean default false
);
```

### 1.3 `pipelines.stage_automations` Schema Extension
In `pipelines.stage_automations` JSONB array, each stage can now configure:
```json
{
  "stage_id": "qualified",
  "is_active": false,           // WhatsApp toggle
  "template_name": "",          // WhatsApp template
  "email_active": false,        // Email toggle
  "email_template_id": "",      // Email template
  "meta_capi_active": true,     // Meta CAPI toggle
  "meta_capi_event": "QualifiedLead", // Standard Meta event
  "meta_capi_custom_name": "",  // Optional custom name if event is 'Other'
  "meta_capi_value_field": null // Optional deal/lead value to send (e.g., deal price)
}
```

---

## 2. Standard Meta CAPI Events for Leads

| Meta Standard Event | Recommended CRM Trigger | Meta Optimization Benefit |
| :--- | :--- | :--- |
| **`Lead`** | Initial form submission (already synced via Webhook) | Baseline lead generation |
| **`QualifiedLead`** | Lead moved to "Qualified", "Interested", or "Verified" | Primary signal for "Conversion Leads" bidding |
| **`Schedule`** | Lead scheduled a call, demo, or site visit | High-intent mid-funnel conversion signal |
| **`Contact`** | First outbound call/WhatsApp connected | Engagement verification |
| **`SubmitApplication`** | Lead submitted documentation/KYC/application | High-intent qualification |
| **`Purchase` / `Won`** | Lead won / closed deal (sends `value` & `currency`) | Value-Based Bidding (ROAS optimization) |

---

## 3. PII Normalization & Hashing Rules (SHA-256)

Meta requires all personally identifiable information (PII) to be SHA-256 hashed in hex format before transmission, except `lead_id` which must be sent as raw text/number:

| Field | Key | Normalization Rule | Example Pre-Hash |
| :--- | :--- | :--- | :--- |
| **Lead ID** | `lead_id` | **NO HASHING**; send raw string | `"123456789012345"` |
| **Email** | `em` | Lowercase, trim leading/trailing whitespace | `user@example.com` |
| **Phone** | `ph` | Remove all non-digits, include country code (E.164) | `919876543210` |
| **First Name**| `fn` | Lowercase, trim, remove punctuation | `pranav` |
| **Last Name** | `ln` | Lowercase, trim, remove punctuation | `patil` |
| **City** | `ct` | Lowercase, remove whitespace and punctuation | `mumbai` |

---

## 4. Multi-Tenant SaaS Execution Flow

1. **User Action:** Sales representative moves a Lead to a new stage in Kanban or List view (or API update).
2. **Trigger Evaluation:** `handleUpdateLeadStage` inspects `targetPipe.stage_automations`.
3. **Deduplication Check:** Check `meta_capi_logs` to ensure this event hasn't already been sent for this lead and stage.
4. **Payload Construction:**
   - Hash customer PII via `crypto.subtle.digest('SHA-256')`.
   - Attach Meta `leadgen_id` as `user_data.lead_id`.
   - Set `action_source: "system_generated"`.
   - Attach unique `event_id` UUID for Meta deduplication.
5. **Dispatch:**
   - POST to `https://graph.facebook.com/v20.0/{DATASET_ID}/events?access_token={ACCESS_TOKEN}`.
6. **Logging:** Store execution results in `meta_capi_logs`.
7. **UI Feedback:** Display subtle badge on lead details ("Synced to Meta: QualifiedLead").

---

*Document Created: 2026-10-29*
