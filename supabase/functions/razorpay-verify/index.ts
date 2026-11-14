import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  jsonResponse,
} from "../_shared/authBridge.ts";
import {
  finalizePaidBillingTransaction,
  hasBillingAccess,
  verifyRazorpayPaymentSignature,
  verifyRazorpaySubscriptionSignature,
  fetchRazorpayPaymentToken,
} from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm razorpay-verify" });
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
        { success: false, error: "Only workspace billing managers can verify payments." },
        403
      );
    }

    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim();
    if (!keySecret) {
      return jsonResponse(
        {
          success: false,
          code: "RAZORPAY_NOT_CONFIGURED",
          error: "Razorpay secret key is not configured.",
        },
        503
      );
    }

    const body = await req.json().catch(() => ({}));
    const subscriptionId = String(body.razorpay_subscription_id || "").trim();
    const orderId = String(body.razorpay_order_id || subscriptionId || "").trim();
    const paymentId = String(body.razorpay_payment_id || "").trim();
    const signature = String(body.razorpay_signature || "").trim();

    if ((!orderId && !subscriptionId) || !paymentId || !signature) {
      return jsonResponse(
        { success: false, error: "Missing Razorpay payment verification fields." },
        400
      );
    }

    let validSignature = false;
    if (subscriptionId) {
      validSignature = await verifyRazorpaySubscriptionSignature({
        subscriptionId,
        paymentId,
        signature,
        secret: keySecret,
      });
    }
    if (!validSignature && orderId) {
      validSignature = await verifyRazorpayPaymentSignature({
        orderId,
        paymentId,
        signature,
        secret: keySecret,
      });
    }

    if (!validSignature) {
      return jsonResponse(
        { success: false, error: "Invalid Razorpay payment signature." },
        403
      );
    }

    // Bind order lookup strictly to caller's own company
    const effectiveLookupId = orderId || subscriptionId;
    let { data: txCheck } = await adminClient
      .from("billing_transactions")
      .select("id, company_id, razorpay_order_id, metadata")
      .eq("razorpay_order_id", effectiveLookupId)
      .maybeSingle();

    if (!txCheck && subscriptionId) {
      const { data: fallbackTx } = await adminClient
        .from("billing_transactions")
        .select("id, company_id, razorpay_order_id, metadata")
        .eq("metadata->>razorpay_subscription_id", subscriptionId)
        .maybeSingle();
      txCheck = fallbackTx;
    }

    if (!txCheck || txCheck.company_id !== caller.crmUser.company_id) {
      return jsonResponse(
        { success: false, error: "Billing order not found for your workspace." },
        404
      );
    }

    const res = await finalizePaidBillingTransaction(adminClient, {
      orderId: txCheck.razorpay_order_id || effectiveLookupId,
      paymentId,
      signature,
      verifiedVia: "checkout_verify",
    });

    if (!res.ok) {
      return jsonResponse(
        { success: false, error: res.error || "Could not finalize payment." },
        res.notFound ? 404 : 500
      );
    }

    // Capture recurring mandate token for subsequent variable debits
    const keyId = (Deno.env.get("RAZORPAY_KEY_ID") ?? "").trim();
    if (keyId && keySecret && paymentId) {
      const basicAuth = btoa(`${keyId}:${keySecret}`);
      const tokenInfo = await fetchRazorpayPaymentToken(basicAuth, paymentId);
      if (tokenInfo?.tokenId) {
        await adminClient
          .from("companies")
          .update({
            razorpay_subscription_id: tokenInfo.tokenId,
            ...(tokenInfo.customerId ? { razorpay_customer_id: tokenInfo.customerId } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", caller.crmUser.company_id);
      }
    }

    return jsonResponse({
      success: true,
      alreadyPaid: Boolean(res.alreadyPaid),
      company: res.company,
      transaction: res.transaction,
    });
  } catch (err: any) {
    console.error("[razorpay-verify] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Payment verification failed." },
      500
    );
  }
});

