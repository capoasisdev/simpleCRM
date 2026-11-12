import {
  corsHeaders,
  createServiceClients,
  jsonResponse,
} from "../_shared/authBridge.ts";
import {
  finalizePaidBillingTransaction,
  verifyRazorpayWebhookSignature,
} from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
      },
    });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm razorpay-webhook" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const webhookSecret = (Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "").trim();
    if (!webhookSecret) {
      return jsonResponse({ error: "RAZORPAY_WEBHOOK_SECRET not configured." }, 503);
    }

    const signature = (req.headers.get("x-razorpay-signature") ?? "").trim();
    const rawBody = await req.text();

    const valid = await verifyRazorpayWebhookSignature({
      rawBody,
      signature,
      secret: webhookSecret,
    });

    if (!valid) {
      return jsonResponse({ error: "Invalid Razorpay webhook signature." }, 403);
    }

    const eventPayload = JSON.parse(rawBody || "{}");
    const eventName = String(eventPayload.event || "");
    const paymentEntity = eventPayload.payload?.payment?.entity || null;
    const orderEntity = eventPayload.payload?.order?.entity || null;

    const orderId = String(paymentEntity?.order_id || orderEntity?.id || "").trim();
    const paymentId = paymentEntity?.id ? String(paymentEntity.id).trim() : null;

    const { adminClient } = createServiceClients();

    if (eventName === "payment.captured" || eventName === "order.paid") {
      if (!orderId) {
        return jsonResponse({ received: true, skipped: "missing_order_id" });
      }

      const res = await finalizePaidBillingTransaction(adminClient, {
        orderId,
        paymentId,
        signature,
        verifiedVia: "razorpay_webhook",
        rawEvent: { event: eventName, payment_id: paymentId, order_id: orderId },
      });

      return jsonResponse({
        received: true,
        event: eventName,
        applied: res.ok && !res.alreadyPaid,
        alreadyPaid: Boolean(res.alreadyPaid),
        notFound: Boolean(res.notFound),
      });
    }

    if (eventName === "payment.failed" && orderId) {
      await adminClient
        .from("billing_transactions")
        .update({
          status: "failed",
          razorpay_payment_id: paymentId,
          updated_at: new Date().toISOString(),
          metadata: {
            failure_reason: paymentEntity?.error_description || paymentEntity?.error_code || "payment_failed",
          },
        })
        .eq("razorpay_order_id", orderId)
        .eq("status", "created");

      return jsonResponse({ received: true, event: eventName });
    }

    return jsonResponse({ received: true, skipped: eventName || "unhandled_event" });
  } catch (err: any) {
    console.error("[razorpay-webhook] Unexpected error:", err);
    return jsonResponse({ error: err?.message || "Webhook error." }, 500);
  }
});

