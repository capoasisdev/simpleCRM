import {
  corsHeaders,
  createServiceClients,
  jsonResponse,
} from "../_shared/authBridge.ts";
import { provisionCompany } from "../_shared/companyProvisioner.ts";

function sanitizeLoginUrl(rawUrl: unknown): string {
  const defaultUrl = "https://simplecrm.capoasis.com/login";
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return defaultUrl;
  try {
    const parsed = new URL(rawUrl.trim());
    if (
      (parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) &&
      parsed.pathname.startsWith("/login")
    ) {
      return parsed.toString();
    }
  } catch {
    // ignore malformed URL
  }
  return defaultUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm enroll-trial" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const fullName = String(body.name || body.fullName || "").trim();
    const companyName = String(body.companyName || body.company_name || "").trim();
    const workEmail = String(body.workEmail || body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const rawSeats = Number(body.requestedSeats ?? body.seats ?? 5);
    const requestedEnterprise = Boolean(body.requestedEnterprise);
    const requestedSeats = Math.max(
      1,
      Math.min(500, Math.round(Number.isFinite(rawSeats) ? rawSeats : 5))
    );
    const loginUrl = sanitizeLoginUrl(body.loginUrl);

    if (!fullName) {
      return jsonResponse({ success: false, error: "Please enter your name." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
      return jsonResponse({ success: false, error: "Please enter a valid work email address." }, 400);
    }
    if (phone.length < 8) {
      return jsonResponse({ success: false, error: "Please enter a valid phone number." }, 400);
    }

    const { adminClient } = createServiceClients();

    // Enforce globally unique work email across simplecrm
    const { data: existingUser } = await adminClient
      .from("crm_users")
      .select("id")
      .ilike("email", workEmail)
      .limit(1)
      .maybeSingle();

    if (existingUser) {
      return jsonResponse(
        {
          success: false,
          code: "EMAIL_EXISTS",
          error: "An account with this work email already exists. Please sign in instead.",
        },
        409
      );
    }

    // Prevent rapid duplicate submissions for the same email within 10 minutes
    const tenMinsAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentEnrollment } = await adminClient
      .from("trial_enrollments")
      .select("id, status")
      .ilike("work_email", workEmail)
      .gte("created_at", tenMinsAgoIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentEnrollment) {
      return jsonResponse(
        {
          success: false,
          code: "DUPLICATE_RECENT_ENROLLMENT",
          error: "A trial request for this work email was submitted recently. Please check your inbox or try again shortly.",
        },
        429
      );
    }

    const { data: enrollment, error: enrollErr } = await adminClient
      .from("trial_enrollments")
      .insert([{
        full_name: fullName,
        company_name: companyName || null,
        work_email: workEmail,
        phone,
        requested_seats: requestedSeats,
        status: "pending",
        notes: requestedEnterprise ? "Enterprise (25+ seats) inquiry" : null,
      }])
      .select("id, full_name, company_name, work_email, requested_seats, status, created_at")
      .single();

    if (enrollErr || !enrollment) {
      return jsonResponse(
        { success: false, error: enrollErr?.message || "Failed to record trial enrollment." },
        500
      );
    }

    const autoProvision = (Deno.env.get("TRIAL_AUTO_PROVISION") ?? "true").toLowerCase() !== "false";
    if (!autoProvision) {
      return jsonResponse(
        {
          success: true,
          provisioned: false,
          enrollmentId: enrollment.id,
          adminEmail: workEmail,
        },
        201
      );
    }

    const provisionRes = await provisionCompany(adminClient, {
      companyName: companyName || null,
      adminName: fullName,
      adminEmail: workEmail,
      adminPhone: phone,
      requestedSeats,
      trialDays: 14,
      isBillingExempt: false,
      trialEnrollmentId: enrollment.id,
      loginUrl,
      sendWelcomeEmail: true,
    });

    if (!provisionRes.ok) {
      const status = provisionRes.code === "EMAIL_EXISTS" ? 409 : 500;
      return jsonResponse(
        {
          success: false,
          code: provisionRes.code,
          error: provisionRes.error || "Could not provision trial workspace.",
        },
        status
      );
    }

    return jsonResponse(
      {
        success: true,
        provisioned: true,
        enrollmentId: enrollment.id,
        company: provisionRes.company,
        adminEmail: workEmail,
        emailSent: Boolean(provisionRes.emailSent),
        emailReason: provisionRes.emailReason || null,
        // Surface temporary password only as fallback when email dispatch fails
        ...(provisionRes.emailSent ? {} : { tempPassword: provisionRes.tempPassword }),
      },
      201
    );
  } catch (err: any) {
    console.error("[enroll-trial] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Trial enrollment failed." },
      500
    );
  }
});

