import { corsHeaders, createServiceClients, jsonResponse } from "../_shared/authBridge.ts";
import { isCompanySubscriptionActive } from "../_shared/billing.ts";
import { resolveCompanyLeadAssignee } from "../_shared/leadDistribution.ts";

Deno.serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Health check endpoint (GET)
  if (req.method === "GET") {
    return jsonResponse({
      status: "active",
      service: "simplecrm Website Form Webhook",
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Handle Form Submission (POST)
  if (req.method === "POST") {
    try {
      const url = new URL(req.url);
      let formId = url.searchParams.get("form_id") || url.searchParams.get("id");

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
        return jsonResponse({ error: "Missing required 'form_id' parameter." }, 400);
      }

      const { adminClient } = createServiceClients();

      // Lookup connected form config and derive tenant company_id authoritatively
      const { data: connectedForm, error: formError } = await adminClient
        .from("connected_forms")
        .select("*")
        .eq("form_id", String(formId))
        .maybeSingle();

      if (formError || !connectedForm) {
        console.warn(`[Website Webhook] Form not found for form_id: ${formId}`);
        return jsonResponse(
          { error: `Website form '${formId}' is not registered in simplecrm.` },
          404
        );
      }

      if (connectedForm.is_active === false) {
        return jsonResponse(
          { error: `Website form '${formId}' is currently disabled.` },
          403
        );
      }

      const companyId = connectedForm.company_id ? String(connectedForm.company_id) : null;
      if (!companyId) {
        console.error(`[Website Webhook] Form ${formId} has null company_id; rejecting ingest.`);
        return jsonResponse({ error: "Website form is missing workspace assignment." }, 400);
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

      // Track connected domain scoped strictly to connectedForm.id + company_id
      if (siteDomain) {
        const existingList =
          Array.isArray(connectedForm.connected_sites) && connectedForm.connected_sites.length > 0
            ? connectedForm.connected_sites
            : Array.isArray(connectedForm.tags)
              ? connectedForm.tags
              : [];

        if (!existingList.includes(siteDomain)) {
          const updatedSites = [...existingList, siteDomain];
          try {
            const { error: updErr } = await adminClient
              .from("connected_forms")
              .update({ connected_sites: updatedSites, tags: updatedSites })
              .eq("id", connectedForm.id)
              .eq("company_id", companyId);

            if (updErr) {
              await adminClient
                .from("connected_forms")
                .update({ tags: updatedSites })
                .eq("id", connectedForm.id)
                .eq("company_id", companyId);
            }
          } catch {
            await adminClient
              .from("connected_forms")
              .update({ tags: updatedSites })
              .eq("id", connectedForm.id)
              .eq("company_id", companyId);
          }
        }
      }

      // Handle presence verification ping
      const isPing =
        url.searchParams.get("ping") === "true" ||
        payload.ping === true ||
        payload.action === "ping";
      if (isPing) {
        return jsonResponse({
          success: true,
          status: "connected",
          domain: siteDomain || "verified",
          form_name: connectedForm.form_name,
        });
      }

      // Verify company subscription is eligible for lead ingestion
      const { data: company } = await adminClient
        .from("companies")
        .select("id, subscription_status, trial_ends_at, is_billing_exempt")
        .eq("id", companyId)
        .maybeSingle();

      if (!isCompanySubscriptionActive(company, { allowPastDue: true })) {
        console.warn(`[Website Webhook] Rejected submission for inactive company ${companyId}`);
        return jsonResponse({ error: "Workspace subscription is inactive." }, 403);
      }

      // Check if Form is linked to a Pipeline belonging to the same company
      if (!connectedForm.pipeline_id) {
        console.warn(
          `[Website Webhook] Form "${connectedForm.form_name}" (ID: ${formId}) is not linked to any pipeline.`
        );
        return jsonResponse(
          {
            error: `Form '${connectedForm.form_name}' is not attached to any pipeline. Please connect it in Pipeline Settings.`,
          },
          400
        );
      }

      const targetPipelineId = connectedForm.pipeline_id;
      const { data: scopedPipeline } = await adminClient
        .from("pipelines")
        .select("id")
        .eq("id", targetPipelineId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (!scopedPipeline) {
        return jsonResponse(
          { error: "Form is linked to a pipeline outside its workspace." },
          400
        );
      }

      const entryStage = connectedForm.entry_stage_id || "new";

      // Resolve Assignee scoped to companyId (pipeline distribution -> company routing -> 'unassigned')
      const assignedTo = await resolveCompanyLeadAssignee({
        adminClient,
        companyId,
        connectedForm,
        pipelineId: targetPipelineId,
        logPrefix: "[Website Webhook]",
      });

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

      const standardKeys = new Set([
        "name", "full_name", "fullname", "first_name", "firstname", "last_name", "lastname",
        "phone", "tel", "mobile", "contact", "phone_number", "phonenumber",
        "email", "mail", "email_address", "emailaddress",
        "city", "location", "state", "address",
        "notes", "message", "comment", "comments", "inquiry", "requirement",
        "form_id", "formid", "pipeline_id", "site_domain", "ping", "action",
      ]);

      const customFields: Record<string, any> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (!standardKeys.has(k.toLowerCase()) && v !== undefined && v !== null && v !== "") {
          const normalizedKey = k.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");
          customFields[normalizedKey] = v;
        }
      }
      customFields.source = "website";
      if (siteDomain) {
        customFields.site_domain = siteDomain;
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const dateStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      const leadPayload = {
        company_id: companyId,
        name: String(leadName).trim(),
        phone: String(leadPhone).trim(),
        email: String(leadEmail).trim(),
        city: String(leadCity).trim(),
        stage: entryStage,
        pipeline_id: targetPipelineId,
        assigned_to: assignedTo,
        form_id: connectedForm.form_id || String(formId),
        form_name: connectedForm.form_name || "Website Form",
        notes: String(leadNotes).trim(),
        custom_fields: customFields,
        date: dateStr,
        created_at: nowIso,
      };

      const { data: insertedLead, error: insertError } = await adminClient
        .from("leads")
        .insert([leadPayload])
        .select()
        .single();

      if (insertError) {
        console.error("[Website Webhook] Failed to insert lead:", insertError);
        return jsonResponse({ error: "Failed to store lead: " + insertError.message }, 500);
      }

      console.log(
        `[Website Webhook] Created lead ${insertedLead.id} for company=${companyId} ("${leadName}") -> Pipeline ${targetPipelineId}`
      );

      return jsonResponse({
        success: true,
        message: "Lead received and saved successfully.",
        lead_id: insertedLead.id,
      });
    } catch (err: any) {
      console.error("[Website Webhook] Uncaught error:", err);
      return jsonResponse(
        { error: "Internal server error: " + (err?.message || String(err)) },
        500
      );
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
});
