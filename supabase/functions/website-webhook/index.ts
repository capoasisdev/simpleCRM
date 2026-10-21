import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Health check endpoint (GET)
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        status: "active",
        service: "SimpleCRM Website Form Webhook",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // 3. Handle Form Submission (POST)
  if (req.method === "POST") {
    try {
      const url = new URL(req.url);
      let formId = url.searchParams.get("form_id") || url.searchParams.get("id");

      // Parse payload from JSON, form-data, or urlencoded
      let payload: Record<string, any> = {};
      const contentType = req.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        try {
          payload = await req.json();
        } catch {
          payload = {};
        }
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        try {
          const formData = await req.formData();
          for (const [key, val] of formData.entries()) {
            payload[key] = val;
          }
        } catch {
          payload = {};
        }
      } else {
        try {
          const text = await req.text();
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }

      if (!formId && payload.form_id) {
        formId = String(payload.form_id);
      }

      if (!formId) {
        return new Response(
          JSON.stringify({ error: "Missing required 'form_id' parameter." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Initialize Supabase client
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY") ??
        "";
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Fetch connected form config
      const { data: connectedForm, error: formError } = await supabase
        .from("connected_forms")
        .select("*")
        .eq("form_id", formId)
        .maybeSingle();

      if (formError || !connectedForm) {
        console.warn(`[Website Webhook] Form not found for form_id: ${formId}`);
        return new Response(
          JSON.stringify({ error: `Website form '${formId}' is not registered in CRM.` }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Extract domain from payload, origin, or referer
      let siteDomain = String(payload.site_domain || "").trim();
      if (!siteDomain) {
        const originHeader = req.headers.get("origin") || req.headers.get("referer");
        if (originHeader) {
          try {
            siteDomain = new URL(originHeader).hostname;
          } catch {
            siteDomain = "";
          }
        }
      }

      // Track connected domain in connected_forms (connected_sites with tags fallback)
      if (siteDomain) {
        const existingList = Array.isArray(connectedForm.connected_sites) && connectedForm.connected_sites.length > 0
          ? connectedForm.connected_sites
          : (Array.isArray(connectedForm.tags) ? connectedForm.tags : []);

        if (!existingList.includes(siteDomain)) {
          const updatedSites = [...existingList, siteDomain];
          try {
            const { error: updErr } = await supabase
              .from("connected_forms")
              .update({ connected_sites: updatedSites, tags: updatedSites })
              .eq("id", connectedForm.id);

            if (updErr) {
              await supabase
                .from("connected_forms")
                .update({ tags: updatedSites })
                .eq("id", connectedForm.id);
            }
          } catch {
            await supabase
              .from("connected_forms")
              .update({ tags: updatedSites })
              .eq("id", connectedForm.id);
          }
        }
      }


      // Handle presence verification ping
      const isPing = url.searchParams.get("ping") === "true" || payload.ping === true || payload.action === "ping";
      if (isPing) {
        return new Response(
          JSON.stringify({
            success: true,
            status: "connected",
            domain: siteDomain || "verified",
            form_name: connectedForm.form_name,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Check if Form is linked to a Pipeline
      if (!connectedForm.pipeline_id) {
        console.warn(`[Website Webhook] Form "${connectedForm.form_name}" (ID: ${formId}) is not linked to any pipeline.`);
        return new Response(
          JSON.stringify({
            error: `Form '${connectedForm.form_name}' is not attached to any pipeline. Please connect it in Pipeline Settings.`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const targetPipelineId = connectedForm.pipeline_id;
      const entryStage = connectedForm.entry_stage_id || "new";

      // Resolve Assignee via Pipeline lead distribution or Global lead routing
      let assignedTo = "pranav";

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
          } else if (mode === "single") {
            assignedTo = defaultAssignee;
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
                  updated_at: new Date().toISOString(),
                })
                .eq("id", targetPipelineId);
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
      } catch (distErr) {
        console.warn("[Website Webhook] Error resolving pipeline distribution:", distErr);
      }

      // Extract Standard Lead Attributes
      const leadName =
        payload.name ||
        payload.full_name ||
        payload.fullName ||
        [payload.first_name, payload.last_name].filter(Boolean).join(" ") ||
        [payload.firstName, payload.lastName].filter(Boolean).join(" ") ||
        "Website Lead";

      const leadPhone =
        payload.phone ||
        payload.tel ||
        payload.mobile ||
        payload.contact ||
        payload.phone_number ||
        payload.phoneNumber ||
        "";

      const leadEmail =
        payload.email ||
        payload.mail ||
        payload.email_address ||
        payload.emailAddress ||
        "";

      const leadCity =
        payload.city ||
        payload.location ||
        payload.state ||
        payload.address ||
        "";

      const leadNotes =
        payload.notes ||
        payload.message ||
        payload.comment ||
        payload.comments ||
        payload.inquiry ||
        payload.requirement ||
        "";

      // Collect Remaining Fields as Custom Fields
      const standardKeys = new Set([
        "name", "full_name", "fullname", "first_name", "firstname", "last_name", "lastname",
        "phone", "tel", "mobile", "contact", "phone_number", "phonenumber",
        "email", "mail", "email_address", "emailaddress",
        "city", "location", "state", "address",
        "notes", "message", "comment", "comments", "inquiry", "requirement",
        "form_id", "formid", "pipeline_id"
      ]);

      const customFields: Record<string, any> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (!standardKeys.has(k.toLowerCase()) && v !== undefined && v !== null && v !== "") {
          const normalizedKey = k.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");
          customFields[normalizedKey] = v;
        }
      }

      // Insert Lead into database
      const leadPayload = {
        name: String(leadName).trim(),
        phone: String(leadPhone).trim(),
        email: String(leadEmail).trim(),
        city: String(leadCity).trim(),
        stage: entryStage,
        pipeline_id: targetPipelineId,
        assigned_to: assignedTo,
        source: "website",
        form_name: connectedForm.form_name || "Website Form",
        notes: String(leadNotes).trim(),
        custom_fields: customFields,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: insertedLead, error: insertError } = await supabase
        .from("leads")
        .insert([leadPayload])
        .select()
        .single();

      if (insertError) {
        console.error("[Website Webhook] Failed to insert lead:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to store lead: " + insertError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      console.log(`[Website Webhook] Created lead ${insertedLead.id} for "${leadName}" -> Pipeline ${targetPipelineId}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: "Lead received and saved successfully.",
          lead_id: insertedLead.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (err: any) {
      console.error("[Website Webhook] Uncaught error:", err);
      return new Response(
        JSON.stringify({ error: "Internal server error: " + (err.message || String(err)) }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
