import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { constantTimeEqual } from "./authBridge.ts";

export interface CompanyBillingRecord {
  id: string;
  name?: string;
  slug?: string;
  subscription_status?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  seat_limit?: number | null;
  price_per_seat_inr?: number | null;
  is_billing_exempt?: boolean | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
}

export const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function isCompanySubscriptionActive(
  company: CompanyBillingRecord | null | undefined,
  options: { allowPastDue?: boolean } = {}
): boolean {
  if (!company) return false;
  if (company.is_billing_exempt) return true;

  const status = String(company.subscription_status || "").toLowerCase();
  if (status === "active") {
    if (!company.current_period_end) return true;
    const endMs = new Date(company.current_period_end).getTime();
    if (!Number.isFinite(endMs)) return true;
    if (endMs > Date.now()) return true;
    if (options.allowPastDue && endMs + PAST_DUE_GRACE_MS > Date.now()) {
      return true;
    }
    return false;
  }
  if (options.allowPastDue && status === "past_due") return true;

  if (status === "trialing" || status === "pilot_extended") {
    if (!company.trial_ends_at) return false;
    return new Date(company.trial_ends_at).getTime() > Date.now();
  }

  return false;
}

export async function hasBillingAccess(
  adminClient: SupabaseClient,
  crmUser: {
    company_id?: string | null;
    email?: string | null;
    permissions?: Record<string, any> | null;
  } | null | undefined
): Promise<boolean> {
  if (!crmUser) return false;
  if (crmUser.permissions?.admin?.manage_billing === true) {
    return true;
  }
  if (!crmUser.company_id || !crmUser.email) {
    return false;
  }
  const { data: comp } = await adminClient
    .from("companies")
    .select("owner_email")
    .eq("id", crmUser.company_id)
    .maybeSingle();

  if (!comp?.owner_email) return false;
  return comp.owner_email.trim().toLowerCase() === String(crmUser.email).trim().toLowerCase();
}

export async function computeHmacSha256Hex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyRazorpayPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const { orderId, paymentId, signature, secret } = params;
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expectedHex = await computeHmacSha256Hex(`${orderId}|${paymentId}`, secret);
  return constantTimeEqual(expectedHex, signature.trim().toLowerCase());
}

