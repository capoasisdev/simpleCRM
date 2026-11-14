import {
  corsHeaders,
  createServiceClients,
  ensureAuthUserAndMintSession,
  hashPbkdf2,
  sanitizeCrmUser,
  validatePasswordStrength,
  verifyPbkdf2,
} from "../_shared/authBridge.ts";
import { provisionCompany } from "../_shared/companyProvisioner.ts";

const MASTER_CORS_HEADERS = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-master-token",
};

function masterJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...MASTER_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function getMasterSigningKey(): Promise<CryptoKey> {
  const secretSource =
    Deno.env.get("PLATFORM_ADMIN_JWT_SECRET") ||
    `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}::simplecrm_platform_admin_v1`;
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretSource));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signMasterToken(admin: { id: string; email: string; name: string }): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "MASTER_JWT" }))
  );
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        typ: "MASTER_ADMIN",
        iat: nowSec,
        exp: nowSec + 12 * 60 * 60,
      })
    )
  );
  const signingInput = `${header}.${payload}`;
  const key = await getMasterSigningKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
}

async function verifyMasterToken(token: string) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 3) return null;

  try {
    const signingInput = `${parts[0]}.${parts[1]}`;
    const key = await getMasterSigningKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(parts[2]),
      new TextEncoder().encode(signingInput)
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
    if (!payload || payload.typ !== "MASTER_ADMIN" || !payload.sub) return null;
    if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload as { sub: string; email: string; name: string; exp: number };
  } catch {
    return null;
  }
}

async function authenticateMasterCaller(req: Request, adminClient: any) {
  const headerToken = req.headers.get("x-master-token") || "";
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const token = headerToken || bearerToken;
  if (!token) return null;

  const claims = await verifyMasterToken(token);
  if (!claims) return null;

  const { data: admin } = await adminClient
    .from("platform_admins")
    .select("id, email, name, is_active, last_login_at")
    .eq("id", claims.sub)
    .maybeSingle();

  if (!admin || !admin.is_active) return null;
  return admin;
}

