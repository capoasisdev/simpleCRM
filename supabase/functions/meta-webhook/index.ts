import {
  constantTimeEqual,
  corsHeaders,
  createServiceClients,
  jsonResponse,
} from "../_shared/authBridge.ts";
import { isCompanySubscriptionActive } from "../_shared/billing.ts";
import { resolveCompanyLeadAssignee } from "../_shared/leadDistribution.ts";

async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const trimmed = signatureHeader.trim();
  if (!trimmed.toLowerCase().startsWith("sha256=")) return false;
  const providedHex = trimmed.slice(7).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(appSecret.trim()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const bytes = new Uint8Array(sigBuffer);
    let expectedHex = "";
    for (let i = 0; i < bytes.length; i++) {
      expectedHex += bytes[i].toString(16).padStart(2, "0");
    }
    return constantTimeEqual(providedHex, expectedHex);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { adminClient } = createServiceClients();

  // 1. Meta Webhook Verification Challenge (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = (url.searchParams.get("hub.verify_token") ?? "").trim();
    const challenge = url.searchParams.get("hub.challenge") ?? "";

    console.log(`[Meta Webhook] Verification attempt: mode=${mode}, hasToken=${Boolean(token)}`);

    if (mode !== "subscribe") {
      return new Response("Invalid request mode", { status: 400 });
    }

    if (!token) {
      return new Response("Forbidden: Missing verify token", { status: 403 });
    }

    const platformVerifyToken = (Deno.env.get("META_VERIFY_TOKEN") ?? "").trim();
    if (platformVerifyToken && constantTimeEqual(token, platformVerifyToken)) {
      console.log("[Meta Webhook] Verification succeeded via platform verify_token.");
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    try {
      const { data: matchedConfig } = await adminClient
        .from("meta_config")
        .select("id")
        .eq("verify_token", token)
        .limit(1)
        .maybeSingle();

      if (matchedConfig) {
        console.log("[Meta Webhook] Verification succeeded via tenant meta_config.");
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
    } catch (err) {
      console.warn("[Meta Webhook] Failed querying tenant verify_token:", err);
    }

    console.warn("[Meta Webhook] Verification token mismatch.");
    return new Response("Forbidden: Verify token mismatch", { status: 403 });
  }

  // 2. Incoming Webhook Event (POST)
  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return jsonResponse({ error: "Invalid JSON payload." }, 400);
      }

      if (payload.object !== "page") {
        return new Response("Not a page object", { status: 400, headers: corsHeaders });
      }

      const signatureHeader = (req.headers.get("x-hub-signature-256") ?? "").trim();
      const platformAppSecret = (Deno.env.get("META_APP_SECRET") ?? "").trim();
      const platformSignatureValid =
        Boolean(signatureHeader && platformAppSecret) &&
        (await verifyMetaSignature(rawBody, signatureHeader, platformAppSecret));

      const metaConfigCache = new Map<string, Record<string, any> | null>();
      const companyRecordCache = new Map<string, Record<string, any> | null>();
      let processedCount = 0;
      const skippedReasons: string[] = [];

      const getCompanyMetaConfig = async (companyId: string) => {
        if (metaConfigCache.has(companyId)) return metaConfigCache.get(companyId) || null;
        const { data } = await adminClient
          .from("meta_config")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        metaConfigCache.set(companyId, data || null);
        return data || null;
      };

      const getCompanyBillingRecord = async (companyId: string) => {
        if (companyRecordCache.has(companyId)) return companyRecordCache.get(companyId) || null;
        const { data } = await adminClient
          .from("companies")
          .select("id, subscription_status, trial_ends_at, is_billing_exempt")
          .eq("id", companyId)
          .maybeSingle();
        companyRecordCache.set(companyId, data || null);
        return data || null;
      };

      for (const entry of payload.entry || []) {
        const entryPageId = entry?.id ? String(entry.id).trim() : null;

        for (const change of entry.changes || []) {
          if (change?.field !== "leadgen") continue;

          const leadgenId = change.value?.leadgen_id ? String(change.value.leadgen_id).trim() : null;
          const formId = change.value?.form_id ? String(change.value.form_id).trim() : null;
          const changePageId = change.value?.page_id
            ? String(change.value.page_id).trim()
            : entryPageId;

          console.log(
            `[Meta Webhook] Leadgen event: page_id=${changePageId || "none"}, form_id=${formId || "none"}, leadgen_id=${leadgenId || "none"}`
          );

          // Step A: Resolve connected_forms by form_id first
          let connectedForm: Record<string, any> | null = null;
          if (formId) {
            const { data: cForm, error: formLookupErr } = await adminClient
              .from("connected_forms")
              .select("*")
              .eq("form_id", formId)
              .limit(1)
              .maybeSingle();

            if (formLookupErr) {
              console.warn("[Meta Webhook] connected_forms lookup warning:", formLookupErr);
            } else if (cForm) {
              if (cForm.is_active === false) {
                console.log(`[Meta Webhook] Skipping disabled form ${formId}`);
                skippedReasons.push("inactive_form");
                continue;
              }
              connectedForm = cForm;
            }
          }

          let companyId: string | null = connectedForm?.company_id
            ? String(connectedForm.company_id)
            : null;
          let tenantMetaConfig: Record<string, any> | null = null;

          // Step B: Fall back to page_id -> meta_config lookup if form isn't registered yet
          if (!companyId && changePageId) {
            const { data: pageConfig } = await adminClient
              .from("meta_config")
              .select("*")
              .eq("page_id", changePageId)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();

            if (pageConfig?.company_id) {
              companyId = String(pageConfig.company_id);
              tenantMetaConfig = pageConfig;
              metaConfigCache.set(companyId, pageConfig);
            }
          }

          if (!companyId) {
            console.warn("[Meta Webhook] Skipping unmapped page/form:", {
              pageId: changePageId,
              formId,
              leadgenId,
            });
            skippedReasons.push("unmapped_page_or_form");
            continue;
          }

          if (!tenantMetaConfig) {
            tenantMetaConfig = await getCompanyMetaConfig(companyId);
          }

          // Verify X-Hub-Signature-256 whenever header is present
          if (signatureHeader && !platformSignatureValid) {
            const tenantAppSecret = tenantMetaConfig?.app_secret
              ? String(tenantMetaConfig.app_secret).trim()
              : "";
            const tenantSigValid = tenantAppSecret
              ? await verifyMetaSignature(rawBody, signatureHeader, tenantAppSecret)
              : false;
            if (!tenantSigValid) {
              console.warn(`[Meta Webhook] Invalid X-Hub-Signature-256 for company=${companyId}`);
              return jsonResponse({ error: "Invalid webhook signature." }, 403);
            }
          }

          // Check company subscription eligibility
          const billingRecord = await getCompanyBillingRecord(companyId);
          if (!isCompanySubscriptionActive(billingRecord, { allowPastDue: true })) {
            console.warn(
              `[Meta Webhook] Skipping event for company=${companyId} with subscription_status=${billingRecord?.subscription_status}`
            );
            skippedReasons.push("subscription_inactive");
            continue;
          }

          // Company-scoped leadgen_id deduplication
          if (leadgenId) {
            const { data: existingLead } = await adminClient
              .from("leads")
              .select("id")
              .eq("company_id", companyId)
              .eq("leadgen_id", leadgenId)
              .limit(1)
              .maybeSingle();

            if (existingLead) {
              console.log(
                `[Meta Webhook] Duplicate lead retry ignored for company=${companyId}: leadgen_id=${leadgenId}`
              );
              skippedReasons.push("duplicate_leadgen_id");
              continue;
            }
          }

          const effectiveToken =
            (connectedForm?.access_token && String(connectedForm.access_token).trim()) ||
            (tenantMetaConfig?.access_token && String(tenantMetaConfig.access_token).trim()) ||
            "";

          if (!effectiveToken) {
            console.warn(
              `[Meta Webhook] Missing page access_token for company=${companyId} (form_id=${formId})`
            );
            skippedReasons.push("missing_page_access_token");
            continue;
          }

          let leadName = "Meta Lead";
          let leadEmail: string | null = null;
          let leadPhone: string | null = null;
          let leadCity: string | null = null;
          let formName = connectedForm?.form_name || "Instant Form";
          const customFields: Record<string, string> = {};

          if (leadgenId) {
            try {
              const graphUrl = `https://graph.facebook.com/v20.0/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(effectiveToken)}`;
              const leadRes = await fetch(graphUrl);
              const leadData = await leadRes.json();

              if (leadData.error) {
                console.error(
                  `[Meta Webhook CRITICAL] Graph API error for company=${companyId}:`,
                  JSON.stringify(leadData.error)
                );
                if (leadData.error.code === 190 && tenantMetaConfig?.id) {
                  await adminClient
                    .from("meta_config")
                    .update({
                      is_connected: false,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", tenantMetaConfig.id)
                    .eq("company_id", companyId);
                }
                skippedReasons.push("graph_api_error");
                continue;
              }

              if (Array.isArray(leadData.field_data)) {
                let firstName = "";
                let lastName = "";

                for (const field of leadData.field_data) {
                  const rawName = field.name || "";
                  const name = rawName.toLowerCase();
                  const val = field.values?.[0] || "";

                  if (name === "full_name") {
                    leadName = val || leadName;
                  } else if (name === "first_name") {
                    firstName = val || "";
                  } else if (name === "last_name") {
                    lastName = val || "";
                  } else if (name === "email") {
                    leadEmail = val || null;
                  } else if (name === "phone_number" || name === "phone") {
                    leadPhone = val || null;
                  } else if (name === "city") {
                    leadCity = val || null;
                    customFields["City"] = val;
                  } else {
                    const cleanLabel = rawName.replace(/_/g, " ").replace(/\?$/, "?").trim();
                    const formattedLabel = cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1);
                    customFields[formattedLabel] = val;
                  }
                }

                if (leadName === "Meta Lead" && (firstName || lastName)) {
                  leadName = `${firstName} ${lastName}`.trim();
                }
              }

              if (!connectedForm?.form_name && formId) {
                try {
                  const formRes = await fetch(
                    `https://graph.facebook.com/v20.0/${encodeURIComponent(formId)}?fields=name&access_token=${encodeURIComponent(effectiveToken)}`
                  );
                  const formJson = await formRes.json();
                  if (formJson?.name) formName = formJson.name;
                } catch {}
              }
            } catch (graphErr) {
              console.error("[Meta Webhook] Graph API fetch exception:", graphErr);
              skippedReasons.push("graph_api_exception");
              continue;
            }
          }

          if (!connectedForm?.pipeline_id) {
            console.warn(
              `[Meta Webhook] Form "${formName}" (ID: ${formId}, company=${companyId}) is not linked to any pipeline.`
            );
            skippedReasons.push("unmapped_pipeline");
            continue;
          }

          const targetPipelineId = connectedForm.pipeline_id;
          const entryStage = connectedForm.entry_stage_id || "new";

          const { data: targetPipe } = await adminClient
            .from("pipelines")
            .select("id, stages, stage_automations")
            .eq("id", targetPipelineId)
            .eq("company_id", companyId)
            .limit(1)
            .maybeSingle();

          if (!targetPipe) {
            console.warn(
              `[Meta Webhook] Pipeline ${targetPipelineId} not found for company=${companyId}`
            );
            skippedReasons.push("unmapped_pipeline");
            continue;
          }

          const assignedTo = await resolveCompanyLeadAssignee({
            adminClient,
            companyId,
            connectedForm,
            pipelineId: targetPipelineId,
            logPrefix: "[Meta Webhook]",
          });

          const now = new Date();
          const today = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

          const { data: insertedLead, error: insertError } = await adminClient
            .from("leads")
            .insert({
              company_id: companyId,
              name: leadName,
              phone: leadPhone,
              email: leadEmail,
              city: leadCity,
              form_id: formId || null,
              form_name: formName,
              pipeline_id: targetPipelineId,
              stage: entryStage,
              assigned_to: assignedTo,
              leadgen_id: leadgenId || null,
              custom_fields: customFields,
              date: today,
            })
            .select()
            .maybeSingle();

          if (insertError) {
            console.error("[Meta Webhook] Failed to insert lead:", insertError);
            continue;
          }

          processedCount++;
          console.log(
            `[Meta Webhook] Saved lead ${insertedLead?.id} for company=${companyId} -> Pipeline ${targetPipelineId} (Stage: ${entryStage}, Assigned: ${assignedTo})`
          );

          // Stage Automations (scoped strictly to companyId)
          if (insertedLead?.id && Array.isArray(targetPipe.stage_automations)) {
            try {
              const auto = targetPipe.stage_automations.find(
                (a: any) => a.stage_id === entryStage
              );
              const stageObj = (targetPipe.stages || []).find((s: any) => s.id === entryStage);
              const stageName = stageObj?.label || entryStage;

              // 1. Automated Email Dispatch (tenant Resend credentials only)
              if (auto?.email_active && auto.email_template_id && leadEmail) {
                try {
                  const { data: emailSettings } = await adminClient
                    .from("email_settings")
                    .select("api_key, from_name, from_email, reply_to, is_connected")
                    .eq("company_id", companyId)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  const { data: template } = await adminClient
                    .from("email_templates")
                    .select("id, name, subject, body_html")
                    .eq("id", auto.email_template_id)
                    .eq("company_id", companyId)
                    .limit(1)
                    .maybeSingle();

                  if (emailSettings?.is_connected !== false && emailSettings?.api_key && template) {
                    let finalSubject = template.subject || "Welcome";
                    let finalHtml = template.body_html || "";

                    const mergeVars: Record<string, string> = {
                      "{{name}}": leadName || "",
                      "{{company}}": customFields["Company"] || leadCity || "",
                      "{{phone}}": leadPhone || "",
                      "{{stage}}": stageName,
                    };

                    for (const [k, v] of Object.entries(mergeVars)) {
                      finalSubject = finalSubject.replaceAll(k, v);
                      finalHtml = finalHtml.replaceAll(k, v);
                    }

                    const senderFrom = `${emailSettings.from_name || "simplecrm"} <${emailSettings.from_email || "onboarding@resend.dev"}>`;
                    const resendRes = await fetch("https://api.resend.com/emails", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${emailSettings.api_key.trim()}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        from: senderFrom,
                        to: [leadEmail.trim()],
                        reply_to: emailSettings.reply_to?.trim() || undefined,
                        subject: finalSubject,
                        html: finalHtml,
                      }),
                    });

                    const resendJson = await resendRes.json().catch(() => ({}));
                    const emailStatus = resendRes.ok ? "sent" : "failed";

                    await adminClient.from("email_logs").insert({
                      company_id: companyId,
                      lead_id: insertedLead.id,
                      lead_name: leadName,
                      lead_email: leadEmail,
                      pipeline_id: targetPipe.id,
                      stage_id: entryStage,
                      template_name: template.name,
                      subject: finalSubject,
                      body: finalHtml,
                      status: emailStatus,
                      error_message: resendRes.ok ? null : resendJson?.message || "Resend error",
                      is_automated: true,
                    });

                    await adminClient.from("lead_activities").insert({
                      company_id: companyId,
                      lead_id: insertedLead.id,
                      lead_name: leadName,
                      type: "email_sent",
                      to_stage: entryStage,
                      details: `Automated Email "${template.name}" sent to ${leadEmail} on entering stage "${stageName}"`,
                      user_name: "Automation",
                    });
                  }
                } catch (emailErr: any) {
                  console.error(
                    "[Meta Webhook] Automated email error:",
                    emailErr?.message || emailErr
                  );
                }
              }

              // 2. Automated WhatsApp Dispatch (strictly using tenantMetaConfig)
              if (auto?.is_active && auto.template_name && leadPhone) {
                try {
                  const waToken = tenantMetaConfig?.whatsapp_access_token?.trim();
                  const waPhoneId = tenantMetaConfig?.whatsapp_phone_number_id?.trim();

                  if (waToken && waPhoneId) {
                    let cleanPhone = leadPhone.replace(/[^0-9]/g, "");
                    if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;

                    let langCode = "en_US";
                    if (Array.isArray(tenantMetaConfig?.whatsapp_templates)) {
                      const tmpl = tenantMetaConfig.whatsapp_templates.find(
                        (t: any) => t.name === auto.template_name
                      );
                      if (tmpl?.language) langCode = tmpl.language;
                    } else if (auto.language_code) {
                      langCode = auto.language_code;
                    }

                    const templatePayload: any = {
                      name: auto.template_name,
                      language: { code: langCode },
                    };

                    if (auto.template_name !== "hello_world") {
                      templatePayload.components = [
                        {
                          type: "body",
                          parameters: [{ type: "text", text: leadName || "there" }],
                        },
                      ];
                    }

                    const waRes = await fetch(
                      `https://graph.facebook.com/v21.0/${waPhoneId}/messages`,
                      {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${waToken}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          messaging_product: "whatsapp",
                          to: cleanPhone,
                          type: "template",
                          template: templatePayload,
                        }),
                      }
                    );

                    const waJson = await waRes.json().catch(() => ({}));
                    if (waRes.ok) {
                      await adminClient.from("lead_activities").insert({
                        company_id: companyId,
                        lead_id: insertedLead.id,
                        lead_name: leadName,
                        type: "whatsapp_sent",
                        to_stage: entryStage,
                        details: `Automated WhatsApp "${auto.template_name}" sent to ${cleanPhone} on entering stage "${stageName}"`,
                        user_name: "Automation",
                      });
                    } else {
                      const errMsg =
                        waJson?.error?.message || `WhatsApp API error (${waRes.status})`;
                      await adminClient.from("lead_activities").insert({
                        company_id: companyId,
                        lead_id: insertedLead.id,
                        lead_name: leadName,
                        type: "whatsapp_failed",
                        to_stage: entryStage,
                        details: `Automated WhatsApp "${auto.template_name}" failed: ${errMsg}`,
                        user_name: "Automation",
                      });
                    }
                  }
                } catch (waErr: any) {
                  console.error(
                    "[Meta Webhook] Automated WhatsApp error:",
                    waErr?.message || waErr
                  );
                }
              }
            } catch (autoErr: any) {
              console.error(
                "[Meta Webhook] Stage automations error:",
                autoErr?.message || autoErr
              );
            }
          }
        }
      }

      if (
        processedCount === 0 &&
        skippedReasons.length > 0 &&
        skippedReasons.every((r) => r === "unmapped_page_or_form")
      ) {
        return jsonResponse({
          status: "EVENT_RECEIVED",
          skipped: "unmapped_page_or_form",
          processed: 0,
        });
      }

      return jsonResponse({
        status: "EVENT_RECEIVED",
        processed: processedCount,
        ...(skippedReasons.length > 0 ? { skipped_reasons: skippedReasons } : {}),
      });
    } catch (err: any) {
      console.error("[Meta Webhook] Processing error:", err);
      return jsonResponse({ error: err?.message || "Internal server error" }, 500);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
});
