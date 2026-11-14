import {
  corsHeaders,
  createServiceClients,
  ensureAuthUserAndMintSession,
  getAuthenticatedCrmCaller,
  jsonResponse,
  sanitizeCrmUser,
  verifyPbkdf2,
} from "../_shared/authBridge.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm auth-login" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "login";
    const { adminClient, anonClient } = createServiceClients();

    // Action 1: Validate an existing Bearer JWT and refresh user + company profile
    if (action === "session_profile") {
      const caller = await getAuthenticatedCrmCaller(req, adminClient);
      if (!caller) {
        return jsonResponse({ success: false, error: "INVALID_SESSION" }, 401);
      }

      const { data: company } = await adminClient
        .from("companies")
        .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, razorpay_subscription_id, razorpay_customer_id")
        .eq("id", caller.crmUser.company_id)
        .maybeSingle();

      // Keep auth.users app_metadata synchronized if admin changed user's role
      const currentMetaRole = caller.authUser.app_metadata?.app_role;
      if (currentMetaRole !== caller.crmUser.role) {
        await adminClient.auth.admin.updateUserById(caller.authUser.id, {
          app_metadata: {
            company_id: caller.crmUser.company_id,
            crm_user_id: caller.crmUser.id,
            app_role: caller.crmUser.role,
          },
        });
      }

      return jsonResponse({
        success: true,
        user: sanitizeCrmUser(caller.crmUser),
        company: company || null,
      });
    }

    // Action 2: Email + Password or Legacy 4-digit PIN authentication
    const trimmedEmail = String(body.email || "").trim().toLowerCase();
    const trimmedSecret = String(body.secret || "").trim();

    if (!trimmedEmail || !trimmedSecret) {
      return jsonResponse({
        success: false,
        error: "Please enter both your work account and password or PIN.",
      });
    }

    const { data: user, error: userErr } = await adminClient
      .from("crm_users")
      .select("*")
      .ilike("email", trimmedEmail)
      .maybeSingle();

    if (userErr) {
      console.error("[auth-login] Database query error:", userErr);
      return jsonResponse({
        success: false,
        error: "Database connection error. Please try again.",
      });
    }

    if (!user) {
      return jsonResponse({
        success: false,
        error: "Account not found. Please contact your administrator.",
      });
    }

    let isLegacyPin = false;
    let needsPasswordSetup = false;

    if (user.password_hash) {
      const isValid = await verifyPbkdf2(trimmedSecret, user.password_hash);
      if (!isValid) {
        if (user.pin && String(user.pin).trim() === trimmedSecret) {
          return jsonResponse({
            success: false,
            error: "Your account has been upgraded to a password. Please enter your new password instead of your old PIN.",
          });
        }
        return jsonResponse({
          success: false,
          error: "Incorrect password. Please verify and try again.",
        });
      }
      needsPasswordSetup = Boolean(user.must_change_password);
    } else if (user.pin && String(user.pin).trim() === trimmedSecret) {
      isLegacyPin = true;
      needsPasswordSetup = true;
    } else {
      return jsonResponse({
        success: false,
        error: "Incorrect password or 4-digit PIN.",
      });
    }

    const { data: company } = await adminClient
      .from("companies")
      .select("id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, razorpay_subscription_id, razorpay_customer_id")
      .eq("id", user.company_id)
      .maybeSingle();

    const skipSession = body.mint_session === false;
    const session = skipSession
      ? null
      : await ensureAuthUserAndMintSession(adminClient, anonClient, user);

    return jsonResponse({
      success: true,
      user: sanitizeCrmUser(user),
      company: company || null,
      session: session
        ? {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: session.expires_at,
          }
        : null,
      isLegacyPin,
      needsPasswordSetup,
    });
  } catch (err: any) {
    console.error("[auth-login] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Authentication failed. Please try again." },
      500
    );
  }
});