export async function verifyRazorpaySubscriptionSignature(params: {
  subscriptionId: string;
  paymentId: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const { subscriptionId, paymentId, signature, secret } = params;
  if (!subscriptionId || !paymentId || !signature || !secret) return false;
  // Razorpay subscription signature: HMAC_SHA256(payment_id + "|" + subscription_id, secret)
  const expectedHex = await computeHmacSha256Hex(`${paymentId}|${subscriptionId}`, secret);
  return constantTimeEqual(expectedHex, signature.trim().toLowerCase());
}

export async function createOrFetchRazorpayPlan(
  basicAuth: string,
  unitPriceInr: number
): Promise<{ id: string; amount: number } | null> {
  const amountPaise = Math.round(unitPriceInr * 100);
  try {
    const res = await fetch("https://api.razorpay.com/v1/plans", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        period: "monthly",
        interval: 1,
        item: {
          name: `simplecrm Seat Plan (₹${unitPriceInr}/mo)`,
          amount: amountPaise,
          currency: "INR",
          description: "Monthly subscription per active team seat",
        },
        notes: {
          service: "simplecrm",
          unit_price_inr: String(unitPriceInr),
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.id) {
      return { id: data.id, amount: data.item?.amount || amountPaise };
    }
    console.error("[createOrFetchRazorpayPlan] Plan creation error:", data);
    return null;
  } catch (err) {
    console.error("[createOrFetchRazorpayPlan] Network error:", err);
    return null;
  }
}

export async function createRazorpaySubscription(
  basicAuth: string,
  params: {
    planId: string;
    quantity: number;
    companyId: string;
    companyName: string;
    userEmail?: string;
    totalCount?: number;
  }
): Promise<{ id: string; status: string; shortUrl?: string } | null> {
  try {
    const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: params.planId,
        total_count: params.totalCount || 120, // 10 years
        quantity: Math.max(1, params.quantity),
        customer_notify: 1,
        notes: {
          company_id: params.companyId,
          company_name: params.companyName,
          initiated_by: params.userEmail || "",
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.id) {
      return { id: data.id, status: data.status, shortUrl: data.short_url };
    }
    console.error("[createRazorpaySubscription] Error creating subscription:", data);
    return null;
  } catch (err) {
    console.error("[createRazorpaySubscription] Network error:", err);
    return null;
  }
}

export async function createOrFetchRazorpayCustomer(
  basicAuth: string,
  params: { name: string; email: string; contact?: string; companyId?: string }
): Promise<{ id: string; name?: string; email?: string } | null> {
  try {
    const res = await fetch("https://api.razorpay.com/v1/customers", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: params.name || "Workspace Admin",
        email: params.email,
        contact: params.contact || undefined,
        notes: {
          company_id: params.companyId || "",
          source: "simplecrm",
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.id) {
      return { id: data.id, name: data.name, email: data.email };
    }
    // If customer already exists with this email/contact, fetch it
    if (data?.error?.code === "BAD_REQUEST_ERROR" && params.email) {
      const searchRes = await fetch(`https://api.razorpay.com/v1/customers?count=1`, {
        headers: { Authorization: `Basic ${basicAuth}` },
      });
      const searchData = await searchRes.json().catch(() => null);
      if (searchData?.items?.length) {
        const matched = searchData.items.find(
          (c: any) => c.email?.toLowerCase() === params.email.toLowerCase()
        );
        if (matched?.id) return { id: matched.id, name: matched.name, email: matched.email };
      }
    }
    console.error("[createOrFetchRazorpayCustomer] Error:", data);
    return null;
  } catch (err) {
    console.error("[createOrFetchRazorpayCustomer] Network error:", err);
    return null;
  }
}

export async function createVariableMandateOrder(
  basicAuth: string,
  params: {
    amountPaise: number;
    customerId?: string | null;
    companyId: string;
    companyName: string;
    transactionType: string;
    seatsToBill: number;
    unitPriceInr: number;
    receipt: string;
    maxAmountInr?: number;
    initiatedByEmail?: string;
  }
): Promise<{ id: string; amount: number; token?: any } | null> {
  const maxCapPaise = Math.round((params.maxAmountInr || 15000) * 100); // Default ₹15,000 cap
  const tenYearsFromNow = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;

  const payload: Record<string, any> = {
    amount: params.amountPaise,
    currency: "INR",
    receipt: params.receipt,
    notes: {
      company_id: params.companyId,
      company_name: params.companyName,
      transaction_type: params.transactionType,
      seats_delta: String(params.seatsToBill),
      unit_price_inr: String(params.unitPriceInr),
      initiated_by: params.initiatedByEmail || "",
      billing_model: "variable_mandate",
    },
    token: {
      max_amount: Math.max(maxCapPaise, params.amountPaise),
      expire_at: tenYearsFromNow,
      frequency: "as_presented", // allows variable debit per billing cycle
    },
  };

  if (params.customerId) {
    payload.customer_id = params.customerId;
  }

  try {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.id) {
      return { id: data.id, amount: data.amount, token: data.token };
    }
    console.error("[createVariableMandateOrder] Razorpay error:", data);
    return null;
  } catch (err) {
    console.error("[createVariableMandateOrder] Network error:", err);
    return null;
  }
}

export async function fetchRazorpayPaymentToken(
  basicAuth: string,
  paymentId: string
): Promise<{ tokenId: string | null; customerId: string | null; method?: string }> {
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    const data = await res.json().catch(() => null);
    return {
      tokenId: data?.token_id || data?.token || null,
      customerId: data?.customer_id || null,
      method: data?.method || undefined,
    };
  } catch (err) {
    console.error("[fetchRazorpayPaymentToken] Network error:", err);
    return { tokenId: null, customerId: null };
  }
}

export async function updateRazorpaySubscriptionQuantity(
  basicAuth: string,
  subscriptionId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string; subscription?: any }> {
  try {
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quantity: Math.max(1, quantity),
        schedule_change_at: "now", // update immediately
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.id) {
      return { ok: true, subscription: data };
    }
    return { ok: false, error: data?.error?.description || "Could not update subscription quantity" };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error updating subscription" };
  }
}

