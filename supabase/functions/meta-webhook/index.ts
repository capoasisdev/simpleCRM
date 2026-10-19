import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 1. Meta Webhook Verification (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    console.log(`[Meta Webhook] Verification attempt: mode=${mode}, token=${token}`);

    if (mode === "subscribe") {
      // Fetch expected verify_token from meta_config table
      let expectedToken: string | null = null;
      try {
        const { data } = await supabase
          .from("meta_config")
          .select("verify_token")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (data?.verify_token) {
          expectedToken = data.verify_token;
        }
      } catch (err) {
        console.warn("[Meta Webhook] Could not fetch verify_token from DB:", err);
      }

      // If token matches DB token, or matches fallback, or if no token configured yet
      if (!expectedToken || token === expectedToken) {
        console.log("[Meta Webhook] Verification succeeded. Returning challenge.");
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      console.warn(`[Meta Webhook] Token mismatch. Expected: ${expectedToken}, Got: ${token}`);
      return new Response("Forbidden: Verify token mismatch", { status: 403 });
    }

    return new Response("Invalid request mode", { status: 400 });
  }

  // 2. Incoming Webhook Event (POST)
  if (req.method === "POST") {
    try {
      const payload = await req.json();
      console.log("[Meta Webhook] Received event payload:", JSON.stringify(payload));

      if (payload.object === "page") {
        // Fetch current meta_config to get access_token and id
        const { data: config } = await supabase
          .from("meta_config")
          .select("id, access_token")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const accessToken = config?.access_token || "";

        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === "leadgen") {
              const leadgenId = change.value?.leadgen_id;
              const formId = change.value?.form_id;
              console.log(`[Meta Webhook] New lead event: leadgen_id=${leadgenId}, form_id=${formId}`);

              // Deduplication check: if lead with this leadgen_id already exists, skip
              if (leadgenId) {
                try {
                  const { data: existingLead } = await supabase
                    .from("leads")
                    .select("id")
                    .eq("leadgen_id", String(leadgenId))
                    .limit(1)
                    .maybeSingle();

                  if (existingLead) {
                    console.log(`[Meta Webhook] Duplicate lead retry ignored: leadgen_id ${leadgenId} is already saved as lead ${existingLead.id}`);
                    continue;
                  }
                } catch (checkErr) {
                  console.warn("[Meta Webhook] Deduplication lookup error:", checkErr);
                }
              }

              // 0. Lookup dedicated Connected Form configuration
              let connectedForm: any = null;
              if (formId) {
                try {
                  const { data: cForm } = await supabase
                    .from("connected_forms")
                    .select("*")
                    .eq("form_id", String(formId))
                    .eq("is_active", true)
                    .limit(1)
                    .maybeSingle();

                  if (cForm) {
                    connectedForm = cForm;
                    console.log(`[Meta Webhook] Matched connected form: "${cForm.form_name}" (Pipeline: ${cForm.pipeline_id || 'default'}, Mode: ${cForm.allocation_mode})`);
                  }
                } catch (formLookupErr) {
                  console.warn("[Meta Webhook] Failed to lookup connected form:", formLookupErr);
                }
              }

              // Determine token to use (form-specific or global fallback)
              const effectiveToken = connectedForm?.access_token || accessToken;

              let leadName = "Meta Lead";
              let leadEmail = null;
              let leadPhone = null;
              let leadCity = null;
              let formName = connectedForm?.form_name || "Instant Form";
              const customFields: Record<string, string> = {};

              if (leadgenId && effectiveToken) {
                try {
                  const graphUrl = `https://graph.facebook.com/v20.0/${leadgenId}?access_token=${effectiveToken}`;
                  const leadRes = await fetch(graphUrl);
                  const leadData = await leadRes.json();

                  console.log("[Meta Webhook] Graph API Lead response:", JSON.stringify(leadData));

                  if (leadData.error) {
                    console.error("[Meta Webhook CRITICAL] Meta Graph API returned error:", JSON.stringify(leadData.error));
                    if (leadData.error.code === 190) {
                      try {
                        await supabase
                          .from("meta_config")
                          .update({
                            is_connected: false,
                            updated_at: new Date().toISOString()
                          })
                          .eq("id", config?.id);
                      } catch (confErr) {
                        console.warn("[Meta Webhook] Could not update meta_config status:", confErr);
                      }
                    }
                    console.warn(`[Meta Webhook] Aborting lead insertion for leadgen_id=${leadgenId} due to Graph API authentication failure.`);
                    continue;
                  }

                  if (leadData.field_data) {
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
                        // Custom form question: prettify key if it's snake_case
                        const cleanLabel = rawName
                          .replace(/_/g, " ")
                          .replace(/\?$/, "?")
                          .trim();
                        const formattedLabel = cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1);
                        customFields[formattedLabel] = val;
                      }
                    }

                    if (leadName === "Meta Lead" && (firstName || lastName)) {
                      leadName = `${firstName} ${lastName}`.trim();
                    }
                  }

                  // If form name not set by connected form, optionally fetch from Graph API
                  if (!connectedForm?.form_name && formId) {
                    try {
                      const formRes = await fetch(`https://graph.facebook.com/v20.0/${formId}?fields=name&access_token=${effectiveToken}`);
                      const formJson = await formRes.json();
                      if (formJson?.name) formName = formJson.name;
                    } catch {}
                  }
                } catch (graphErr) {
                  console.error("[Meta Webhook] Failed to fetch lead details from Graph API:", graphErr);
                }
              }

              // 1. Check if Form is linked to a Pipeline
              if (!connectedForm?.pipeline_id) {
                console.warn(`[Meta Webhook] Form "${formName}" (ID: ${formId}) is not linked to any pipeline. Skipping lead insertion.`);
                continue;
              }

              const targetPipelineId = connectedForm.pipeline_id;
              let entryStage = connectedForm.entry_stage_id || "new";

              // 2. Resolve Assignee
              let assignedTo = "pranav";
              const allocationMode = connectedForm?.allocation_mode || "inherit_global";

              if (allocationMode === "specific_user") {
                assignedTo = connectedForm.assigned_to || "pranav";
              } else if (allocationMode === "unassigned") {
                assignedTo = "unassigned";
              } else if (allocationMode === "round_robin" && Array.isArray(connectedForm.user_rules) && connectedForm.user_rules.length > 0) {
                const activeRules = connectedForm.user_rules.filter((r: any) => r.enabled !== false);
                if (activeRules.length > 0) {
                  const currentIndex = (connectedForm.round_robin_index || 0) % activeRules.length;
                  const selected = activeRules[currentIndex];
                  assignedTo = selected.name || selected.email || "pranav";

                  // Increment form's own round robin index
                  const nextIndex = (connectedForm.round_robin_index || 0) + 1;
                  try {
                    await supabase
                      .from("connected_forms")
                      .update({ round_robin_index: nextIndex, updated_at: new Date().toISOString() })
                      .eq("id", connectedForm.id);
                  } catch (idxErr) {
                    console.warn("[Meta Webhook] Failed to update form round_robin_index:", idxErr);
                  }
                }
              } else if (allocationMode === "weighted" && Array.isArray(connectedForm.user_rules) && connectedForm.user_rules.length > 0) {
                const weightedEligible = connectedForm.user_rules.filter((r: any) => r.enabled !== false && Number(r.weight) > 0);
                const sumWeight = weightedEligible.reduce((acc: number, r: any) => acc + Number(r.weight), 0);

                if (weightedEligible.length > 0 && sumWeight > 0) {
                  const rand = Math.random() * sumWeight;
                  let running = 0;
                  let chosen = weightedEligible[0];
                  for (const r of weightedEligible) {
                    running += Number(r.weight);
                    if (rand <= running) {
                      chosen = r;
                      break;
                    }
                  }
                  assignedTo = chosen.name || chosen.email || "pranav";
                }
              } else {
                // Check if the mapped pipeline has its own lead_distribution
                let resolvedFromPipeline = false;
                if (targetPipelineId) {
                  try {
                    const { data: pipeData } = await supabase
                      .from("pipelines")
                      .select("lead_distribution")
                      .eq("id", targetPipelineId)
                      .maybeSingle();

                    if (pipeData?.lead_distribution && typeof pipeData.lead_distribution === "object") {
                      const pDist = pipeData.lead_distribution as any;
                      const mode = pDist.mode || "round_robin";
                      const defaultAssignee = pDist.default_assignee || "pranav";
                      const rules = (pDist.user_rules || []) as Array<{
                        id: string;
                        name: string;
                        email: string;
                        enabled: boolean;
                        weight: number;
                      }>;
                      const activeRules = rules.filter((r) => r.enabled !== false);

                      if (mode === "unassigned") {
                        assignedTo = "unassigned";
                        resolvedFromPipeline = true;
                      } else if (mode === "single") {
                        assignedTo = defaultAssignee;
                        resolvedFromPipeline = true;
                      } else if (mode === "round_robin") {
                        if (activeRules.length > 0) {
                          const currentIndex = (pDist.round_robin_index || 0) % activeRules.length;
                          const selected = activeRules[currentIndex];
                          assignedTo = selected.name || selected.email || defaultAssignee;

                          const nextIndex = (pDist.round_robin_index || 0) + 1;
                          await supabase
                            .from("pipelines")
                            .update({
                              lead_distribution: { ...pDist, round_robin_index: nextIndex },
                              updated_at: new Date().toISOString()
                            })
                            .eq("id", targetPipelineId);
                        } else {
                          assignedTo = defaultAssignee;
                        }
                        resolvedFromPipeline = true;
                      } else if (mode === "weighted") {
                        const weightedEligible = activeRules.filter((r) => Number(r.weight) > 0);
                        const sumWeight = weightedEligible.reduce((acc, r) => acc + Number(r.weight), 0);

                        if (weightedEligible.length > 0 && sumWeight > 0) {
                          const rand = Math.random() * sumWeight;
                          let running = 0;
                          let chosen = weightedEligible[0];
                          for (const r of weightedEligible) {
                            running += Number(r.weight);
                            if (rand <= running) {
                              chosen = r;
                              break;
                            }
                          }
                          assignedTo = chosen.name || chosen.email || defaultAssignee;
                        } else {
                          assignedTo = defaultAssignee;
                        }
                        resolvedFromPipeline = true;
                      }
                    }
                  } catch (pErr) {
                    console.warn("[Meta Webhook] Failed to resolve pipeline lead_distribution:", pErr);
                  }
                }

                if (!resolvedFromPipeline) {
                  // Fallback to Global Lead Routing Config
                  try {
                    const { data: routingConfig } = await supabase
                      .from("lead_routing_config")
                      .select("*")
                      .order("created_at", { ascending: true })
                      .limit(1)
                      .maybeSingle();

                    if (routingConfig) {
                      const mode = routingConfig.mode || "round_robin";
                      const defaultAssignee = routingConfig.default_assignee || "pranav";
                      const rules = (routingConfig.user_rules || []) as Array<{
                        id: string;
                        name: string;
                        email: string;
                        enabled: boolean;
                        weight: number;
                      }>;

                      const activeRules = rules.filter((r) => r.enabled !== false);

                      if (mode === "unassigned") {
                        assignedTo = "unassigned";
                      } else if (mode === "single") {
                        assignedTo = defaultAssignee;
                      } else if (mode === "round_robin") {
                        if (activeRules.length > 0) {
                          const currentIndex = (routingConfig.round_robin_index || 0) % activeRules.length;
                          const selected = activeRules[currentIndex];
                          assignedTo = selected.name || selected.email || defaultAssignee;

                          // Increment round robin index
                          const nextIndex = (routingConfig.round_robin_index || 0) + 1;
                          await supabase
                            .from("lead_routing_config")
                            .update({ round_robin_index: nextIndex, updated_at: new Date().toISOString() })
                            .eq("id", routingConfig.id);
                        } else {
                          assignedTo = defaultAssignee;
                        }
                      } else if (mode === "weighted") {
                        const weightedEligible = activeRules.filter((r) => Number(r.weight) > 0);
                        const sumWeight = weightedEligible.reduce((acc, r) => acc + Number(r.weight), 0);

                        if (weightedEligible.length > 0 && sumWeight > 0) {
                          const rand = Math.random() * sumWeight;
                          let running = 0;
                          let chosen = weightedEligible[0];
                          for (const r of weightedEligible) {
                            running += Number(r.weight);
                            if (rand <= running) {
                              chosen = r;
                              break;
                            }
                          }
                          assignedTo = chosen.name || chosen.email || defaultAssignee;
                        } else {
                          assignedTo = defaultAssignee;
                        }
                      }
                    }
                  } catch (routingErr) {
                    console.warn("[Meta Webhook] Failed to resolve global lead routing config, using default:", routingErr);
                  }
                }
              }

              // Insert into leads table
              const now = new Date();
              const today = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
              const { data: insertedLead, error: insertError } = await supabase.from("leads").insert({
                name: leadName,
                phone: leadPhone,
                email: leadEmail,
                city: leadCity,
                form_id: formId || null,
                form_name: formName,
                pipeline_id: targetPipelineId,
                stage: entryStage,
                assigned_to: assignedTo,
                leadgen_id: leadgenId ? String(leadgenId) : null,
                custom_fields: customFields,
                date: today,
              }).select().maybeSingle();

              if (insertError) {
                console.error("[Meta Webhook] Failed to insert lead into Supabase:", insertError);
              } else {
                console.log(`[Meta Webhook] Successfully saved lead: ${leadName} (ID: ${insertedLead?.id}) -> Pipeline: ${targetPipelineId || 'default'} (Stage: ${entryStage}, Assigned to: ${assignedTo}) with ${Object.keys(customFields).length} form fields`);

                // Check and dispatch Stage Automations (Email & WhatsApp)
                if (insertedLead?.id) {
                  try {
                    let targetPipe: any = null;
                    if (targetPipelineId) {
                      const { data: pipeData } = await supabase
                        .from("pipelines")
                        .select("id, stages, stage_automations")
                        .eq("id", targetPipelineId)
                        .limit(1)
                        .maybeSingle();
                      targetPipe = pipeData;
                    }
                    if (!targetPipe) {
                      const { data: defaultPipe } = await supabase
                        .from("pipelines")
                        .select("id, stages, stage_automations")
                        .eq("is_default", true)
                        .limit(1)
                        .maybeSingle();
                      targetPipe = defaultPipe;
                    }

                    if (targetPipe && Array.isArray(targetPipe.stage_automations)) {
                      const auto = targetPipe.stage_automations.find((a: any) => a.stage_id === entryStage);
                      const stageObj = (targetPipe.stages || []).find((s: any) => s.id === entryStage);
                      const stageName = stageObj?.label || entryStage;

                      // 1. Automated Email Dispatch (Resend)
                      if (auto?.email_active && auto.email_template_id && leadEmail) {
                        try {
                          const { data: emailSettings } = await supabase
                            .from("email_settings")
                            .select("api_key, from_name, from_email, reply_to")
                            .order("created_at", { ascending: false })
                            .limit(1)
                            .maybeSingle();

                          const { data: template } = await supabase
                            .from("email_templates")
                            .select("id, name, subject, body_html")
                            .eq("id", auto.email_template_id)
                            .limit(1)
                            .maybeSingle();

                          if (emailSettings?.api_key && template) {
                            let finalSubject = template.subject || 'Welcome';
                            let finalHtml = template.body_html || '';

                            const mergeVars: Record<string, string> = {
                              '{{name}}': leadName || '',
                              '{{company}}': customFields['Company'] || leadCity || '',
                              '{{phone}}': leadPhone || '',
                              '{{stage}}': stageName
                            };

                            for (const [k, v] of Object.entries(mergeVars)) {
                              finalSubject = finalSubject.replaceAll(k, v);
                              finalHtml = finalHtml.replaceAll(k, v);
                            }

                            const senderFrom = `${emailSettings.from_name || 'SaladO india'} <${emailSettings.from_email || 'noreply@mail.capoasis.com'}>`;
                            console.log(`[Meta Webhook] Dispatching automated email to ${leadEmail} using template "${template.name}" via Resend...`);

                            const resendRes = await fetch("https://api.resend.com/emails", {
                              method: "POST",
                              headers: {
                                "Authorization": `Bearer ${emailSettings.api_key.trim()}`,
                                "Content-Type": "application/json"
                              },
                              body: JSON.stringify({
                                from: senderFrom,
                                to: [leadEmail.trim()],
                                reply_to: emailSettings.reply_to?.trim() || undefined,
                                subject: finalSubject,
                                html: finalHtml
                              })
                            });

                            const resendJson = await resendRes.json();
                            const emailStatus = resendRes.ok ? 'sent' : 'failed';
                            console.log(`[Meta Webhook] Resend response (${resendRes.status}):`, JSON.stringify(resendJson));

                            // Record in email_logs
                            await supabase.from("email_logs").insert({
                              lead_id: insertedLead.id,
                              lead_name: leadName,
                              lead_email: leadEmail,
                              pipeline_id: targetPipe.id,
                              stage_id: entryStage,
                              template_name: template.name,
                              subject: finalSubject,
                              body: finalHtml,
                              status: emailStatus,
                              error_message: resendRes.ok ? null : (resendJson?.message || 'Resend error'),
                              is_automated: true
                            });

                            // Record in lead_activities
                            await supabase.from("lead_activities").insert({
                              lead_id: insertedLead.id,
                              lead_name: leadName,
                              type: 'email_sent',
                              to_stage: entryStage,
                              details: `Automated Email "${template.name}" sent to ${leadEmail} on entering stage "${stageName}"`,
                              user_name: 'Automation'
                            });
                          } else {
                            console.warn("[Meta Webhook] Missing Resend API key or template not found for automation:", {
                              hasKey: Boolean(emailSettings?.api_key),
                              templateId: auto.email_template_id
                            });
                          }
                        } catch (emailErr: any) {
                          console.error("[Meta Webhook] Failed to dispatch automated email:", emailErr?.message || emailErr);
                        }
                      }

                      // 2. Automated WhatsApp Dispatch
                      if (auto?.is_active && auto.template_name && leadPhone) {
                        try {
                          const { data: metaConfig } = await supabase
                            .from("meta_config")
                            .select("whatsapp_access_token, whatsapp_phone_number_id, whatsapp_templates")
                            .order("created_at", { ascending: true })
                            .limit(1)
                            .maybeSingle();

                          const waToken = metaConfig?.whatsapp_access_token?.trim();
                          const waPhoneId = metaConfig?.whatsapp_phone_number_id?.trim();

                          if (waToken && waPhoneId) {
                            let cleanPhone = leadPhone.replace(/[^0-9]/g, '');
                            if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

                            // Dynamically resolve template language from approved templates list
                            let langCode = "en_US";
                            if (Array.isArray(metaConfig?.whatsapp_templates)) {
                              const tmpl = metaConfig.whatsapp_templates.find((t: any) => t.name === auto.template_name);
                              if (tmpl?.language) {
                                langCode = tmpl.language;
                              }
                            } else if (auto.language_code) {
                              langCode = auto.language_code;
                            }

                            console.log(`[Meta Webhook] Dispatching automated WhatsApp to ${cleanPhone} (template: "${auto.template_name}", lang: "${langCode}")...`);

                            const templatePayload: any = {
                              name: auto.template_name,
                              language: { code: langCode }
                            };

                            // Add parameter variables for templates that support body text (like {{1}} for contact name)
                            if (auto.template_name !== "hello_world") {
                              templatePayload.components = [
                                {
                                  type: "body",
                                  parameters: [
                                    { type: "text", text: leadName || "there" }
                                  ]
                                }
                              ];
                            }

                            const waRes = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
                              method: "POST",
                              headers: {
                                "Authorization": `Bearer ${waToken}`,
                                "Content-Type": "application/json"
                              },
                              body: JSON.stringify({
                                messaging_product: "whatsapp",
                                to: cleanPhone,
                                type: "template",
                                template: templatePayload
                              })
                            });

                            const waJson = await waRes.json();
                            console.log(`[Meta Webhook] WhatsApp response (${waRes.status}):`, JSON.stringify(waJson));

                            if (waRes.ok) {
                              await supabase.from("lead_activities").insert({
                                lead_id: insertedLead.id,
                                lead_name: leadName,
                                type: 'whatsapp_sent',
                                to_stage: entryStage,
                                details: `Automated WhatsApp "${auto.template_name}" sent to ${cleanPhone} on entering stage "${stageName}"`,
                                user_name: 'Automation'
                              });
                            } else {
                              const errMsg = waJson?.error?.message || `WhatsApp API error (${waRes.status})`;
                              console.warn(`[Meta Webhook] WhatsApp delivery not completed: ${errMsg}`);
                              await supabase.from("lead_activities").insert({
                                lead_id: insertedLead.id,
                                lead_name: leadName,
                                type: 'whatsapp_failed',
                                to_stage: entryStage,
                                details: `Automated WhatsApp "${auto.template_name}" failed: ${errMsg}`,
                                user_name: 'Automation'
                              });
                            }
                          } else {
                            console.warn("[Meta Webhook] WhatsApp automation skipped: Missing whatsapp_phone_number_id or whatsapp_access_token in meta_config.");
                          }
                        } catch (waErr: any) {
                          console.error("[Meta Webhook] Failed to dispatch automated WhatsApp:", waErr?.message || waErr);
                        }
                      }
                    }
                  } catch (autoErr: any) {
                    console.error("[Meta Webhook] Stage automations dispatch error:", autoErr?.message || autoErr);
                  }
                }
              }
            }
          }
        }

        return new Response(JSON.stringify({ status: "EVENT_RECEIVED" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response("Not a page object", { status: 400 });
    } catch (err: any) {
      console.error("[Meta Webhook] Processing error:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
