import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "active", service: "SimpleCRM Resend Email Dispatcher" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "send";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY") ??
      "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch email_settings from DB if not fully provided in request
    let apiKey = body.api_key;
    let fromName = body.from_name;
    let fromEmail = body.from_email;
    let replyTo = body.reply_to;

    const { data: dbSettings } = await supabase
      .from("email_settings")
      .select("api_key, from_name, from_email, reply_to, is_connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!apiKey) {
      apiKey = dbSettings?.api_key;
    }
    if (!fromName) {
      fromName = dbSettings?.from_name || "SimpleCRM";
    }
    if (!fromEmail) {
      fromEmail = dbSettings?.from_email || "onboarding@resend.dev";
    }
    if (!replyTo && dbSettings?.reply_to) {
      replyTo = dbSettings.reply_to;
    }

    if (!apiKey || !apiKey.trim().startsWith("re_")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid Resend API key." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Action: verify API key
    if (action === "verify") {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey.trim()}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return new Response(
          JSON.stringify({ valid: true, domains: data.data || [], isFullAccess: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (data.name === "restricted_api_key") {
        return new Response(
          JSON.stringify({ valid: true, domains: [], isFullAccess: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ valid: false, error: data.message || "Invalid Resend API Key" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Action: list domains
    if (action === "domains") {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey.trim()}` }
      });
      const data = await res.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ domains: data.data || [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Action: send email
    const rawTo = body.to;
    const toRecipients = (Array.isArray(rawTo) ? rawTo : [rawTo]).filter(Boolean).map(e => String(e).trim());
    if (toRecipients.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing recipient email ('to')." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const senderHeader = body.from || `${fromName} <${fromEmail}>`;

    console.log(`[send-email Edge Function] Dispatching email to ${toRecipients.join(", ")} from "${senderHeader}"...`);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: senderHeader,
        to: toRecipients,
        reply_to: replyTo ? replyTo.trim() : undefined,
        subject: body.subject || "(No Subject)",
        html: body.html || "<p></p>"
      })
    });

    const resendJson = await resendRes.json().catch(() => null);

    const isSuccess = resendRes.ok;
    const errorMessage = isSuccess
      ? null
      : `[Resend HTTP ${resendRes.status}] ${resendJson?.message || resendJson?.error || resendRes.statusText || "Unknown error"}`;

    // Persist log to email_logs in Supabase
    try {
      const isUuid = body.lead_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.lead_id);
      await supabase.from("email_logs").insert([{
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
        is_automated: body.is_automated ?? true
      }]);
    } catch (logErr) {
      console.warn("[send-email Edge Function] Could not log to email_logs:", logErr);
    }

    if (isSuccess) {
      console.log(`[send-email Edge Function] Dispatched successfully! ID: ${resendJson?.id}`);
      return new Response(
        JSON.stringify({ success: true, id: resendJson?.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.error(`[send-email Edge Function] Failed:`, errorMessage);
      return new Response(
        JSON.stringify({ success: false, error: errorMessage, details: resendJson }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    console.error("[send-email Edge Function Error]:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