export async function verifyRazorpayWebhookSignature(params: {
  rawBody: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const { rawBody, signature, secret } = params;
  if (!rawBody || !signature || !secret) return false;
  const expectedHex = await computeHmacSha256Hex(rawBody, secret);
  return constantTimeEqual(expectedHex, signature.trim().toLowerCase());
}

export async function finalizePaidBillingTransaction(
  adminClient: SupabaseClient,
  params: {
    orderId: string;
    paymentId?: string | null;
    signature?: string | null;
    verifiedVia: "checkout_verify" | "razorpay_webhook";
    rawEvent?: Record<string, unknown> | null;
  }
): Promise<{
  ok: boolean;
  notFound?: boolean;
  alreadyPaid?: boolean;
  transaction?: any;
  company?: any;
  error?: string;
}> {
  const { orderId, paymentId, signature, verifiedVia, rawEvent } = params;

  // 1. Idempotency: If this payment ID was already processed (e.g. by concurrent webhook), return success immediately
  if (paymentId) {
    const { data: alreadyByPaymentId } = await adminClient
      .from("billing_transactions")
      .select("*")
      .eq("razorpay_payment_id", paymentId)
      .maybeSingle();

    if (alreadyByPaymentId) {
      const { data: currentCompany } = await adminClient
        .from("companies")
        .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone, razorpay_subscription_id")
        .eq("id", alreadyByPaymentId.company_id)
        .maybeSingle();

      return {
        ok: true,
        alreadyPaid: true,
        transaction: alreadyByPaymentId,
        company: currentCompany || null,
      };
    }
  }

  const { data: existingTx, error: txErr } = await adminClient
    .from("billing_transactions")
    .select("*")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();

  if (txErr) {
    return { ok: false, error: txErr.message };
  }
  if (!existingTx) {
    return { ok: false, notFound: true, error: "Billing order not found." };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const periodEndIso = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Atomically claim the transition -> 'paid' so verify and webhook cannot double-credit seats
  const { data: claimedTx, error: claimErr } = await adminClient
    .from("billing_transactions")
    .update({
      status: "paid",
      razorpay_payment_id: paymentId || existingTx.razorpay_payment_id,
      razorpay_signature: signature || existingTx.razorpay_signature,
      updated_at: nowIso,
      metadata: {
        ...(existingTx.metadata || {}),
        verified_via: verifiedVia,
        verified_at: nowIso,
        ...(rawEvent ? { webhook_event: rawEvent } : {}),
      },
    })
    .eq("id", existingTx.id)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();

  if (claimErr) {
    // If concurrent webhook already claimed the payment ID, treat as fulfilled
    if (/duplicate|23505/i.test(String(claimErr.message || ""))) {
      const { data: currentCompany } = await adminClient
        .from("companies")
        .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone, razorpay_subscription_id")
        .eq("id", existingTx.company_id)
        .maybeSingle();

      return {
        ok: true,
        alreadyPaid: true,
        transaction: existingTx,
        company: currentCompany || null,
      };
    }
    return { ok: false, error: claimErr.message };
  }

  const { data: currentCompany } = await adminClient
    .from("companies")
    .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone, razorpay_subscription_id")
    .eq("id", existingTx.company_id)
    .maybeSingle();

  if (!claimedTx) {
    return {
      ok: true,
      alreadyPaid: true,
      transaction: existingTx,
      company: currentCompany || null,
    };
  }

  if (!currentCompany) {
    return { ok: false, error: "Target company no longer exists." };
  }

  const companyUpdate: Record<string, unknown> = {
    updated_at: nowIso,
  };

  const linkedSubId =
    existingTx.metadata?.razorpay_subscription_id ||
    (String(orderId).startsWith("sub_") ? orderId : null);
  if (linkedSubId) {
    companyUpdate.razorpay_subscription_id = linkedSubId;
  }

  if (claimedTx.transaction_type === "seat_addon") {
    const addedSeats = Math.max(0, Number(claimedTx.seats_delta || 0));
    companyUpdate.seat_limit = Math.max(1, Number(currentCompany.seat_limit || 1) + addedSeats);
    const currentStatus = String(currentCompany.subscription_status || "").toLowerCase();
    if (currentStatus === "active") {
      companyUpdate.subscription_status = "active";
      if (!currentCompany.current_period_start) {
        companyUpdate.current_period_start = nowIso;
      }
      if (
        !currentCompany.current_period_end ||
        new Date(currentCompany.current_period_end).getTime() <= now.getTime()
      ) {
        companyUpdate.current_period_end = periodEndIso;
      }
    } else if (currentStatus === "trialing" || currentStatus === "pilot_extended") {
      companyUpdate.subscription_status = currentStatus;
    } else {
      companyUpdate.subscription_status = "active";
      companyUpdate.current_period_start = nowIso;
      companyUpdate.current_period_end = periodEndIso;
    }
  } else {
    companyUpdate.subscription_status = "active";
    const { count: currentActiveUsers } = await adminClient
      .from("crm_users")
      .select("id", { count: "exact", head: true })
      .eq("company_id", currentCompany.id);
    const purchasedTotal = Math.max(
      1,
      Number(claimedTx.seats_delta || currentActiveUsers || currentCompany.seat_limit || 1)
    );
    companyUpdate.seat_limit = purchasedTotal;
    const baseTimeMs = currentCompany.current_period_end
      ? Math.max(now.getTime(), new Date(currentCompany.current_period_end).getTime())
      : now.getTime();
    companyUpdate.current_period_start = nowIso;
    companyUpdate.current_period_end = new Date(baseTimeMs + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const { data: updatedCompany, error: compErr } = await adminClient
    .from("companies")
    .update(companyUpdate)
    .eq("id", currentCompany.id)
    .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone, razorpay_subscription_id")
    .single();

  if (compErr) {
    return { ok: false, error: compErr.message };
  }

  // Mark any linked trial enrollment as converted
  await adminClient
    .from("trial_enrollments")
    .update({ status: "converted" })
    .eq("provisioned_company_id", currentCompany.id)
    .in("status", ["pending", "provisioned"]);

  return {
    ok: true,
    alreadyPaid: false,
    transaction: claimedTx,
    company: updatedCompany,
  };
}
