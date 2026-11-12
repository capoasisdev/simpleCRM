import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { hashPbkdf2, sanitizeCrmUser, sendSystemResendEmail } from "./authBridge.ts";

export const DEFAULT_ADMIN_PERMISSIONS = {
  leads: { scope: "all", view: true, edit: true, delete: true },
  messages: { scope: "all", view: true },
  pipeline: { view: true, edit: true, delete: true },
  dashboard: { scope: "all", view: true, view_deals: true, view_activity: true },
  analytics: { scope: "all", view: true, include_in_leaderboard: false },
  followups: { scope: "all", view: true, delete: true },
  admin: { manage_users: true, manage_routing: true, manage_meta: true, view_ad_budget: true },
};

export const DEFAULT_SALES_PIPELINE_STAGES = [
  { id: "new", label: "New Leads", order: 0, is_entry: true, is_won: false, is_lost: false },
  { id: "contacted", label: "Contacted", order: 1, is_entry: false, is_won: false, is_lost: false },
  { id: "proposal", label: "Proposal Sent", order: 2, is_entry: false, is_won: false, is_lost: false },
  { id: "won", label: "Won", order: 3, is_entry: false, is_won: true, is_lost: false },
  { id: "lost", label: "Lost", order: 4, is_entry: false, is_won: false, is_lost: true },
];

export const DEFAULT_SALES_PIPELINE_FIELDS = [
  { key: "name", label: "Full Name", mapped_question: "name", show_on_card: false, is_core: true },
  { key: "phone", label: "Phone Number", mapped_question: "phone", show_on_card: true, is_core: true },
  { key: "email", label: "Email Address", mapped_question: "email", show_on_card: false, is_core: true },
  { key: "city", label: "City", mapped_question: "city", show_on_card: false, is_core: false },
];

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

function escapeHtml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateHumanTempPassword(name = ""): string {
  const cleanName = String(name || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z]/g, "");

  const prefix =
    cleanName.length >= 2
      ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1).toLowerCase()
      : "Welcome";

  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const digits = 1000 + (buf[0] % 9000);
  return `${prefix}@${digits}`;
}

export function deriveCompanyName(explicitName: string | undefined | null, adminName: string, workEmail: string): string {
  const cleanedExplicit = String(explicitName || "").trim();
  if (cleanedExplicit) return cleanedExplicit.slice(0, 80);

  const domain = String(workEmail || "").split("@")[1]?.toLowerCase() || "";
  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    const label = domain.split(".")[0].replace(/[^a-z0-9-]+/gi, " ").trim();
    if (label.length >= 2) {
      return label
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }

  const first = String(adminName || "").trim().split(/\s+/)[0] || "Team";
  return `${first}'s Workspace`;
}

function toSlug(input: string): string {
  const base = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return base || "workspace";
}

export interface ProvisionCompanyParams {
  companyName?: string | null;
  adminName: string;
  adminEmail: string;
  adminPhone?: string | null;
  requestedSeats?: number;
  trialDays?: number;
  isBillingExempt?: boolean;
  trialEnrollmentId?: string | null;
  loginUrl?: string | null;
  sendWelcomeEmail?: boolean;
}

