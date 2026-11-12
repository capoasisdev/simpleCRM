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

export function isCompanySubscriptionActive(
  company: CompanyBillingRecord | null | undefined,
  options: { allowPastDue?: boolean } = {}
): boolean {
  if (!company) return false;
  if (company.is_billing_exempt) return true;

  const status = String(company.subscription_status || "").toLowerCase();
  if (status === "active") return true;
  if (options.allowPastDue && status === "past_due") return true;

  if (status === "trialing" || status === "pilot_extended") {
    if (!company.trial_ends_at) return false;
    return new Date(company.trial_ends_at).getTime() > Date.now();
  }

  return false;
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
    return { ok: false, error: claimErr.message };
  }

  const { data: currentCompany } = await adminClient
    .from("companies")
    .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone")
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
    const purchasedTotal = Math.max(1, Number(claimedTx.seats_delta || currentCompany.seat_limit || 1));
    companyUpdate.seat_limit = purchasedTotal;
    companyUpdate.current_period_start = nowIso;
    companyUpdate.current_period_end = periodEndIso;
  }

  const { data: updatedCompany, error: compErr } = await adminClient
    .from("companies")
    .update(companyUpdate)
    .eq("id", currentCompany.id)
    .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone")
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
