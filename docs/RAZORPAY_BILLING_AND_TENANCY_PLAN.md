# simplecrm: Two-Stage Trial, Multi-Tenancy & Razorpay Billing Plan

> **Status:** Stage 1 (Landing & Pricing 14-day trial UI) active. **Stage 2 is a future architecture reference** pending multi-tenant `company_id` database support.

---

## 1. Go-to-Market Strategy Overview

**simplecrm** uses a high-touch two-stage commercial funnel designed to eliminate early signup friction while capturing real sales conversations:

### Stage 1 — 14-Day Free Trial Enrollment (Current)
1. **No upfront paywall:** Visitors on `LandingView.jsx` and `PricingView.jsx` are invited to enroll for a **14-day free trial with ₹0 upfront cost and no credit card required**.
2. **Qualifying lead capture:** Before activation, visitors submit their name, work email, phone number, and expected seat count (`teamSize`, priced at flat `₹999` per seat/month standard rate or `Enterprise (25+ seats)`).
3. **Founder-led follow-up at Day 14:** Capturing details upfront creates a direct feedback & conversion loop when the trial nears expiration:
   - **Close directly:** Share a payment link or activate their paid plan.
   - **Pilot extension:** Offer a free guided pilot if the team needs extra evaluation time.
   - **Product discovery:** Ask directly why a team is not moving forward, uncovering bugs, onboarding gaps, or missing workflows in **simplecrm**.
   - **Flexible pricing negotiation:** Apply bespoke per-seat pricing if budget is the main objection.

### Stage 2 — Automated Multi-Tenant Paywall & In-App Seat Expansion (Future Concept)
Once **simplecrm** supports isolated company tenants in Supabase:
1. Any company whose 14-day trial ends without a recorded purchase sees an **in-app Razorpay payment gate** on Day 15+.
2. Inside that gate, the company admin confirms or adjusts their seat count and completes Razorpay checkout (`seats × ₹999/month`, or an agreed custom rate).
3. **Permanent seat expansion UI:** Even after a company becomes a paying subscriber, a **"Buy More Seats"** screen remains permanently available inside **simplecrm** so teams can purchase additional seats anytime without manual support intervention.

---

## 2. Database Prerequisite: Multi-Tenant Company Architecture

Currently, `supabase/schema.sql` models a single workspace without company/organization foreign keys (for example, `public.crm_users` has no `company_id`, trial expiry, or billing quota columns). Implementing Stage 2 requires introducing multi-tenancy first.

### 2.1 Proposed `public.companies` Table
```sql
create table if not exists public.companies (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  owner_email text not null,
  owner_phone text,
  -- Trial & Subscription State
  subscription_status text not null default 'trialing',
    -- 'trialing' | 'pilot_extended' | 'active' | 'past_due' | 'expired' | 'cancelled'
  trial_starts_at timestamp with time zone default timezone('utc'::text, now()) not null,
  trial_ends_at timestamp with time zone default (timezone('utc'::text, now()) + interval '14 days') not null,
  -- Seat & Pricing Controls
  trial_seat_limit integer not null default 5,
  purchased_seats integer not null default 0,
  price_per_seat_inr integer not null default 999,
    -- Overridable per company by founder for negotiated/enterprise deals
  -- Razorpay References
  razorpay_customer_id text,
  razorpay_subscription_id text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone
);
```

### 2.2 Proposed `public.billing_transactions` Audit Table
```sql
create table if not exists public.billing_transactions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_type text not null, -- 'trial_conversion' | 'seat_addon' | 'renewal'
  seats_billed integer not null,
  unit_price_inr integer not null,
  amount_paise integer not null,
  currency text not null default 'INR',
  razorpay_order_id text,
  razorpay_payment_id text unique,
  razorpay_signature text,
  status text not null default 'created' -- 'created' | 'verified' | 'failed'
);
```

### 2.3 Scoping Existing Workspace Tables with `company_id`
Add `company_id uuid references public.companies(id) on delete cascade` and update Row-Level Security (RLS) policies on all tenant-owned tables, including:
- `public.crm_users`
- `public.leads` & `public.lead_activities`
- `public.deals` & `public.pipelines`
- `public.follow_ups`
- `public.connected_forms`
- `public.meta_config`, `public.meta_capi_logs`, & `public.lead_routing_config`
- Email, WhatsApp, todo, backup, and support tables

> **Migration Note:** Existing production deployments should backfill a default `companies` row and associate existing records before enforcing `not null` and strict `company_id` RLS policies.

---

## 3. Day-15 Post-Trial Razorpay Paywall Flow

### 3.1 Access Gate Condition
When a user signs into **simplecrm** or loads the workspace:
- Check the user's company record (`subscription_status`, `trial_ends_at`, `current_period_end`).
- **Allowed into workspace:**
  - `subscription_status = 'active'` (and within billing period / valid grace window)
  - `subscription_status in ('trialing', 'pilot_extended')` and `now() <= trial_ends_at`