function generateTempPassword(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `Crm@${hex}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: MASTER_CORS_HEADERS });
  }

  if (req.method === "GET") {
    return masterJsonResponse({ status: "active", service: "simplecrm platform-admin" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const { adminClient, anonClient } = createServiceClients();

    if (action === "login") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "").trim();

      if (!email || !password) {
        return masterJsonResponse({ success: false, error: "Enter login and password." }, 400);
      }

      const { data: admin, error: adminErr } = await adminClient
        .from("platform_admins")
        .select("id, email, name, password_hash, is_active")
        .ilike("email", email)
        .maybeSingle();

      if (adminErr || !admin || !admin.is_active) {
        return masterJsonResponse({ success: false, error: "Invalid credentials." }, 401);
      }

      const valid = await verifyPbkdf2(password, String(admin.password_hash || ""));
      if (!valid) {
        return masterJsonResponse({ success: false, error: "Invalid credentials." }, 401);
      }

      const nowIso = new Date().toISOString();
      await adminClient
        .from("platform_admins")
        .update({ last_login_at: nowIso })
        .eq("id", admin.id);

      const token = await signMasterToken({
        id: admin.id,
        email: admin.email,
        name: admin.name || "Founder",
      });

      return masterJsonResponse({
        success: true,
        token,
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name || "Founder",
          last_login_at: nowIso,
        },
      });
    }

    const caller = await authenticateMasterCaller(req, adminClient);
    if (!caller) {
      return masterJsonResponse({ success: false, error: "UNAUTHORIZED" }, 401);
    }

    if (action === "session") {
      return masterJsonResponse({
        success: true,
        admin: {
          id: caller.id,
          email: caller.email,
          name: caller.name || "Founder",
          last_login_at: caller.last_login_at ?? null,
        },
      });
    }

    if (action === "overview") {
      const [
        companiesRes,
        usersRes,
        txRes,
        surveyRes,
        auditRes,
        leadsRes,
        formsRes,
        metaRes,
        emailRes,
        pipelinesRes,
        ticketsRes,
        enrollmentsRes,
        adminsRes,
      ] = await Promise.all([
        adminClient
          .from("companies")
          .select(
            "id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone, created_at"
          )
          .order("created_at", { ascending: false }),
        adminClient.from("crm_users").select("id, company_id, name, email"),
        adminClient
          .from("billing_transactions")
          .select(
            "id, company_id, razorpay_order_id, razorpay_payment_id, transaction_type, seats_delta, amount_inr, status, metadata, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(200),
        adminClient
          .from("trial_feedback_surveys")
          .select(
            "id, company_id, user_id, helps_sales, keeps_organized, experience_rating, wants_to_continue, favorite_features, pain_points, missing_features, feedback_notes, answers, cycle_key, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(200),
        adminClient
          .from("platform_admin_audit_logs")
          .select("id, admin_email, company_id, action, details, created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        adminClient.from("leads").select("id, company_id"),
        adminClient.from("connected_forms").select("id, company_id, is_active"),
        adminClient
          .from("meta_config")
          .select("company_id, is_connected, whatsapp_is_connected, whatsapp_account_name"),
        adminClient.from("email_settings").select("company_id, is_connected"),
        adminClient.from("pipelines").select("company_id, discovery_config"),
        adminClient
          .from("support_tickets")
          .select("id, company_id, created_at, user_id, user_name, user_email, type, subject, message, status, metadata")
          .order("created_at", { ascending: false })
          .limit(150),
        adminClient
          .from("trial_enrollments")
          .select("id, full_name, company_name, work_email, phone, requested_seats, status, provisioned_company_id, notes, created_at")
          .order("created_at", { ascending: false })
          .limit(150),
        adminClient
          .from("platform_admins")
          .select("id, email, name, is_active, last_login_at, created_at")
          .order("created_at", { ascending: true }),
      ]);

      const companies = companiesRes.data || [];
      const userRows = usersRes.data || [];
      const txRows = txRes.data || [];
      const surveyRows = surveyRes.data || [];
      const auditRows = auditRes.data || [];
      const leadsRows = leadsRes.data || [];
      const formsRows = formsRes.data || [];
      const metaRows = metaRes.data || [];
      const emailRows = emailRes.data || [];
      const pipelineRows = pipelinesRes.data || [];
      const ticketRows = ticketsRes.data || [];
      const enrollmentRows = enrollmentsRes.data || [];
      const platformAdmins = adminsRes.data || [];

      const companyNameMap = new Map<string, string>();
      for (const c of companies) {
        companyNameMap.set(c.id, c.name);
      }

      const usersByCompany = new Map<string, number>();
      for (const u of userRows) {
        const cid = String(u.company_id || "");
        if (cid) usersByCompany.set(cid, (usersByCompany.get(cid) || 0) + 1);
      }

      const leadsByCompany = new Map<string, number>();
      for (const l of leadsRows) {
        const cid = String(l.company_id || "");
        if (cid) leadsByCompany.set(cid, (leadsByCompany.get(cid) || 0) + 1);
      }

      const formsByCompany = new Map<string, number>();
      for (const f of formsRows) {
        const cid = String(f.company_id || "");
        if (cid && f.is_active !== false) {
          formsByCompany.set(cid, (formsByCompany.get(cid) || 0) + 1);
        }
      }

      const metaByCompany = new Map<string, { meta: boolean; whatsapp: boolean }>();
      for (const m of metaRows) {
        const cid = String(m.company_id || "");
        if (!cid) continue;
        const curr = metaByCompany.get(cid) || { meta: false, whatsapp: false };
        if (m.is_connected) curr.meta = true;
        if (m.whatsapp_is_connected) curr.whatsapp = true;
        metaByCompany.set(cid, curr);
      }

      const emailByCompany = new Map<string, boolean>();
      for (const e of emailRows) {
        const cid = String(e.company_id || "");
        if (cid && e.is_connected) emailByCompany.set(cid, true);
      }

      const autopilotByCompany = new Map<string, number>();
      for (const p of pipelineRows) {
        const cid = String(p.company_id || "");
        if (cid && p.discovery_config?.autopilot_enabled === true) {
          autopilotByCompany.set(cid, (autopilotByCompany.get(cid) || 0) + 1);
        }
      }

      const revenueByCompany = new Map<string, number>();
      let totalCollectedInr = 0;
      for (const tx of txRows) {
        if (tx.status === "paid") {
          const amt = Number(tx.amount_inr || 0);
          totalCollectedInr += amt;
          const cid = String(tx.company_id || "");
          if (cid) revenueByCompany.set(cid, (revenueByCompany.get(cid) || 0) + amt);
        }
      }

      const userNameMap = new Map(userRows.map((u: any) => [u.id, u.name]));
      const userEmailMap = new Map(userRows.map((u: any) => [u.id, u.email]));
      const surveyStatsByCompany = new Map<
        string,
        { count: number; sum: number; continueCount: number }
      >();
      let globalRatingSum = 0;
      for (const s of surveyRows) {
        const rating = Number(s.experience_rating || s.rating || 0);
        globalRatingSum += rating;
        const cid = String(s.company_id || "");
        if (!cid) continue;
        const curr = surveyStatsByCompany.get(cid) || { count: 0, sum: 0, continueCount: 0 };
        curr.count += 1;
        curr.sum += rating;
        if (s.wants_to_continue) curr.continueCount += 1;
        surveyStatsByCompany.set(cid, curr);
      }

      const nowMs = Date.now();
      let activePaidCount = 0;
      let trialingCount = 0;
      let attentionCount = 0;
      let exemptCount = 0;
      let monthlyRunRateInr = 0;

      const enrichedCompanies = companies.map((c: any) => {
        const activeUsers = usersByCompany.get(c.id) || 0;
        const unitPrice = Number(c.price_per_seat_inr || 999);
        const estimatedMrr = c.is_billing_exempt ? 0 : activeUsers * unitPrice;
        const status = String(c.subscription_status || "trialing").toLowerCase();
        const trialEndMs = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : 0;
        const periodEndMs = c.current_period_end ? new Date(c.current_period_end).getTime() : 0;

        if (c.is_billing_exempt) {
          exemptCount += 1;
        } else if (status === "active") {
          if (periodEndMs && periodEndMs <= nowMs) {
            attentionCount += 1;
          } else {
            activePaidCount += 1;
            monthlyRunRateInr += estimatedMrr;
          }
        } else if (status === "trialing" || status === "pilot_extended") {
          if (trialEndMs && trialEndMs <= nowMs) {
            attentionCount += 1;
          } else {
            trialingCount += 1;
          }
        } else {
          attentionCount += 1;
        }

        const surveyStat = surveyStatsByCompany.get(c.id);
        const metaInfo = metaByCompany.get(c.id) || { meta: false, whatsapp: false };
        return {
          ...c,
          active_users_count: activeUsers,
          leads_count: leadsByCompany.get(c.id) || 0,
          forms_count: formsByCompany.get(c.id) || 0,
          whatsapp_connected: metaInfo.whatsapp,
          meta_connected: metaInfo.meta,
          email_connected: emailByCompany.get(c.id) || false,
          autopilot_count: autopilotByCompany.get(c.id) || 0,
          estimated_mrr_inr: estimatedMrr,
          total_collected_inr: revenueByCompany.get(c.id) || 0,
          survey_responses_count: surveyStat?.count || 0,
          survey_avg_rating:
            surveyStat && surveyStat.count > 0
              ? Number((surveyStat.sum / surveyStat.count).toFixed(1))
              : 0,
          survey_continue_count: surveyStat?.continueCount || 0,
        };
      });

      const openTicketsCount = ticketRows.filter(
        (t: any) => t.status === "open" || t.status === "in_progress"
      ).length;
      const pendingEnrollmentsCount = enrollmentRows.filter(
        (e: any) => e.status === "pending"
      ).length;

      return masterJsonResponse({
        success: true,
        stats: {
          totalWorkspaces: companies.length,
          activePaidWorkspaces: activePaidCount,
          trialingWorkspaces: trialingCount,
          attentionWorkspaces: attentionCount,
          exemptWorkspaces: exemptCount,
          totalActiveUsers: userRows.length,
          totalLeadsCount: leadsRows.length,
          monthlyRunRateInr,
          totalCollectedInr,
          openTicketsCount,
          pendingEnrollmentsCount,
          surveyResponsesCount: surveyRows.length,
          avgSurveyRating:
            surveyRows.length > 0 ? Number((globalRatingSum / surveyRows.length).toFixed(1)) : 0,
        },
        companies: enrichedCompanies,
        recentTransactions: txRows.slice(0, 80).map((tx: any) => ({
          ...tx,
          company_name: companyNameMap.get(tx.company_id) || "Unknown Workspace",
        })),
        auditLogs: auditRows.map((log: any) => ({
          ...log,
          company_name: log.company_id ? companyNameMap.get(log.company_id) || "Workspace" : "Platform",
        })),
        supportTickets: ticketRows.map((t: any) => ({
          ...t,
          company_name: t.company_id ? companyNameMap.get(t.company_id) || "Workspace" : "Unknown",
        })),
        trialEnrollments: enrollmentRows.map((e: any) => ({
          ...e,
          provisioned_company_name: e.provisioned_company_id
            ? companyNameMap.get(e.provisioned_company_id) || "Workspace"
            : null,
        })),
        globalSurveys: surveyRows.map((s: any) => ({
          ...s,
          user_name: userNameMap.get(s.user_id) || "Team Member",
          user_email: userEmailMap.get(s.user_id) || "",
          rating: Number(s.experience_rating || s.rating || 5),
          feedback_note: s.feedback_notes || s.missing_features || s.feedback_note || "",
          company_name: s.company_id ? companyNameMap.get(s.company_id) || "Workspace" : "Workspace",
        })),
        platformAdmins,
      });
    }

    if (action === "company_detail") {
      const companyId = String(body.companyId || "").trim();
      if (!companyId) {
        return masterJsonResponse({ success: false, error: "companyId is required." }, 400);
      }

      const [
        compRes,
        usersRes,
        txRes,
        surveysRes,
        leadsCountRes,
        formsCountRes,
        metaRes,
        emailRes,
        pipelinesRes,
      ] = await Promise.all([
        adminClient.from("companies").select("*").eq("id", companyId).maybeSingle(),
        adminClient
          .from("crm_users")
          .select("id, name, email, role, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: true }),
        adminClient
          .from("billing_transactions")
          .select(
            "id, razorpay_order_id, razorpay_payment_id, transaction_type, seats_delta, amount_inr, status, metadata, created_at"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(50),
        adminClient
          .from("trial_feedback_surveys")
          .select(
            "id, user_id, helps_sales, keeps_organized, experience_rating, wants_to_continue, favorite_features, pain_points, missing_features, feedback_notes, answers, cycle_key, created_at"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: false }),
        adminClient
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
        adminClient
          .from("connected_forms")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true),
        adminClient
          .from("meta_config")
          .select("is_connected, connected_page_name, whatsapp_is_connected, whatsapp_account_name")
          .eq("company_id", companyId)
          .limit(5),
        adminClient
          .from("email_settings")
          .select("is_connected, from_email")
          .eq("company_id", companyId)
          .limit(5),
        adminClient
          .from("pipelines")
          .select("id, discovery_config")
          .eq("company_id", companyId),
      ]);

      if (compRes.error || !compRes.data) {
        return masterJsonResponse({ success: false, error: "Workspace not found." }, 404);
      }

      const metaRows = metaRes.data || [];
      const emailRows = emailRes.data || [];
      const pipeRows = pipelinesRes.data || [];
      const whatsappRow = metaRows.find((m: any) => m.whatsapp_is_connected);
      const metaRow = metaRows.find((m: any) => m.is_connected);
      const emailRow = emailRows.find((e: any) => e.is_connected);

      const usersList = usersRes.data || [];
      const userMap = new Map(usersList.map((u: any) => [u.id, u]));
      const enrichedSurveys = (surveysRes.data || []).map((s: any) => {
        const u = userMap.get(s.user_id);
        return {
          ...s,
          user_name: u?.name || "Team Member",
          user_email: u?.email || "",
          rating: Number(s.experience_rating || s.rating || 5),
          feedback_note: s.feedback_notes || s.missing_features || s.feedback_note || "",
        };
      });

      return masterJsonResponse({
        success: true,
        company: compRes.data,
        users: usersList,
        transactions: txRes.data || [],
        surveys: enrichedSurveys,
        adoption: {
          leadsCount: leadsCountRes.count || 0,
          formsCount: formsCountRes.count || 0,
          whatsappConnected: Boolean(whatsappRow),
          whatsappAccountName: whatsappRow?.whatsapp_account_name || "",
          metaConnected: Boolean(metaRow),
          connectedPageName: metaRow?.connected_page_name || "",
          emailConnected: Boolean(emailRow),
          fromEmail: emailRow?.from_email || "",
          autopilotCount: pipeRows.filter((p: any) => p.discovery_config?.autopilot_enabled === true).length,
        },
      });
    }

    if (action === "update_company_billing") {
      const companyId = String(body.companyId || "").trim();
      const preset = String(body.preset || "").trim();
      if (!companyId || !preset) {
        return masterJsonResponse({ success: false, error: "companyId and preset are required." }, 400);
      }

      const { data: existing, error: fetchErr } = await adminClient
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle();

      if (fetchErr || !existing) {
        return masterJsonResponse({ success: false, error: "Workspace not found." }, 404);
      }

      const now = Date.now();
      let patch: Record<string, unknown> = {};
      const auditDetails: Record<string, unknown> = {
        preset,
        prev_status: existing.subscription_status,
        prev_exempt: existing.is_billing_exempt,
      };

      switch (preset) {
        case "trial_14d": {
          const days = Math.max(1, Math.min(365, Number(body.days || 14)));
          patch = {
            subscription_status: "trialing",
            trial_starts_at: new Date(now).toISOString(),
            trial_ends_at: new Date(now + days * DAY_MS).toISOString(),
            current_period_start: null,
            current_period_end: null,
          };
          auditDetails.days = days;

          // Clear prior trial feedback surveys so the newly started trial has a clean slate
          await adminClient
            .from("trial_feedback_surveys")
            .delete()
            .eq("company_id", companyId)
            .eq("cycle_key", "trial");
          break;
        }
        case "expire_trial": {
          patch = {
            subscription_status: "trialing",
            trial_ends_at: new Date(now - DAY_MS).toISOString(),
            current_period_start: null,
            current_period_end: null,
            is_billing_exempt: false,
          };
          break;
        }
        case "extend_pilot": {
          const days = Math.max(1, Math.min(365, Number(body.days || 7)));
          const existingTrialEnd = existing.trial_ends_at
            ? new Date(existing.trial_ends_at).getTime()
            : 0;
          const baseMs = Math.max(now, Number.isFinite(existingTrialEnd) ? existingTrialEnd : 0);
          patch = {
            subscription_status: "pilot_extended",
            trial_ends_at: new Date(baseMs + days * DAY_MS).toISOString(),
            current_period_start: null,
            current_period_end: null,
          };
          auditDetails.days = days;
          break;
        }
        case "active_30d": {
          const days = Math.max(1, Math.min(365, Number(body.days || 30)));
          patch = {
            subscription_status: "active",
            current_period_start: new Date(now).toISOString(),
            current_period_end: new Date(now + days * DAY_MS).toISOString(),
          };
          auditDetails.days = days;
          break;
        }
        case "renewal_grace": {
          patch = {
            subscription_status: "active",
            current_period_start: new Date(now - 31 * DAY_MS).toISOString(),
            current_period_end: new Date(now - DAY_MS).toISOString(),
            is_billing_exempt: false,
          };
          break;
        }
        case "past_due": {
          patch = {
            subscription_status: "past_due",
            is_billing_exempt: false,
          };
          break;
        }
        case "toggle_exempt": {
          const nextExempt =
            typeof body.isExempt === "boolean"
              ? body.isExempt
              : !Boolean(existing.is_billing_exempt);
          patch = { is_billing_exempt: nextExempt };
          auditDetails.is_billing_exempt = nextExempt;
          break;
        }
        case "reset_feedback": {
          await adminClient
            .from("trial_feedback_surveys")
            .delete()
            .eq("company_id", companyId);
          patch = { updated_at: new Date(now).toISOString() };
          auditDetails.feedback_reset = true;
          break;
        }
        case "set_price": {
          const nextPrice = Math.max(1, Math.round(Number(body.pricePerSeatInr || 999)));
          patch = { price_per_seat_inr: nextPrice };
          auditDetails.prev_price = existing.price_per_seat_inr;
          auditDetails.price_per_seat_inr = nextPrice;
          break;
        }
        default:
          return masterJsonResponse({ success: false, error: `Unknown preset: ${preset}` }, 400);
      }

      const { data: updated, error: updateErr } = await adminClient
        .from("companies")
        .update(patch)
        .eq("id", companyId)
        .select("*")
        .single();

      if (updateErr) {
        return masterJsonResponse(
          { success: false, error: updateErr.message || "Unable to update workspace." },
          500
        );
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: companyId,
        action: `billing.${preset}`,
        details: auditDetails,
      });

      return masterJsonResponse({ success: true, company: updated });
    }

    if (action === "record_offline_payment") {
      const companyId = String(body.companyId || "").trim();
      const amountInr = Math.max(1, Number(body.amountInr || 0));
      const usersCount = Math.max(1, Math.round(Number(body.usersCount || 1)));
      const method = String(body.method || "UPI").trim();
      const reference = String(body.reference || "").trim();
      const days = Math.max(1, Math.min(365, Math.round(Number(body.days || 30))));

      if (!companyId || !Number.isFinite(amountInr) || amountInr <= 0) {
        return masterJsonResponse(
          { success: false, error: "Valid companyId and amountInr are required." },
          400
        );
      }

      const { data: existing, error: compErr } = await adminClient
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle();

      if (compErr || !existing) {
        return masterJsonResponse({ success: false, error: "Workspace not found." }, 404);
      }

      const now = Date.now();
      const existingEndMs = existing.current_period_end
        ? new Date(existing.current_period_end).getTime()
        : 0;
      const cycleBaseMs = Math.max(now, Number.isFinite(existingEndMs) ? existingEndMs : 0);
      const nextPeriodStart = new Date(now).toISOString();
      const nextPeriodEnd = new Date(cycleBaseMs + days * DAY_MS).toISOString();
      const hasPaidBefore =
        Boolean(existing.current_period_end) ||
        String(existing.subscription_status || "").toLowerCase() === "active";

      const uniqueSuffix = crypto.randomUUID().slice(0, 8);
      const orderId = `offline_${Date.now()}_${uniqueSuffix}`;
      const paymentId = reference || `${method.toUpperCase()}_${Date.now()}_${uniqueSuffix}`;

      const { data: txRow, error: txErr } = await adminClient
        .from("billing_transactions")
        .insert({
          company_id: companyId,
          transaction_type: hasPaidBefore ? "renewal" : "initial_activation",
          seats_delta: usersCount,
          amount_inr: amountInr,
          unit_price_inr: Number(existing.price_per_seat_inr || 999),
          currency: "INR",
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          status: "paid",
          metadata: {
            source: "manual_offline",
            method,
            reference: paymentId,
            days,
            recorded_by: caller.email,
          },
        })
        .select("*")
        .single();

      if (txErr) {
        return masterJsonResponse(
          { success: false, error: txErr.message || "Could not record transaction." },
          500
        );
      }

      const { data: updatedCompany, error: updateErr } = await adminClient
        .from("companies")
        .update({
          subscription_status: "active",
          current_period_start: nextPeriodStart,
          current_period_end: nextPeriodEnd,
        })
        .eq("id", companyId)
        .select("*")
        .single();

      if (updateErr) {
        return masterJsonResponse(
          { success: false, error: updateErr.message || "Transaction saved, but cycle update failed." },
          500
        );
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: companyId,
        action: "billing.manual_payment",
        details: {
          amount_inr: amountInr,
          users_count: usersCount,
          method,
          reference: paymentId,
          days,
        },
      });

      return masterJsonResponse({
        success: true,
        company: updatedCompany,
        transaction: txRow,
      });
    }

    if (action === "create_company") {
      const companyName = String(body.companyName || "").trim();
      const adminName = String(body.adminName || "").trim();
      const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
      const adminPhone = body.adminPhone ? String(body.adminPhone).trim() : null;
      const trialDays = Math.max(1, Math.min(365, Number(body.trialDays || 14)));
      const isBillingExempt = Boolean(body.isBillingExempt);
      const sendWelcomeEmail = body.sendWelcomeEmail !== false;

      if (!adminName || !adminEmail) {
        return masterJsonResponse(
          { success: false, error: "Admin name and email are required." },
          400
        );
      }

      const res = await provisionCompany(adminClient, {
        companyName: companyName || null,
        adminName,
        adminEmail,
        adminPhone,
        trialDays,
        isBillingExempt,
        loginUrl: body.loginUrl || null,
        sendWelcomeEmail,
      });

      if (!res.ok) {
        const statusCode = res.code === "EMAIL_EXISTS" ? 409 : 400;
        return masterJsonResponse(
          { success: false, error: res.error || "Provision failed." },
          statusCode
        );
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: res.company?.id ?? null,
        action: "workspace.create",
        details: {
          company_name: res.company?.name,
          admin_email: adminEmail,
          trial_days: trialDays,
          is_billing_exempt: isBillingExempt,
        },
      });

      return masterJsonResponse({
        success: true,
        company: res.company,
        adminUser: res.adminUser,
        tempPassword: res.tempPassword,
      });
    }

    if (action === "update_support_ticket") {
      const ticketId = String(body.ticketId || "").trim();
      const nextStatus = String(body.status || "").trim();
      const resolutionNote = String(body.resolutionNote || "").trim();
      const allowed = new Set(["open", "in_progress", "resolved", "closed"]);

      if (!ticketId || !allowed.has(nextStatus)) {
        return masterJsonResponse(
          { success: false, error: "Valid ticketId and status are required." },
          400
        );
      }

      const { data: existingTicket, error: tErr } = await adminClient
        .from("support_tickets")
        .select("*")
        .eq("id", ticketId)
        .maybeSingle();

      if (tErr || !existingTicket) {
        return masterJsonResponse({ success: false, error: "Ticket not found." }, 404);
      }

      const nextMeta = {
        ...(existingTicket.metadata && typeof existingTicket.metadata === "object"
          ? existingTicket.metadata
          : {}),
        updated_by: caller.email,
        updated_at: new Date().toISOString(),
        ...(resolutionNote ? { resolution_note: resolutionNote } : {}),
      };

      const { data: updatedTicket, error: updErr } = await adminClient
        .from("support_tickets")
        .update({ status: nextStatus, metadata: nextMeta })
        .eq("id", ticketId)
        .select("*")
        .single();

      if (updErr) {
        return masterJsonResponse(
          { success: false, error: updErr.message || "Failed to update ticket." },
          500
        );
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: existingTicket.company_id ?? null,
        action: "support.update_ticket",
        details: {
          ticket_id: ticketId,
          prev_status: existingTicket.status,
          next_status: nextStatus,
        },
      });

      return masterJsonResponse({ success: true, ticket: updatedTicket });
    }

    if (action === "provision_enrollment") {
      const enrollmentId = String(body.enrollmentId || "").trim();
      const mode = String(body.mode || "provision").trim();

      if (!enrollmentId) {
        return masterJsonResponse({ success: false, error: "enrollmentId is required." }, 400);
      }

      const { data: enrollment, error: enErr } = await adminClient
        .from("trial_enrollments")
        .select("*")
        .eq("id", enrollmentId)
        .maybeSingle();

      if (enErr || !enrollment) {
        return masterJsonResponse({ success: false, error: "Signup request not found." }, 404);
      }

      if (mode === "mark_churned") {
        const { data: updated, error: updErr } = await adminClient
          .from("trial_enrollments")
          .update({ status: "churned" })
          .eq("id", enrollmentId)
          .select("*")
          .single();

        if (updErr) {
          return masterJsonResponse({ success: false, error: updErr.message }, 500);
        }

        await adminClient.from("platform_admin_audit_logs").insert({
          admin_id: caller.id,
          admin_email: caller.email,
          company_id: enrollment.provisioned_company_id ?? null,
          action: "enrollment.mark_churned",
          details: { enrollment_id: enrollmentId, work_email: enrollment.work_email },
        });

        return masterJsonResponse({ success: true, enrollment: updated });
      }

      const res = await provisionCompany(adminClient, {
        companyName: enrollment.company_name || null,
        adminName: enrollment.full_name,
        adminEmail: enrollment.work_email,
        adminPhone: enrollment.phone || null,
        trialDays: Math.max(1, Math.min(365, Number(body.trialDays || 14))),
        isBillingExempt: Boolean(body.isBillingExempt),
        trialEnrollmentId: enrollment.id,
        loginUrl: body.loginUrl || null,
        sendWelcomeEmail: body.sendWelcomeEmail !== false,
      });

      if (!res.ok) {
        const statusCode = res.code === "EMAIL_EXISTS" ? 409 : 400;
        return masterJsonResponse(
          { success: false, error: res.error || "Provision failed." },
          statusCode
        );
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: res.company?.id ?? null,
        action: "enrollment.provision",
        details: {
          enrollment_id: enrollmentId,
          work_email: enrollment.work_email,
          company_name: res.company?.name,
        },
      });

      return masterJsonResponse({
        success: true,
        company: res.company,
        adminUser: res.adminUser,
        tempPassword: res.tempPassword,
      });
    }

    if (action === "reset_crm_user_password") {
      const companyId = String(body.companyId || "").trim();
      const crmUserId = String(body.crmUserId || "").trim();
      const customPassword = String(body.newPassword || "").trim();

      if (!companyId || !crmUserId) {
        return masterJsonResponse(
          { success: false, error: "companyId and crmUserId are required." },
          400
        );
      }

      const tempPassword = customPassword || generateTempPassword();
      const strength = validatePasswordStrength(tempPassword);
      if (!strength.isValid) {
        return masterJsonResponse({ success: false, error: strength.message }, 400);
      }

      const { data: targetUser, error: uErr } = await adminClient
        .from("crm_users")
        .select("id, company_id, email, name")
        .eq("id", crmUserId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (uErr || !targetUser) {
        return masterJsonResponse({ success: false, error: "CRM user not found." }, 404);
      }

      const passwordHash = await hashPbkdf2(tempPassword);
      const { error: updErr } = await adminClient
        .from("crm_users")
        .update({
          password_hash: passwordHash,
          password_updated_at: new Date().toISOString(),
          must_change_password: true,
        })
        .eq("id", crmUserId)
        .eq("company_id", companyId);

      if (updErr) {
        return masterJsonResponse(
          { success: false, error: updErr.message || "Could not update password." },
          500
        );
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: companyId,
        action: "user.reset_password",
        details: { crm_user_id: crmUserId, user_email: targetUser.email },
      });

      return masterJsonResponse({
        success: true,
        email: targetUser.email,
        tempPassword,
      });
    }

    if (action === "impersonate_crm_user") {
      const companyId = String(body.companyId || "").trim();
      const crmUserId = String(body.crmUserId || "").trim();

      if (!companyId || !crmUserId) {
        return masterJsonResponse(
          { success: false, error: "companyId and crmUserId are required." },
          400
        );
      }

      const [{ data: targetUser, error: uErr }, { data: company, error: cErr }] =
        await Promise.all([
          adminClient
            .from("crm_users")
            .select("*")
            .eq("id", crmUserId)
            .eq("company_id", companyId)
            .maybeSingle(),
          adminClient
            .from("companies")
            .select(
              "id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email"
            )
            .eq("id", companyId)
            .maybeSingle(),
        ]);

      if (uErr || !targetUser || cErr || !company) {
        return masterJsonResponse(
          { success: false, error: "User or workspace not found." },
          404
        );
      }

      const session = await ensureAuthUserAndMintSession(adminClient, anonClient, targetUser);

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: companyId,
        action: "user.support_session",
        details: { crm_user_id: crmUserId, user_email: targetUser.email, role: targetUser.role },
      });

      return masterJsonResponse({
        success: true,
        user: sanitizeCrmUser(targetUser),
        company,
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        },
      });
    }

    if (action === "change_master_password") {
      const currentPassword = String(body.currentPassword || "").trim();
      const newPassword = String(body.newPassword || "").trim();

      const strength = validatePasswordStrength(newPassword);
      if (!strength.isValid) {
        return masterJsonResponse({ success: false, error: strength.message }, 400);
      }

      const { data: fullAdmin } = await adminClient
        .from("platform_admins")
        .select("id, password_hash")
        .eq("id", caller.id)
        .single();

      const validCurrent = await verifyPbkdf2(
        currentPassword,
        String(fullAdmin?.password_hash || "")
      );
      if (!validCurrent) {
        return masterJsonResponse(
          { success: false, error: "Current password is incorrect." },
          400
        );
      }

      const nextHash = await hashPbkdf2(newPassword);
      const { error: updErr } = await adminClient
        .from("platform_admins")
        .update({ password_hash: nextHash })
        .eq("id", caller.id);

      if (updErr) {
        return masterJsonResponse({ success: false, error: updErr.message }, 500);
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: null,
        action: "master.change_password",
        details: { target_email: caller.email },
      });

      return masterJsonResponse({ success: true });
    }

    if (action === "create_platform_admin") {
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim() || "Operator";
      const password = String(body.password || "").trim();

      if (!email || !email.includes("@")) {
        return masterJsonResponse({ success: false, error: "Enter a valid email." }, 400);
      }

      const strength = validatePasswordStrength(password);
      if (!strength.isValid) {
        return masterJsonResponse({ success: false, error: strength.message }, 400);
      }

      const passwordHash = await hashPbkdf2(password);
      const { data: created, error: createErr } = await adminClient
        .from("platform_admins")
        .insert({ email, name, password_hash: passwordHash, is_active: true })
        .select("id, email, name, is_active, last_login_at, created_at")
        .single();

      if (createErr) {
        const msg = createErr.message?.includes("duplicate")
          ? "An operator with this email already exists."
          : createErr.message || "Could not create operator.";
        return masterJsonResponse({ success: false, error: msg }, 400);
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: null,
        action: "master.create_admin",
        details: { created_email: email, name },
      });

      return masterJsonResponse({ success: true, admin: created });
    }

    if (action === "toggle_platform_admin") {
      const targetId = String(body.adminId || "").trim();
      const isActive = Boolean(body.isActive);

      if (!targetId) {
        return masterJsonResponse({ success: false, error: "adminId is required." }, 400);
      }
      if (targetId === caller.id && !isActive) {
        return masterJsonResponse(
          { success: false, error: "You cannot deactivate your own active session." },
          400
        );
      }

      const { data: updated, error: updErr } = await adminClient
        .from("platform_admins")
        .update({ is_active: isActive })
        .eq("id", targetId)
        .select("id, email, name, is_active, last_login_at, created_at")
        .single();

      if (updErr) {
        return masterJsonResponse({ success: false, error: updErr.message }, 500);
      }

      await adminClient.from("platform_admin_audit_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        company_id: null,
        action: "master.toggle_admin",
        details: { target_email: updated.email, is_active: isActive },
      });

      return masterJsonResponse({ success: true, admin: updated });
    }

    return masterJsonResponse({ success: false, error: "Unsupported action." }, 400);
  } catch (err: any) {
    console.error("[platform-admin] Unhandled error:", err);
    return masterJsonResponse(
      { success: false, error: err?.message || "Internal server error." },
      500
    );
  }
});
