import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  jsonResponse,
} from "../_shared/authBridge.ts";
import {
  hasBillingAccess,
  updateRazorpaySubscriptionQuantity,
} from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm razorpay-sync-subscription" });
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

    const body = await req.json().catch(() => ({}));
    const targetCompanyId = body.companyId || caller.crmUser.company_id;

    if (!targetCompanyId || targetCompanyId !== caller.crmUser.company_id) {
      const canManage = await hasBillingAccess(adminClient, caller.crmUser);
      if (!canManage) {
        return jsonResponse({ success: false, error: "Access denied." }, 403);
      }
    }

    // 1. Fetch company and active user count
    const [{ data: company, error: compErr }, { count: activeUserCount }] = await Promise.all([
      adminClient
        .from("companies")
        .select("id, name, razorpay_subscription_id, seat_limit, subscription_status")
        .eq("id", targetCompanyId)
        .single(),
      adminClient
        .from("crm_users")
        .select("id", { count: "exact", head: true })
        .eq("company_id", targetCompanyId),
    ]);

    if (compErr || !company) {
      return jsonResponse({ success: false, error: "Company not found." }, 404);
    }

    const currentUsers = Math.max(1, Number(activeUserCount || 1));

    // 2. If an active Razorpay subscription exists, update quantity on Razorpay
    const subId = company.razorpay_subscription_id;
    const keyId = (Deno.env.get("RAZORPAY_KEY_ID") ?? "").trim();
    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim();

    let razorpaySynced = false;
    let rzpError: string | null = null;

    if (subId && keyId && keySecret) {
      const basicAuth = btoa(`${keyId}:${keySecret}`);
      const updateRes = await updateRazorpaySubscriptionQuantity(basicAuth, subId, currentUsers);
      if (updateRes.ok) {
        razorpaySynced = true;
      } else {
        rzpError = updateRes.error || "Failed to update quantity on Razorpay";
        console.warn(`[razorpay-sync-subscription] Warning updating subscription ${subId}:`, rzpError);
      }
    }

    // 3. Update seat_limit on companies table to reflect active users
    await adminClient
      .from("companies")
      .update({
        seat_limit: currentUsers,
        updated_at: new Date().toISOString(),
      })
      .eq("id", company.id);

    return jsonResponse({
      success: true,
      companyId: company.id,
      activeUsers: currentUsers,
      subscriptionId: subId || null,
      razorpaySynced,
      warning: rzpError,
    });
  } catch (err: any) {
    console.error("[razorpay-sync-subscription] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Failed to synchronize seats." },
      500
    );
  }
});