- **Blocked at Razorpay Paywall Screen:**
  - `subscription_status` is `'expired'` / `'past_due'` / `'cancelled'`, **or** `subscription_status in ('trialing', 'pilot_extended')` and `now() > trial_ends_at`.

### 3.2 Paywall Screen UX
- **Role-aware messaging:**
  - **Company Admin (`role = 'admin'`):** Sees the full **Trial Ended — Activate simplecrm** checkout card displaying trial summary, current active user count, a seat selector slider/input (minimum = active seats or 1), real-time total (`seats × price_per_seat_inr`, defaulting to `₹999/mo`), optional GSTIN/billing name, and a **"Pay with Razorpay"** action button (plus a Sign Out option).
  - **Team Member (`role = 'member'`):** Sees a clean notice that the workspace's 14-day trial has ended and to contact their admin (displaying `companies.owner_email`), plus a Sign Out button.

### 3.3 Razorpay Checkout & Verification Flow
1. Admin selects seat count in the UI and clicks **Pay with Razorpay**.
2. Frontend calls a server endpoint / Supabase Edge Function (`create-razorpay-order` or `create-razorpay-subscription`) passing `company_id` and requested `seats`.
3. **Server computes price authoritatively** using `companies.price_per_seat_inr` from the database (never trusting client-submitted totals) and creates the Razorpay Order/Subscription using `RAZORPAY_KEY_SECRET`.
4. Client opens the Razorpay Checkout modal with the server-returned `order_id` (or `subscription_id`) and public `RAZORPAY_KEY_ID`.
5. On completion:
   - Server verifies Razorpay's `HMAC-SHA256` signature (`order_id + "|" + payment_id`).
   - Razorpay webhook (`payment.captured` / `subscription.activated` / `subscription.charged`) acts as the durable source of truth in case the browser closes early.
6. Database updates atomically inside `public.companies` (`subscription_status = 'active'`, `purchased_seats = seats_billed`, `current_period_start`, `current_period_end`) and unlocks the **simplecrm** workspace immediately.

---

## 4. Permanent In-App "Buy More Seats" Interface

Even after a company is paid and onboarded, seat growth must stay self-serve:

### 4.1 Always-Available Billing & Seats Screen
- Place a **Team Seats & Billing** view inside workspace Settings / Admin Users (visible to `admin` users across `'active'`, `'trialing'`, and `'pilot_extended'` plans).
- Display at a glance:
  - **Current Plan Status:** e.g. `Active Monthly`, `Trial (Day 8 of 14)`, or `Extended Pilot`.
  - **Seat Utilization Bar:** e.g. `14 of 15 seats used` (`active crm_users` vs `purchased_seats`).
  - **Per-Seat Rate:** `₹999 / seat / month` (or negotiated `price_per_seat_inr`).
  - **"Buy More Seats" Module:** Numeric stepper (`+1`, `+5`, etc.), itemized cost summary, and **Pay via Razorpay** button.

### 4.2 Seat Quota Enforcement
- Enforce seat limits in both UI and backend/RPC checks when creating or reactivating users in `public.crm_users`:
  - If `active_users_count >= allowed_seats`: disable creating new users and show an inline prompt linking directly to **"Buy More Seats"** (during paid state) or a founder contact/upgrade prompt (during trial).
- On successful add-on payment verification, increment `companies.purchased_seats += added_seats` immediately so the admin can add the new team members right away.

---

## 5. Pilot & Negotiation Hooks (Supporting Founder Follow-Up)

To support the non-technical sales & pilot process described in Stage 1 without code changes once Stage 2 launches, expose founder/super-admin controls directly on `public.companies`:
- **Extend Free Pilot:** Set `subscription_status = 'pilot_extended'` and push `trial_ends_at` forward (e.g., +7 or +14 days) whenever a team asks for more evaluation time or provides product feedback.
- **Custom Negotiated Pricing:** Adjust `price_per_seat_inr` (e.g., `₹799` for volume deals) so the company's Razorpay paywall and in-app **Buy More Seats** screen automatically calculate checkout using their agreed rate.

---

## 6. Recommended Future Rollout Sequence

1. **Interim (Optional before multi-tenancy):** Add a `public.trial_enrollments` table wired to `PricingView.jsx` so 14-day trial form submissions persist automatically in Supabase and notify the founder.
2. **Multi-tenant schema migration:** Create `public.companies`, add `company_id` across CRM tables, and enforce tenant-scoped auth + RLS.
3. **Razorpay backend integration:** Deploy Edge Functions / API routes for order/subscription creation, signature verification, and webhook handling (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).
4. **In-app billing UI:** Build the Trial Countdown banner, Day-15 Paywall screen, seat quota guard, and permanent **Buy More Seats** screen inside **simplecrm**.

