const MASTER_SESSION_KEY = 'simplecrm_master_admin_session';
const SUPPORT_HANDOFF_KEY = 'simplecrm_support_handoff';

function getEnv(name) {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
    return import.meta.env[name];
  }
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name];
  }
  return '';
}

function getEdgeConfig() {
  const url = String(getEnv('VITE_SUPABASE_URL') || '').replace(/\/+$/, '');
  const anonKey =
    getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_PUBLISHABLE_KEY') || '';
  return { url, anonKey };
}

export function getStoredMasterSession() {
  try {
    const raw = localStorage.getItem(MASTER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.admin?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMasterSession(session) {
  try {
    localStorage.setItem(MASTER_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore storage errors
  }
}

export function clearMasterSession() {
  try {
    localStorage.removeItem(MASTER_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

export function storeSupportHandoff(payload) {
  try {
    localStorage.setItem(
      SUPPORT_HANDOFF_KEY,
      JSON.stringify({ ...payload, createdAt: Date.now() })
    );
  } catch {
    // ignore storage errors
  }
}

export function consumeSupportHandoff() {
  try {
    const raw = localStorage.getItem(SUPPORT_HANDOFF_KEY);
    if (!raw) return null;
    localStorage.removeItem(SUPPORT_HANDOFF_KEY);
    const parsed = JSON.parse(raw);
    // Expire unconsumed handoffs after 60 seconds
    if (!parsed?.user || !parsed?.session || Date.now() - Number(parsed.createdAt || 0) > 60000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function callMasterFunction(payload, token = '') {
  const { url, anonKey } = getEdgeConfig();
  if (!url || !anonKey) {
    return { success: false, error: 'Supabase configuration is missing.' };
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
  if (token) {
    headers['x-master-token'] = token;
  }

  try {
    const res = await fetch(`${url}/functions/v1/platform-admin`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: data?.error || `Request failed (${res.status})`,
      };
    }
    return data && typeof data === 'object' ? data : { success: true };
  } catch (err) {
    return {
      success: false,
      error: err?.message || 'Network request failed.',
    };
  }
}

export async function masterLogin(email, password) {
  return callMasterFunction({
    action: 'login',
    email: String(email || '').trim().toLowerCase(),
    password: String(password || '').trim(),
  });
}

export async function masterVerifySession(token) {
  if (!token) return { success: false, error: 'UNAUTHORIZED' };
  return callMasterFunction({ action: 'session' }, token);
}

export async function fetchMasterOverview(token) {
  return callMasterFunction({ action: 'overview' }, token);
}

export async function fetchMasterCompanyDetail(token, companyId) {
  return callMasterFunction({ action: 'company_detail', companyId }, token);
}

export async function updateMasterCompanyBilling(token, companyId, preset, extra = {}) {
  return callMasterFunction(
    {
      action: 'update_company_billing',
      companyId,
      preset,
      ...extra,
    },
    token
  );
}

export async function recordMasterOfflinePayment(token, companyId, payload) {
  return callMasterFunction(
    {
      action: 'record_offline_payment',
      companyId,
      ...payload,
    },
    token
  );
}

export async function createMasterWorkspace(token, payload) {
  return callMasterFunction(
    {
      action: 'create_company',
      ...payload,
    },
    token
  );
}

export async function updateMasterSupportTicket(token, ticketId, status, resolutionNote = '') {
  return callMasterFunction(
    {
      action: 'update_support_ticket',
      ticketId,
      status,
      resolutionNote,
    },
    token
  );
}

export async function provisionMasterEnrollment(token, enrollmentId, mode = 'provision', extra = {}) {
  return callMasterFunction(
    {
      action: 'provision_enrollment',
      enrollmentId,
      mode,
      ...extra,
    },
    token
  );
}

export async function resetCrmUserPassword(token, companyId, crmUserId, newPassword = '') {
  return callMasterFunction(
    {
      action: 'reset_crm_user_password',
      companyId,
      crmUserId,
      newPassword,
    },
    token
  );
}

export async function impersonateCrmUser(token, companyId, crmUserId) {
  return callMasterFunction(
    {
      action: 'impersonate_crm_user',
      companyId,
      crmUserId,
    },
    token
  );
}

export async function changeMasterPassword(token, currentPassword, newPassword) {
  return callMasterFunction(
    {
      action: 'change_master_password',
      currentPassword,
      newPassword,
    },
    token
  );
}

export async function createPlatformAdmin(token, payload) {
  return callMasterFunction(
    {
      action: 'create_platform_admin',
      ...payload,
    },
    token
  );
}

export async function togglePlatformAdmin(token, adminId, isActive) {
  return callMasterFunction(
    {
      action: 'toggle_platform_admin',
      adminId,
      isActive,
    },
    token
  );
}
