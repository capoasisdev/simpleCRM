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

              // 1. Resolve Target Pipeline & Initial Stage
              let targetPipelineId: string | null = null;
              let entryStage = "new";

              if (connectedForm?.pipeline_id) {
                targetPipelineId = connectedForm.pipeline_id;
                entryStage = connectedForm.entry_stage_id || "new";
              } else {
                // Fallback to default pipeline from pipelines table
                try {
                  const { data: defaultPipe } = await supabase
                    .from("pipelines")
                    .select("id, stages")
                    .order("is_default", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  if (defaultPipe) {
                    targetPipelineId = defaultPipe.id;
                    if (Array.isArray(defaultPipe.stages) && defaultPipe.stages.length > 0) {
                      const explicitEntry = defaultPipe.stages.find((s: any) => s.is_entry === true);
                      const fallbackNew = defaultPipe.stages.find((s: any) => s.id === "new");
                      const resolved = explicitEntry || fallbackNew || defaultPipe.stages[0];
                      if (resolved?.id) entryStage = resolved.id;
                    }
                  }
                } catch (pipeErr) {
                  console.warn("[Meta Webhook] Could not fetch default pipeline stages:", pipeErr);
                }
              }

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

              // Insert into leads table
              const now = new Date();
              const today = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
              const { error: insertError } = await supabase.from("leads").insert({
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
              });

              if (insertError) {
                console.error("[Meta Webhook] Failed to insert lead into Supabase:", insertError);
              } else {
                console.log(`[Meta Webhook] Successfully saved lead: ${leadName} -> Pipeline: ${targetPipelineId || 'default'} (Stage: ${entryStage}, Assigned to: ${assignedTo}) with ${Object.keys(customFields).length} form fields`);
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
