import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  hashPbkdf2,
  jsonResponse,
  sanitizeCrmUser,
  sendSystemResendEmail,
  validatePasswordStrength,
} from "../_shared/authBridge.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm auth-password-update" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "set_password";
    const { adminClient } = createServiceClients();

    const caller = await getAuthenticatedCrmCaller(req, adminClient);
    if (!caller) {
      return jsonResponse({ success: false, error: "Authentication required." }, 401);
    }

    if (action === "set_password") {
      const targetUserId = String(body.userId || caller.crmUser.id);
      const newPassword = String(body.newPassword || "");
      const clearPin = Boolean(body.clearPin);

      const isSelf = targetUserId === caller.crmUser.id;
      const isCompanyAdmin = caller.crmUser.role === "admin";

      if (!isSelf && !isCompanyAdmin) {
        return jsonResponse(
          { success: false, error: "Only administrators can change another user's password." },
          403
        );
      }

      const { data: targetUser, error: targetErr } = await adminClient
        .from("crm_users")
        .select("*")
        .eq("id", targetUserId)
        .maybeSingle();

      if (targetErr || !targetUser || targetUser.company_id !== caller.crmUser.company_id) {
        return jsonResponse({ success: false, error: "User not found in your company." }, 404);
      }

      const strength = validatePasswordStrength(newPassword);
      if (!strength.isValid) {
        return jsonResponse({ success: false, error: strength.message });
      }

      const passwordHash = await hashPbkdf2(newPassword);
      const updatePayload: Record<string, unknown> = {
        password_hash: passwordHash,
        password_updated_at: new Date().toISOString(),
        must_change_password: false,
      };
      if (clearPin) {
        updatePayload.pin = null;
      }

      const { data: updatedUser, error: updateErr } = await adminClient
        .from("crm_users")
        .update(updatePayload)
        .eq("id", targetUserId)
        .eq("company_id", caller.crmUser.company_id)
        .select("*")
        .single();

      if (updateErr || !updatedUser) {
        return jsonResponse({
          success: false,
          error: updateErr?.message || "Failed to update password.",
        });
      }

      return jsonResponse({ success: true, user: sanitizeCrmUser(updatedUser) });
    }

    if (action === "invite_email") {
      if (caller.crmUser.role !== "admin") {
        return jsonResponse(
          { success: false, error: "Only administrators can dispatch team invites." },
          403
        );
      }

      const trimmedEmail = String(body.email || "").trim().toLowerCase();
      const userName = String(body.name || "").trim() || "Team Member";
      const tempPassword = String(body.tempPassword || "");
      const role = body.role === "admin" ? "admin" : "member";
      const loginUrl = String(body.loginUrl || "https://simplecrm.capoasis.com/login");

      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        return jsonResponse({ success: false, emailSent: false, error: "Invalid email address." });
      }

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; color: #0f172a; background: #ffffff;">
          <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 10px; color: #0f172a;">Welcome to the Team, ${userName}!</h2>
          <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px;">
            An account has been created for you on <strong>simplecrm</strong> with <strong>${role === "admin" ? "Administrator" : "Team Member"}</strong> access.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <div style="margin-bottom: 14px;">
              <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; display: block; margin-bottom: 3px;">Work Account ID / Email</span>
              <strong style="font-size: 15px; color: #0f172a;">${trimmedEmail}</strong>
            </div>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; display: block; margin-bottom: 3px;">Temporary Initial Password</span>
              <code style="font-size: 16px; font-weight: 700; color: #2563eb; background: #eff6ff; padding: 4px 8px; border-radius: 4px; display: inline-block;">${tempPassword}</code>
            </div>
          </div>
          <p style="font-size: 12.5px; color: #64748b; line-height: 1.5; margin: 0 0 24px;">
            For your security, you will be prompted to set your own permanent private password upon your first sign in.
          </p>
          <div>
            <a href="${loginUrl}" style="background: #0f172a; color: #ffffff; text-decoration: none; padding: 11px 22px; border-radius: 6px; font-size: 13.5px; font-weight: 500; display: inline-block;">
              Sign In to simplecrm &rarr;
            </a>
          </div>
        </div>
      `;

      const mailRes = await sendSystemResendEmail({
        adminClient,
        companyId: caller.crmUser.company_id,
        to: [trimmedEmail],
        subject: "Welcome to simplecrm - Your Account Details",
        html: htmlBody,
        templateName: "User Invite",
      });

      if (!mailRes.sent) {
        return jsonResponse({
          success: true,
          emailSent: false,
          reason:
            mailRes.reason === "EMAIL_SERVICE_NOT_CONNECTED"
              ? "Email service is not connected in Settings. Please provide the temporary password to the user directly."
              : mailRes.reason || "Failed to dispatch invite email.",
        });
      }

      return jsonResponse({ success: true, emailSent: true });
    }

    return jsonResponse({ success: false, error: `Unsupported action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[auth-password-update] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Failed to process request." },
      500
    );
  }
});

