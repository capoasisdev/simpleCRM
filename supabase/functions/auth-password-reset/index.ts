import {
  corsHeaders,
  createServiceClients,
  hashPbkdf2,
  jsonResponse,
  sendSystemResendEmail,
  validatePasswordStrength,
} from "../_shared/authBridge.ts";

function generateSecureOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "active", service: "simplecrm auth-password-reset" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "request";
    const trimmedEmail = String(body.email || "").trim().toLowerCase();
    const { adminClient } = createServiceClients();

    if (action === "request") {
      if (!trimmedEmail) {
        return jsonResponse({ success: false, error: "Please enter your work account email." });
      }

      const { data: user, error: userErr } = await adminClient
        .from("crm_users")
        .select("id, company_id, name, email")
        .ilike("email", trimmedEmail)
        .maybeSingle();

      if (userErr || !user) {
        return jsonResponse({
          success: false,
          error: "No account found matching this email address.",
        });
      }

      const resetCode = generateSecureOtp();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Invalidate any prior unused reset codes for this user/email
      await adminClient
        .from("password_reset_codes")
        .update({ used: true })
        .eq("email", user.email.toLowerCase())
        .eq("used", false);

      const { error: codeInsertErr } = await adminClient.from("password_reset_codes").insert([{
        company_id: user.company_id,
        email: user.email.toLowerCase(),
        code: resetCode,
        expires_at: expiresAt,
        used: false,
      }]);

      if (codeInsertErr) {
        console.error("[auth-password-reset] Failed storing OTP:", codeInsertErr);
        return jsonResponse({
          success: false,
          error: "Failed to generate reset code. Please try again.",
        });
      }

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px; color: #0f172a; background: #ffffff;">
          <h2 style="font-size: 19px; font-weight: 600; margin: 0 0 10px; color: #0f172a;">Password Reset Request</h2>
          <p style="font-size: 13.5px; color: #475569; line-height: 1.5; margin: 0 0 20px;">
            Hi ${user.name || "there"}, we received a request to reset your password for <strong>simplecrm</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; text-align: center; margin: 20px 0;">
            <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; font-weight: 600; display: block; margin-bottom: 8px;">Your 6-Digit Verification Code</span>
            <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px; font-weight: 700; letter-spacing: 0.2em; color: #0f172a;">${resetCode}</span>
          </div>
          <p style="font-size: 12.5px; color: #64748b; line-height: 1.5; margin: 0;">
            This code is valid for <strong>15 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
          </p>
        </div>
      `;

      const mailRes = await sendSystemResendEmail({
        adminClient,
        companyId: user.company_id,
        to: [user.email.toLowerCase()],
        subject: `Your simplecrm Password Reset Code: ${resetCode}`,
        html: htmlBody,
        templateName: "Password Reset OTP",
      });

      if (!mailRes.sent) {
        if (mailRes.reason === "EMAIL_SERVICE_NOT_CONNECTED") {
          // Only look up an admin within THIS user's company (never leak another company's admin)
          const { data: companyAdmins } = await adminClient
            .from("crm_users")
            .select("name, email")
            .eq("company_id", user.company_id)
            .eq("role", "admin")
            .limit(1);

          return jsonResponse({
            success: false,
            error: "EMAIL_SERVICE_NOT_CONNECTED",
            adminContact: companyAdmins?.[0] || { name: "CRM Administrator", email: "" },
          });
        }

        return jsonResponse({
          success: false,
          error: mailRes.reason || "Failed to dispatch email. Please try again.",
        });
      }

      return jsonResponse({ success: true, emailSent: true });
    }

    if (action === "verify") {
      const trimmedCode = String(body.code || "").trim().replace(/\D/g, "");
      const newPassword = String(body.newPassword || "");

      if (!trimmedEmail || !trimmedCode) {
        return jsonResponse({ success: false, error: "Please enter your email and 6-digit code." });
      }

      const strength = validatePasswordStrength(newPassword);
      if (!strength.isValid) {
        return jsonResponse({ success: false, error: strength.message });
      }

      const { data: codeRecords, error: codeErr } = await adminClient
        .from("password_reset_codes")
        .select("*")
        .ilike("email", trimmedEmail)
        .eq("code", trimmedCode)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      if (codeErr || !codeRecords || codeRecords.length === 0) {
        return jsonResponse({
          success: false,
          error: "Invalid or expired 6-digit code. Please request a new code.",
        });
      }

      const validRecord = codeRecords[0];
      const passwordHash = await hashPbkdf2(newPassword);

      await adminClient
        .from("password_reset_codes")
        .update({ used: true })
        .eq("id", validRecord.id);

      const { error: userUpdateErr } = await adminClient
        .from("crm_users")
        .update({
          password_hash: passwordHash,
          password_updated_at: new Date().toISOString(),
          must_change_password: false,
        })
        .ilike("email", trimmedEmail);

      if (userUpdateErr) {
        console.error("[auth-password-reset] Failed updating password:", userUpdateErr);
        return jsonResponse({
          success: false,
          error: "Failed to update password. Please try again.",
        });
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: `Unsupported action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[auth-password-reset] Unexpected error:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Unexpected error processing reset request." },
      500
    );
  }
});

