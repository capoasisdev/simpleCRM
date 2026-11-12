import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  isServiceRoleRequest,
  jsonResponse,
} from "../_shared/authBridge.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({
      status: "active",
      service: "simplecrm Resend Email Dispatcher",
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "send").toLowerCase();
    const { adminClient } = createServiceClients();

    const isService = await isServiceRoleRequest(req);
    const caller = isService ? null : await getAuthenticatedCrmCaller(req, adminClient);

    if (!isService && !caller) {
      return jsonResponse({ success: false, error: "Authentication required." }, 401);
    }

    // Authoritative tenant resolution:
    // - End-user JWTs ALWAYS bind strictly to caller.crmUser.company_id.
    // - Internal service_role triggers may specify body.company_id + allow_platform_fallback.
    const companyId: string | null = isService
      ? (body.company_id ? String(body.company_id).trim() : null)
      : String(caller!.crmUser.company_id);

    const allowPlatformFallback = isService && Boolean(body.allow_platform_fallback);

    if (isService && !companyId && !allowPlatformFallback) {
      return jsonResponse(
        { success: false, error: "company_id is required for service invocations." },
        400
      );
    }

    let dbSettings: Record<string, any> | null = null;
    if (companyId) {
      const { data: settingsRow } = await adminClient
        .from("email_settings")
        .select("api_key, from_name, from_email, reply_to, is_connected")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      dbSettings = settingsRow || null;
    }

    // 1. Action: verify API key OR list domains (admin / settings flow)
    if (action === "verify" || action === "domains") {
      const candidateKey =
        (typeof body.api_key === "string" && body.api_key.trim()) ||
        (dbSettings?.api_key ? String(dbSettings.api_key).trim() : "");

      if (!candidateKey || !candidateKey.startsWith("re_")) {
        return jsonResponse(
          { valid: false, domains: [], error: "Missing or invalid Resend API key." },
          400
        );
      }

      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${candidateKey}` },
      });
      const data = await res.json().catch(() => ({}));

      if (action === "domains") {
        return jsonResponse({ domains: data.data || [] });
      }

      if (res.ok) {
        return jsonResponse({ valid: true, domains: data.data || [], isFullAccess: true });
      }
      if (data.name === "restricted_api_key") {
        return jsonResponse({ valid: true, domains: [], isFullAccess: false });
      }
      return jsonResponse({ valid: false, error: data.message || "Invalid Resend API Key" });
    }

    // 2. Action: send email
    let apiKey = "";
    let fromName = typeof body.from_name === "string" ? body.from_name.trim() : "";
    let fromEmail = typeof body.from_email === "string" ? body.from_email.trim() : "";
    let replyTo = typeof body.reply_to === "string" ? body.reply_to.trim() : "";

    const isAdminPreSaveTest =
      Boolean(caller && caller.crmUser.role === "admin") &&
      body.template_name === "Resend Connection Verification Test" &&
      typeof body.api_key === "string" &&
      body.api_key.trim().startsWith("re_");

    if (isService && typeof body.api_key === "string" && body.api_key.trim().startsWith("re_")) {
      apiKey = body.api_key.trim();
      fromName = fromName || dbSettings?.from_name || "simplecrm";
      fromEmail = fromEmail || dbSettings?.from_email || "onboarding@resend.dev";
      replyTo = replyTo || dbSettings?.reply_to || "";
    } else if (isAdminPreSaveTest) {
      apiKey = String(body.api_key).trim();
      fromName = fromName || "simplecrm";
      fromEmail = fromEmail || "onboarding@resend.dev";
    } else if (
      dbSettings?.is_connected !== false &&
      typeof dbSettings?.api_key === "string" &&
      dbSettings.api_key.trim().startsWith("re_")
    ) {
      apiKey = dbSettings.api_key.trim();
      fromName = fromName || dbSettings.from_name || "simplecrm";
      fromEmail = fromEmail || dbSettings.from_email || "onboarding@resend.dev";
      replyTo = replyTo || dbSettings.reply_to || "";
    } else if (allowPlatformFallback) {
      const platformKey = (Deno.env.get("PLATFORM_RESEND_API_KEY") ?? "").trim();
      if (!platformKey || !platformKey.startsWith("re_")) {
        return jsonResponse(
          { success: false, error: "Platform Resend fallback is not configured." },
          500
        );
      }
      apiKey = platformKey;
      fromName = fromName || Deno.env.get("PLATFORM_RESEND_FROM_NAME")?.trim() || "simplecrm";
      fromEmail =
        fromEmail || Deno.env.get("PLATFORM_RESEND_FROM_EMAIL")?.trim() || "noreply@mail.capoasis.com";
      replyTo = replyTo || Deno.env.get("PLATFORM_RESEND_REPLY_TO")?.trim() || "";
    } else {
      return jsonResponse(
        { success: false, error: "Email integration not configured for your company." },
        400
      );
    }

    const rawTo = body.to;
    const toRecipients = (Array.isArray(rawTo) ? rawTo : [rawTo])
      .filter(Boolean)
      .map((e) => String(e).trim());

    if (toRecipients.length === 0) {
      return jsonResponse({ success: false, error: "Missing recipient email ('to')." }, 400);
    }

    const senderHeader =
      typeof body.from === "string" && body.from.trim()
        ? body.from.trim()
        : `${fromName || "simplecrm"} <${fromEmail || "onboarding@resend.dev"}>`;

    console.log(
      `[send-email Edge Function] Dispatching email for company=${companyId || "platform"} to=${toRecipients.join(", ")} from="${senderHeader}"`
    );

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderHeader,
        to: toRecipients,
        reply_to: replyTo || undefined,
        subject: body.subject || "(No Subject)",
        html: body.html || "<p></p>",
      }),
    });

    const resendJson = await resendRes.json().catch(() => null);
    const isSuccess = resendRes.ok;
    const errorMessage = isSuccess
      ? null
      : `[Resend HTTP ${resendRes.status}] ${
          resendJson?.message || resendJson?.error || resendRes.statusText || "Unknown error"
        }`;

    if (companyId) {
      try {
        const isUuid =
          typeof body.lead_id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            body.lead_id
          );
        await adminClient.from("email_logs").insert([
          {
            company_id: companyId,
            lead_id: isUuid ? body.lead_id : null,
            lead_name: body.lead_name || "Lead",
            lead_email: toRecipients[0],
            pipeline_id: body.pipeline_id || null,
            stage_id: body.stage_id || null,
            template_name: body.template_name || "Direct Email",
            subject: body.subject,
            body: body.html,
            status: isSuccess ? "sent" : "failed",
            error_message: errorMessage,
            is_automated: body.is_automated ?? true,
          },
        ]);
      } catch (logErr) {
        console.warn("[send-email Edge Function] Could not log to email_logs:", logErr);
      }
    }

    if (isSuccess) {
      return jsonResponse({ success: true, id: resendJson?.id });
    }
    return jsonResponse({
      success: false,
      error: errorMessage,
      details: resendJson,
    });
  } catch (err: any) {
    console.error("[send-email Edge Function Error]:", err);
    return jsonResponse(
      { success: false, error: err?.message || "Internal server error" },
      500
    );
  }
});
