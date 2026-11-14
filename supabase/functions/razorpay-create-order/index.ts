import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  jsonResponse,
} from "../_shared/authBridge.ts";
import {
  hasBillingAccess,
  isCompanySubscriptionActive,
  createOrFetchRazorpayPlan,
  createRazorpaySubscription,
} from "../_shared/billing.ts";

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
    const canBill = await hasBillingAccess(adminClient, caller.crmUser);
    if (!canBill) {
      return jsonResponse(
        { success: false, error: "Only workspace billing managers can initiate billing checkout." },
        403
      );
    }

    const companyId = caller.crmUser.company_id;
    const body = await req.json().catch(() => ({}));
    const transactionType = String(body.transactionType || "initial_activation");

    if (!["initial_activation", "seat_addon", "renewal"].includes(transactionType)) {
      return jsonResponse({ success: false, error: "Unsupported transactionType." }, 400);
    }

    const hasSeatsInput = body.seatsRequested !== undefined && body.seatsRequested !== null && body.seatsRequested !== "";
    const rawSeats = hasSeatsInput ? Number(body.seatsRequested) : 1;
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
    const activeUserBillCount = Math.max(1, currentUsers);
    const seatsToBill =
      transactionType === "initial_activation" || transactionType === "renewal"
        ? activeUserBillCount
        : seatsRequested;

    if (
      (transactionType === "initial_activation" || transactionType === "renewal") &&
      hasSeatsInput &&
      seatsRequested < activeUserBillCount
    ) {
      return jsonResponse(
        {
          success: false,
          error: `Your workspace currently has ${currentUsers} active team member(s). Billing covers all active users.`,
        },
        400
      );
    }

    // Authoritative price computation from DB row (never trusts client amounts)
    const unitPriceInr = Math.max(1, Number(company.price_per_seat_inr || 999));
    const amountInr = seatsToBill * unitPriceInr;
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
            seatsRequested: seatsToBill,
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

    // Autopay subscription mode for plan activation / renewal
    const preferSubscription =
      transactionType === "initial_activation" ||
      transactionType === "renewal" ||
      body.mode === "subscription";

    let subscriptionData: { id: string; status: string; shortUrl?: string } | null = null;
    let planId: string | null = null;

    if (preferSubscription) {
      const planRes = await createOrFetchRazorpayPlan(basicAuth, unitPriceInr);
      if (planRes?.id) {
        planId = planRes.id;
        subscriptionData = await createRazorpaySubscription(basicAuth, {
          planId: planRes.id,
          quantity: seatsToBill,
          companyId: company.id,
          companyName: company.name,
          userEmail: caller.crmUser.email,
        });
      }
    }

    let orderData: { id: string } | null = null;
    if (!subscriptionData?.id) {
      // Standard one-time order fallback
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
            seats_delta: String(seatsToBill),
            unit_price_inr: String(unitPriceInr),
            initiated_by: caller.crmUser.email,
          },
        }),
      });

      orderData = await orderRes.json().catch(() => null);
      if (!orderRes.ok || !orderData?.id) {
        return jsonResponse(
          {
            success: false,
            error:
              (orderData as any)?.error?.description ||
              (orderData as any)?.error?.reason ||
              "Failed to initialize Razorpay checkout.",
          },
          502
        );
      }
    }

    const effectiveCheckoutId = subscriptionData?.id || orderData?.id || "";
    const isSubscriptionMode = Boolean(subscriptionData?.id);

    const { data: txRow, error: txInsertErr } = await adminClient
      .from("billing_transactions")
      .insert([{
        company_id: company.id,
        transaction_type: transactionType,
        seats_delta: seatsToBill,
        amount_inr: amountInr,
        unit_price_inr: unitPriceInr,
        currency: "INR",
        razorpay_order_id: effectiveCheckoutId,
        status: "created",
        metadata: {
          receipt,
          mode: isSubscriptionMode ? "subscription" : "order",
          razorpay_subscription_id: subscriptionData?.id || null,
          razorpay_plan_id: planId,
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
      orderId: effectiveCheckoutId,
      subscriptionId: subscriptionData?.id || null,
      mode: isSubscriptionMode ? "subscription" : "order",
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
