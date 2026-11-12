import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  jsonResponse,
} from "../_shared/authBridge.ts";
import {
  finalizePaidBillingTransaction,
  verifyRazorpayPaymentSignature,
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
    if (caller.crmUser.role !== "admin") {
      return jsonResponse(
        { success: false, error: "Only workspace administrators can verify payments." },
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
    const orderId = String(body.razorpay_order_id || "").trim();
    const paymentId = String(body.razorpay_payment_id || "").trim();
    const signature = String(body.razorpay_signature || "").trim();

    if (!orderId || !paymentId || !signature) {
      return jsonResponse(
        { success: false, error: "Missing Razorpay payment verification fields." },
        400
      );
    }

    const validSignature = await verifyRazorpayPaymentSignature({
      orderId,
      paymentId,
      signature,
      secret: keySecret,
    });

    if (!validSignature) {
      return jsonResponse(
        { success: false, error: "Invalid Razorpay payment signature." },
        403
      );
    }

    // Bind order lookup strictly to caller's own company
    const { data: txCheck } = await adminClient
      .from("billing_transactions")
      .select("id, company_id")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();

    if (!txCheck || txCheck.company_id !== caller.crmUser.company_id) {
      return jsonResponse(
        { success: false, error: "Billing order not found for your workspace." },
        404
      );
    }

    const res = await finalizePaidBillingTransaction(adminClient, {
      orderId,
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