export async function provisionCompany(
  adminClient: SupabaseClient,
  params: ProvisionCompanyParams
): Promise<{
  ok: boolean;
  code?: string;
  error?: string;
  company?: any;
  adminUser?: any;
  pipeline?: any;
  tempPassword?: string;
  emailSent?: boolean;
  emailReason?: string;
}> {
  const adminName = String(params.adminName || "").trim();
  const adminEmail = String(params.adminEmail || "").trim().toLowerCase();
  const adminPhone = String(params.adminPhone || "").trim() || null;
  const seatLimit = Math.max(1, Math.min(500, Math.round(Number(params.requestedSeats) || 5)));
  const trialDays = Math.max(1, Math.min(365, Math.round(Number(params.trialDays) || 14)));
  const isBillingExempt = Boolean(params.isBillingExempt);
  const companyName = deriveCompanyName(params.companyName, adminName, adminEmail);
  const loginUrl = String(params.loginUrl || "https://simplecrm.capoasis.com/login").trim();
  const shouldSendEmail = params.sendWelcomeEmail !== false;

  if (!adminName) {
    return { ok: false, code: "INVALID_INPUT", error: "Administrator name is required." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return { ok: false, code: "INVALID_INPUT", error: "Please enter a valid work email address." };
  }

  // Enforce global uniqueness across all tenants before creating the company
  const { data: existingUser, error: dupCheckErr } = await adminClient
    .from("crm_users")
    .select("id, company_id")
    .ilike("email", adminEmail)
    .limit(1)
    .maybeSingle();

  if (dupCheckErr) {
    return { ok: false, code: "DB_ERROR", error: dupCheckErr.message };
  }
  if (existingUser) {
    return {
      ok: false,
      code: "EMAIL_EXISTS",
      error: "An account with this work email already exists on simplecrm. Please sign in instead.",
    };
  }

  const baseSlug = toSlug(companyName);
  const trialStartsAt = new Date();
  const trialEndsAt = new Date(trialStartsAt.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const tempPassword = generateHumanTempPassword(adminName);
  const passwordHash = await hashPbkdf2(tempPassword);

  let createdCompany: any = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const suffix = attempt === 0 ? "" : `-${crypto.randomUUID().slice(0, 6)}`;
    const candidateSlug = `${baseSlug}${suffix}`;
    const { data, error } = await adminClient
      .from("companies")
      .insert([{
        name: companyName,
        slug: candidateSlug,
        subscription_status: isBillingExempt ? "active" : "trialing",
        trial_starts_at: trialStartsAt.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
        seat_limit: seatLimit,
        price_per_seat_inr: 999,
        is_billing_exempt: isBillingExempt,
        owner_email: adminEmail,
        owner_phone: adminPhone,
      }])
      .select("*")
      .single();

    if (!error && data) {
      createdCompany = data;
      break;
    }
    if (error?.code === "23505") {
      continue;
    }
    return { ok: false, code: "PROVISION_FAILED", error: error?.message || "Could not create workspace." };
  }

  if (!createdCompany) {
    return { ok: false, code: "PROVISION_FAILED", error: "Could not allocate unique workspace slug." };
  }

  try {
    // Seed default Sales Pipeline
    const { data: pipeline, error: pipeErr } = await adminClient
      .from("pipelines")
      .insert([{
        company_id: createdCompany.id,
        name: "Sales Pipeline",
        pipeline_type: "sales",
        is_default: true,
        stages: DEFAULT_SALES_PIPELINE_STAGES,
        pipeline_fields: DEFAULT_SALES_PIPELINE_FIELDS,
        lead_distribution: {
          mode: "round_robin",
          default_assignee: "unassigned",
          user_rules: [],
          round_robin_index: 0,
        },
      }])
      .select("*")
      .single();

    if (pipeErr) throw new Error(`Failed seeding pipeline: ${pipeErr.message}`);

    // Seed default Lead Routing Config
    const { error: routingErr } = await adminClient
      .from("lead_routing_config")
      .insert([{
        company_id: createdCompany.id,
        mode: "round_robin",
        default_assignee: "unassigned",
        user_rules: [],
        round_robin_index: 0,
      }]);

    if (routingErr) throw new Error(`Failed seeding lead routing config: ${routingErr.message}`);

    // Seed default Email Templates (defined in Part 1 migration)
    const { error: tplErr } = await adminClient.rpc("seed_default_email_templates", {
      p_company_id: createdCompany.id,
    });
    if (tplErr) throw new Error(`Failed seeding email templates: ${tplErr.message}`);

    // Create First Admin Account
    const { data: adminUser, error: userErr } = await adminClient
      .from("crm_users")
      .insert([{
        company_id: createdCompany.id,
        name: adminName,
        email: adminEmail,
        password_hash: passwordHash,
        password_updated_at: new Date().toISOString(),
        must_change_password: true,
        role: "admin",
        permissions: DEFAULT_ADMIN_PERMISSIONS,
      }])
      .select("*")
      .single();

    if (userErr || !adminUser) {
      throw new Error(`Failed creating admin account: ${userErr?.message || "unknown"}`);
    }

    if (params.trialEnrollmentId) {
      await adminClient
        .from("trial_enrollments")
        .update({
          status: "provisioned",
          provisioned_company_id: createdCompany.id,
        })
        .eq("id", params.trialEnrollmentId);
    }

    let emailSent = false;
    let emailReason: string | undefined;

    if (shouldSendEmail) {
      const trialEndDisplay = trialEndsAt.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #09090b; background: #ffffff;">
          <div style="font-size: 16px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 20px;">simplecrm</div>
          <h2 style="font-size: 21px; font-weight: 600; margin: 0 0 10px; color: #09090b;">Your 14-day free trial is ready, ${escapeHtml(adminName)}</h2>
          <p style="font-size: 14px; color: #52525b; line-height: 1.6; margin: 0 0 18px;">
            We provisioned your isolated <strong>${escapeHtml(createdCompany.name)}</strong> workspace with <strong>${seatLimit}</strong> team seats active through <strong>${escapeHtml(trialEndDisplay)}</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e4e4e7; border-radius: 10px; padding: 20px; margin: 20px 0;">
            <div style="margin-bottom: 14px;">
              <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; font-weight: 600; display: block; margin-bottom: 3px;">Work Account Email</span>
              <strong style="font-size: 15px; color: #09090b;">${escapeHtml(adminEmail)}</strong>
            </div>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; font-weight: 600; display: block; margin-bottom: 3px;">Temporary Password</span>
              <code style="font-size: 16px; font-weight: 700; color: #18181b; background: #ffffff; padding: 6px 10px; border-radius: 6px; border: 1px solid #d4d4d8; display: inline-block;">${escapeHtml(tempPassword)}</code>
            </div>
          </div>
          <p style="font-size: 12.5px; color: #71717a; line-height: 1.5; margin: 0 0 22px;">
            You will be prompted to set a permanent private password on your first sign-in.
          </p>
          <div>
            <a href="${escapeHtml(loginUrl)}" style="background: #18181b; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-size: 13.5px; font-weight: 500; display: inline-block;">
              Sign In to simplecrm &rarr;
            </a>
          </div>
        </div>
      `;

      const mailRes = await sendSystemResendEmail({
        adminClient,
        companyId: createdCompany.id,
        to: [adminEmail],
        subject: `Welcome to simplecrm — ${createdCompany.name} Workspace Ready`,
        html: htmlBody,
        templateName: "Trial Workspace Welcome",
      });

      emailSent = mailRes.sent;
      emailReason = mailRes.reason;
    }

    return {
      ok: true,
      company: {
        id: createdCompany.id,
        name: createdCompany.name,
        slug: createdCompany.slug,
        subscription_status: createdCompany.subscription_status,
        trial_starts_at: createdCompany.trial_starts_at,
        trial_ends_at: createdCompany.trial_ends_at,
        seat_limit: createdCompany.seat_limit,
        price_per_seat_inr: createdCompany.price_per_seat_inr,
        is_billing_exempt: createdCompany.is_billing_exempt,
      },
      adminUser: sanitizeCrmUser(adminUser),
      pipeline: { id: pipeline.id, name: pipeline.name },
      tempPassword,
      emailSent,
      emailReason,
    };
  } catch (err: any) {
    // Roll back partially created company (ON DELETE CASCADE removes child seed rows cleanly)
    try {
      await adminClient.from("companies").delete().eq("id", createdCompany.id);
    } catch {}
    return {
      ok: false,
      code: "PROVISION_FAILED",
      error: err?.message || "Failed to provision company workspace.",
    };
  }
}

