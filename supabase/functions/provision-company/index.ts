import {
  corsHeaders,
  createServiceClients,
  isCronSecretRequest,
  isServiceRoleRequest,
  jsonResponse,
} from "../_shared/authBridge.ts";
import { provisionCompany } from "../_shared/companyProvisioner.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm provision-company" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    // Strictly restricted to verified service_role or internal CRON_SECRET callers
    if (!(await isServiceRoleRequest(req)) && !isCronSecretRequest(req)) {
      return jsonResponse(
        { success: false, error: "Unauthorized: service_role authorization required." },
        401
      );
    }

    const body = await req.json().catch(() => ({}));
    const { adminClient } = createServiceClients();

    const res = await provisionCompany(adminClient, {
      companyName: body.companyName ?? body.company_name ?? null,
      adminName: body.adminName ?? body.name ?? "",
      adminEmail: body.adminEmail ?? body.email ?? body.workEmail ?? "",
      adminPhone: body.adminPhone ?? body.phone ?? null,
      requestedSeats: body.requestedSeats ?? body.seatLimit ?? body.seat_limit ?? 5,
      trialDays: body.trialDays ?? 14,
      isBillingExempt: Boolean(body.isBillingExempt),
      trialEnrollmentId: body.trialEnrollmentId ?? null,
      loginUrl: body.loginUrl ?? null,
      sendWelcomeEmail: body.sendWelcomeEmail !== false,
    });

    if (!res.ok) {
      const status =
        res.code === "EMAIL_EXISTS" ? 409 : res.code === "INVALID_INPUT" ? 400 : 500;
      return jsonResponse({ success: false, code: res.code, error: res.error }, status);
    }

    return jsonResponse(
      {
        success: true,
        company: res.company,
        adminUser: res.adminUser,
        pipeline: res.pipeline,
        tempPassword: res.tempPassword,
        emailSent: res.emailSent,
        emailReason: res.emailReason || null,
      },
      201
    );
  } catch (err: any) {
    console.error("[provision-company] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Failed to provision company." },
      500
    );
  }
});

