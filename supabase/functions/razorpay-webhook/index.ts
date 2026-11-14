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
    const subscriptionEntity = eventPayload.payload?.subscription?.entity || null;

    const orderId = String(paymentEntity?.order_id || orderEntity?.id || "").trim();
    const paymentId = paymentEntity?.id ? String(paymentEntity.id).trim() : null;
    const subscriptionId = String(subscriptionEntity?.id || "").trim();

    const { adminClient } = createServiceClients();

    // 1. Subscription recurring charge succeeded (Monthly Autopay debit)
    if (eventName === "subscription.charged") {
      if (!subscriptionId) {
        return jsonResponse({ received: true, skipped: "missing_subscription_id" });
      }

      // Find company by subscription ID or notes
      const companyId = subscriptionEntity?.notes?.company_id;
      let companyQuery = adminClient
        .from("companies")
        .select("id, seat_limit, price_per_seat_inr")
        .eq("razorpay_subscription_id", subscriptionId);

      let { data: company } = await companyQuery.maybeSingle();
      if (!company && companyId) {
        const { data: compById } = await adminClient
          .from("companies")
          .select("id, seat_limit, price_per_seat_inr")
          .eq("id", companyId)
          .maybeSingle();
        company = compById;
      }

      if (!company) {
        return jsonResponse({ received: true, skipped: "company_not_found_for_subscription" });
      }

      const endSeconds = Number(subscriptionEntity.current_end || 0);
      const periodEndIso = endSeconds > 0
        ? new Date(endSeconds * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const newSeats = Math.max(1, Number(subscriptionEntity.quantity || company.seat_limit || 1));
      const amountInr = Number(paymentEntity?.amount || 0) / 100;

      await adminClient
        .from("companies")
        .update({
          subscription_status: "active",
          razorpay_subscription_id: subscriptionId,
          current_period_end: periodEndIso,
          seat_limit: newSeats,
          updated_at: new Date().toISOString(),
        })
        .eq("id", company.id);

      // Record or update transaction in ledger idempotently
      if (paymentId) {
        const { data: existingTxByPayment } = await adminClient
          .from("billing_transactions")
          .select("id")
          .eq("razorpay_payment_id", paymentId)
          .maybeSingle();

        if (!existingTxByPayment) {
          const { data: pendingTx } = await adminClient
            .from("billing_transactions")
            .select("id")
            .eq("razorpay_order_id", subscriptionId)
            .eq("status", "created")
            .maybeSingle();

          if (pendingTx) {
            await adminClient
              .from("billing_transactions")
              .update({
                status: "paid",
                razorpay_payment_id: paymentId,
                updated_at: new Date().toISOString(),
                metadata: {
                  razorpay_subscription_id: subscriptionId,
                  verified_via: "subscription.charged",
                },
              })
              .eq("id", pendingTx.id);
          } else {
            await adminClient.from("billing_transactions").insert([{
              company_id: company.id,
              transaction_type: "renewal",
              seats_delta: newSeats,
              amount_inr: amountInr || (newSeats * Number(company.price_per_seat_inr || 999)),
              unit_price_inr: Number(company.price_per_seat_inr || 999),
              currency: "INR",
              razorpay_order_id: paymentEntity?.order_id || subscriptionId,
              razorpay_payment_id: paymentId,
              status: "paid",
              metadata: {
                razorpay_subscription_id: subscriptionId,
                verified_via: "subscription.charged",
                webhook_event_id: eventPayload.id || null,
              },
            }]);
          }
        }
      }

      return jsonResponse({ received: true, event: eventName, applied: true });
    }

    // 2. Subscription activated / authenticated
    if (eventName === "subscription.activated" || eventName === "subscription.authenticated") {
      if (subscriptionId) {
        const companyId = subscriptionEntity?.notes?.company_id;
        if (companyId) {
          await adminClient
            .from("companies")
            .update({
              subscription_status: "active",
              razorpay_subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", companyId);
        }
      }
      return jsonResponse({ received: true, event: eventName });
    }

    // 3. Subscription halted (autopay debit repeatedly failed)
    if (eventName === "subscription.halted") {
      if (subscriptionId) {
        await adminClient
          .from("companies")
          .update({
            subscription_status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("razorpay_subscription_id", subscriptionId);
      }
      return jsonResponse({ received: true, event: eventName });
    }

    // 4. Subscription cancelled
    if (eventName === "subscription.cancelled") {
      if (subscriptionId) {
        await adminClient
          .from("companies")
          .update({
            subscription_status: "cancelled",
            updated_at: new Date().toISOString(),
          })
          .eq("razorpay_subscription_id", subscriptionId);
      }
      return jsonResponse({ received: true, event: eventName });
    }

    // 5. Standard order / payment verification
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

