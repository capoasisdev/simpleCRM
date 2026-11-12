import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createServiceClients() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    throw new Error("Missing Supabase environment variables in Edge Function.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { supabaseUrl, serviceRoleKey, anonKey, adminClient, anonClient };
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBuffer(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPbkdf2(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `pbkdf2:100000:${bufferToHex(salt.buffer)}:${bufferToHex(derivedBits)}`;
}

export async function verifyPbkdf2(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash || !storedHash.startsWith("pbkdf2:")) {
    return false;
  }

  const parts = storedHash.split(":");
  if (parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const originalHashHex = parts[3];
  if (!iterations || !saltHex || !originalHashHex) return false;

  try {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: hexToBuffer(saltHex), iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );
    const derivedHex = bufferToHex(derivedBits);
    if (derivedHex.length !== originalHashHex.length) return false;

    let diff = 0;
    for (let i = 0; i < derivedHex.length; i++) {
      diff |= derivedHex.charCodeAt(i) ^ originalHashHex.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): { isValid: boolean; message: string } {
  if (!password || typeof password !== "string") {
    return { isValid: false, message: "Password cannot be empty." };
  }
  if (password.length < 6) {
    return { isValid: false, message: "Password must be at least 6 characters long." };
  }
  return { isValid: true, message: "Password meets minimum requirements." };
}

export function sanitizeCrmUser(user: Record<string, any>) {
  return {
    id: user.id,
    company_id: user.company_id,
    created_at: user.created_at,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    password_updated_at: user.password_updated_at ?? null,
    must_change_password: Boolean(user.must_change_password),
    is_secured: Boolean(user.password_hash && String(user.password_hash).trim() !== ""),
    masked_pin: user.pin ? "••••" : null,
  };
}

/**
 * Ensures a 1-to-1 shadow user exists in Supabase auth.users (matching crm_users.id)
 * with immutable app_metadata claims, then mints a genuine Supabase Auth session
 * (access_token + refresh_token) without sending any email.
 */
export async function ensureAuthUserAndMintSession(
  adminClient: SupabaseClient,
  anonClient: SupabaseClient,
  user: Record<string, any>
) {
  const email = String(user.email || "").trim().toLowerCase();
  const appMetadata = {
    company_id: user.company_id,
    crm_user_id: user.id,
    app_role: user.role || "member",
  };

  const { data: existingById } = await adminClient.auth.admin.getUserById(user.id);

  if (existingById?.user) {
    const currentMeta = existingById.user.app_metadata || {};
    const needsSync =
      existingById.user.email?.toLowerCase() !== email ||
      currentMeta.company_id !== appMetadata.company_id ||
      currentMeta.crm_user_id !== appMetadata.crm_user_id ||
      currentMeta.app_role !== appMetadata.app_role;

    if (needsSync) {
      const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
        email,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: { name: user.name },
      });
      if (updateErr) {
        throw new Error(`Failed to synchronize auth profile: ${updateErr.message}`);
      }
    }
  } else {
    const { error: createErr } = await adminClient.auth.admin.createUser({
      id: user.id,
      email,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { name: user.name },
    });

    if (createErr) {
      // Handle rare collision if an orphan auth.users row had this email under a different UUID
      const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const matching = listData?.users?.find((u) => u.email?.toLowerCase() === email);
      if (!matching) {
        throw new Error(`Failed to initialize auth identity: ${createErr.message}`);
      }
      await adminClient.auth.admin.deleteUser(matching.id);
      const { error: retryErr } = await adminClient.auth.admin.createUser({
        id: user.id,
        email,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: { name: user.name },
      });
      if (retryErr) {
        throw new Error(`Failed to re-create auth identity: ${retryErr.message}`);
      }
    }
  }

  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = linkData?.properties?.hashed_token;
  if (linkErr || !hashedToken) {
    throw new Error(`Failed to generate session token: ${linkErr?.message || "missing token"}`);
  }

  const { data: verifiedData, error: verifyErr } = await anonClient.auth.verifyOtp({
    token_hash: hashedToken,
    type: "magiclink",
  });

  if (verifyErr || !verifiedData?.session) {
    throw new Error(`Failed to activate session: ${verifyErr?.message || "no session"}`);
  }

  return verifiedData.session;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

function decodeJwtPayloadUnsafe(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export async function isServiceRoleRequest(req: Request): Promise<boolean> {
  const token = extractBearerToken(req);
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const altSecret = (Deno.env.get("SUPABASE_SECRET_KEY") ?? "").trim();
  if (!token) return false;
  if (serviceKey && constantTimeEqual(token, serviceKey)) return true;
  if (altSecret && constantTimeEqual(token, altSecret)) return true;

  // Fallback: verify signed legacy service_role JWT authoritatively against GoTrue Admin API
  // when Edge Runtime injects a rotated sb_secret_* env var.
  const payload = decodeJwtPayloadUnsafe(token);
  if (!payload || payload.role !== "service_role") return false;

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!supabaseUrl) return false;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: token,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isCronSecretRequest(req: Request): boolean {
  const provided = (req.headers.get("x-cron-secret") ?? "").trim();
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  if (!provided || !expected) return false;
  return constantTimeEqual(provided, expected);
}

/**
 * Extracts and verifies the authenticated caller's crm_users identity from a Bearer JWT.
 */
export async function getAuthenticatedCrmCaller(
  req: Request,
  adminClient: SupabaseClient
): Promise<{ authUser: any; crmUser: any } | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { data: authData, error: authErr } = await adminClient.auth.getUser(token);
  if (authErr || !authData?.user) return null;

  const crmUserId =
    authData.user.app_metadata?.crm_user_id || authData.user.id;

  const { data: crmUser, error: crmErr } = await adminClient
    .from("crm_users")
    .select("*")
    .eq("id", crmUserId)
    .maybeSingle();

  if (crmErr || !crmUser) return null;
  return { authUser: authData.user, crmUser };
}

/**
 * Dispatches transactional system emails using the company's own connected Resend
 * credentials first, falling back seamlessly to platform simplecrm Resend secrets.
 */
export async function sendSystemResendEmail(params: {
  adminClient: SupabaseClient;
  companyId: string;
  to: string[];
  subject: string;
  html: string;
  templateName: string;
  fromNameOverride?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { adminClient, companyId, to, subject, html, templateName, fromNameOverride } = params;

  const { data: companySettings } = await adminClient
    .from("email_settings")
    .select("api_key, from_name, from_email, reply_to, is_connected")
    .eq("company_id", companyId)
    .maybeSingle();

  const companyKey = companySettings?.is_connected ? companySettings.api_key?.trim() : "";
  const platformKey = (Deno.env.get("PLATFORM_RESEND_API_KEY") ?? "").trim();

  let activeKey = "";
  let fromName = fromNameOverride || "simplecrm";
  let fromEmail = "noreply@mail.capoasis.com";
  let replyTo: string | undefined;

  if (companyKey && companyKey.startsWith("re_")) {
    activeKey = companyKey;
    fromName = companySettings?.from_name || fromName;
    fromEmail = companySettings?.from_email || "onboarding@resend.dev";
    replyTo = companySettings?.reply_to || undefined;
  } else if (platformKey && platformKey.startsWith("re_")) {
    activeKey = platformKey;
    fromName = Deno.env.get("PLATFORM_RESEND_FROM_NAME")?.trim() || fromName;
    fromEmail = Deno.env.get("PLATFORM_RESEND_FROM_EMAIL")?.trim() || "noreply@mail.capoasis.com";
    replyTo = Deno.env.get("PLATFORM_RESEND_REPLY_TO")?.trim() || undefined;
  } else {
    return { sent: false, reason: "EMAIL_SERVICE_NOT_CONNECTED" };
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${activeKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to,
      reply_to: replyTo,
      subject,
      html,
    }),
  });

  const resendJson = await resendRes.json().catch(() => null);
  const errorMessage = resendRes.ok
    ? null
    : `[Resend HTTP ${resendRes.status}] ${resendJson?.message || resendJson?.error || resendRes.statusText || "Unknown error"}`;

  try {
    await adminClient.from("email_logs").insert([{
      company_id: companyId,
      lead_id: null,
      lead_name: to[0],
      lead_email: to[0],
      template_name: templateName,
      subject,
      body: html,
      status: resendRes.ok ? "sent" : "failed",
      error_message: errorMessage,
      is_automated: true,
    }]);
  } catch (logErr) {
    console.warn("[authBridge] Failed writing email_logs:", logErr);
  }

  if (!resendRes.ok) {
    return { sent: false, reason: errorMessage || "Failed to dispatch email." };
  }

  return { sent: true };
}

