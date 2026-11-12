import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  jsonResponse,
} from "../_shared/authBridge.ts";
import { isCompanySubscriptionActive } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    const keyId = (Deno.env.get("RAZORPAY_KEY_ID") ?? "").trim();
    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim();
    return jsonResponse({
      status: "active",
      service: "simplecrm razorpay-create-order",
      configured: Boolean(keyId && keySecret),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const { adminClient } = createServiceClients();
    const caller = await getAuthenticatedCrmCaller(req, adminClient);
    if (!caller) {
      return jsonResponse({ success: false, error: "Authentication required." }, 401);
    }
    if (caller.crmUser.role !== "admin") {
      return jsonResponse(
        { success: false, error: "Only workspace administrators can initiate billing checkout." },
        403
      );
    }

    const companyId = caller.crmUser.company_id;
    const body = await req.json().catch(() => ({}));
    const transactionType = String(body.transactionType || "initial_activation");

    if (!["initial_activation", "seat_addon", "renewal"].includes(transactionType)) {
      return jsonResponse({ success: false, error: "Unsupported transactionType." }, 400);
    }

    const rawSeats = Number(body.seatsRequested);
    const seatsRequested = Math.round(rawSeats);
    if (!Number.isFinite(rawSeats) || seatsRequested < 1 || seatsRequested > 500) {
      return jsonResponse(
        { success: false, error: "seatsRequested must be between 1 and 500." },
        400
      );
    }

    const [{ data: company, error: compErr }, { count: activeUserCount }] = await Promise.all([
      adminClient
        .from("companies")
        .select("id, name, slug, seat_limit, price_per_seat_inr, is_billing_exempt, subscription_status, trial_ends_at, owner_email")
        .eq("id", companyId)
        .single(),
      adminClient
        .from("crm_users")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
    ]);

    if (compErr || !company) {
      return jsonResponse({ success: false, error: "Company workspace not found." }, 404);
    }

    if (company.is_billing_exempt) {
      return jsonResponse(
        { success: false, error: "This workspace is billing-exempt and does not require checkout." },
        400
      );
    }

    if (transactionType === "seat_addon" && !isCompanySubscriptionActive(company)) {
      return jsonResponse(
        {
          success: false,
          error: "Please activate your monthly plan for all active seats before adding extra seats.",
        },
        400
      );
    }

    const currentUsers = Number(activeUserCount || 0);
    if (
      (transactionType === "initial_activation" || transactionType === "renewal") &&
      seatsRequested < Math.max(1, currentUsers)
    ) {
      return jsonResponse(
        {
          success: false,
          error: `Your workspace currently has ${currentUsers} active team member(s). Please select at least ${currentUsers} seat(s).`,
        },
        400
      );
    }

    // Authoritative price computation from DB row (never trusts client amounts)
    const unitPriceInr = Math.max(1, Number(company.price_per_seat_inr || 999));
    const amountInr = seatsRequested * unitPriceInr;
    const amountPaise = Math.round(amountInr * 100);

    const keyId = (Deno.env.get("RAZORPAY_KEY_ID") ?? "").trim();
    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim();

    if (!keyId || !keySecret) {
      return jsonResponse(
        {
          success: false,
          code: "RAZORPAY_NOT_CONFIGURED",
          error:
            "Online Razorpay checkout keys are not configured yet. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Supabase Secrets to enable payments.",
          summary: {
            transactionType,
            seatsRequested,
            unitPriceInr,
            amountInr,
            currency: "INR",
          },
        },
        503
      );
    }

    const receipt = `scrm_${company.id.slice(0, 8)}_${Date.now()}`.slice(0, 40);
    const basicAuth = btoa(`${keyId}:${keySecret}`);
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: {
          company_id: company.id,
          company_name: company.name,
          transaction_type: transactionType,
          seats_delta: String(seatsRequested),
          unit_price_inr: String(unitPriceInr),
          initiated_by: caller.crmUser.email,
        },
      }),
    });

    const orderData = await orderRes.json().catch(() => null);
    if (!orderRes.ok || !orderData?.id) {
      return jsonResponse(
        {
          success: false,
          error:
            orderData?.error?.description ||
            orderData?.error?.reason ||
            "Failed to create Razorpay payment order.",
        },
        502
      );
    }

    const { data: txRow, error: txInsertErr } = await adminClient
      .from("billing_transactions")
      .insert([{
        company_id: company.id,
        transaction_type: transactionType,
        seats_delta: seatsRequested,
        amount_inr: amountInr,
        unit_price_inr: unitPriceInr,
        currency: "INR",
        razorpay_order_id: orderData.id,
        status: "created",
        metadata: {
          receipt,
          initiated_by_user_id: caller.crmUser.id,
          initiated_by_email: caller.crmUser.email,
          billing_gstin: body.gstin ? String(body.gstin).trim().slice(0, 20) : null,
          billing_name: body.billingName ? String(body.billingName).trim().slice(0, 120) : null,
        },
      }])
      .select("id, razorpay_order_id, amount_inr, seats_delta, transaction_type, status")
      .single();

    if (txInsertErr || !txRow) {
      return jsonResponse(
        { success: false, error: txInsertErr?.message || "Could not record billing order." },
        500
      );
    }

    return jsonResponse({
      success: true,
      keyId,
      orderId: orderData.id,
      amountPaise,
      amountInr,
      unitPriceInr,
      currency: "INR",
      transactionId: txRow.id,
      companyName: company.name,
      prefill: {
        name: caller.crmUser.name || company.name,
        email: caller.crmUser.email || company.owner_email || "",
      },
    });
  } catch (err: any) {
    console.error("[razorpay-create-order] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Failed to initialize checkout." },
      500
    );
  }
});
