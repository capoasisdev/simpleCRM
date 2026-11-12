export const SESSION_STORAGE_KEY = 'simplecrm_user_session';
export const ACTIVE_COMPANY_STORAGE_KEY = 'simplecrm_active_company';

const TENANT_DATA_CACHE_PREFIXES = [
  'crm_cached_users',
  'crm_cached_lead_routing_rules',
  'crm_cached_meta_config',
  'crm_cached_connected_forms',
  'crm_cached_ad_budget',
  'crm_cached_discovered_ad_accounts',
  'crm_meta_user_token',
  'crm_cached_pipelines',
  'crm_cached_pipelines_cold',
  'crm_pipeline_columns',
  'crm_cold_pipeline_columns',
  'crm_active_pipeline_id',
  'crm_active_cold_pipeline_id',
  'crm_cached_leads',
  'crm_cached_cold_leads',
  'crm_todo_lists_cache',
  'crm_todos_cache',
  'crm_lead_activities',
  'crm_lead_followups',
  'crm_sticky_notes_v2',
  'crm_rolling_backups',
  'crm_ai_chat_logs_cache',
  'crm_email_settings',
  'crm_email_templates',
  'crm_email_logs',
  'crm_whatsapp_messages',
  'simplecrm_notifications',
  'simplecrm_last_active_tab'
];

const UNNAMESPACED_LEGACY_KEYS = [
  'crm_openrouter_api_key',
  'crm_gemini_api_key'
];

/**
 * Reads the active cached tenant company metadata from localStorage.
 */
export function getActiveCompany() {
  try {
    const companyRaw = localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY);
    if (companyRaw) {
      const company = JSON.parse(companyRaw);
      if (company?.id) return company;
    }
    const userRaw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (user?.company_id) return { id: user.company_id };
    }
  } catch {
    // ignore storage parse failures
  }
  return null;
}

/**
 * Returns the active tenant company_id stored for the signed-in browser session.
 */
export function getActiveCompanyId() {
  return getActiveCompany()?.id || null;
}

/**
 * Returns the active tenant company_id or throws if no tenant session is active.
 */
export function requireActiveCompanyId() {
  const companyId = getActiveCompanyId();
  if (!companyId) {
    throw new Error('No active company session. Please sign in again.');
  }
  return companyId;
}

/**
 * Builds a tenant-scoped browser storage key (`<baseKey>:<companyId>`).
 */
export function tenantStorageKey(baseKey, explicitCompanyId = null) {
  const companyId = explicitCompanyId || getActiveCompanyId();
  return companyId ? `${baseKey}:${companyId}` : baseKey;
}

/**
 * Reads and parses a JSON cache entry from tenant-scoped localStorage.
 */
export function readTenantCache(baseKey, fallback = null, explicitCompanyId = null) {
  const companyId = explicitCompanyId || getActiveCompanyId();
  if (!companyId || typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(tenantStorageKey(baseKey, companyId));
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Writes a JSON cache entry into tenant-scoped localStorage and clears legacy un-namespaced keys.
 */
export function writeTenantCache(baseKey, value, explicitCompanyId = null) {
  const companyId = explicitCompanyId || getActiveCompanyId();
  if (!companyId || typeof localStorage === 'undefined') return;
  try {
    const scopedKey = tenantStorageKey(baseKey, companyId);
    if (value === null || value === undefined) {
      localStorage.removeItem(scopedKey);
    } else {
      localStorage.setItem(scopedKey, JSON.stringify(value));
    }
    localStorage.removeItem(baseKey);
  } catch {
    // ignore quota errors
  }
}

/**
 * Reads a plain string entry from tenant-scoped localStorage.
 */
export function readTenantString(baseKey, fallback = null, explicitCompanyId = null) {
  const companyId = explicitCompanyId || getActiveCompanyId();
  if (!companyId || typeof localStorage === 'undefined') return fallback;
  try {
    const val = localStorage.getItem(tenantStorageKey(baseKey, companyId));
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Writes a plain string entry into tenant-scoped localStorage.
 */
export function writeTenantString(baseKey, value, explicitCompanyId = null) {
  const companyId = explicitCompanyId || getActiveCompanyId();
  if (!companyId || typeof localStorage === 'undefined') return;
  try {
    const scopedKey = tenantStorageKey(baseKey, companyId);
    if (value === null || value === undefined || value === '') {
      localStorage.removeItem(scopedKey);
    } else {
      localStorage.setItem(scopedKey, String(value));
    }
    localStorage.removeItem(baseKey);
  } catch {
    // ignore storage failures
  }
}

/**
 * Removes both tenant-scoped and legacy keys for a given cache base name.
 */
export function removeTenantCache(baseKey, explicitCompanyId = null) {
  if (typeof localStorage === 'undefined') return;
  try {
    const companyId = explicitCompanyId || getActiveCompanyId();
    if (companyId) {
      localStorage.removeItem(tenantStorageKey(baseKey, companyId));
    }
    localStorage.removeItem(baseKey);
  } catch {
    // ignore storage errors
  }
}

/**
 * Stamps company_id onto an insert/upsert record or array of records.
 */
export function withCompanyId(recordOrArray, explicitCompanyId = null) {
  const companyId = explicitCompanyId || requireActiveCompanyId();
  if (Array.isArray(recordOrArray)) {
    return recordOrArray.map((item) => ({ ...item, company_id: companyId }));
  }
  return { ...recordOrArray, company_id: companyId };
}

/**
 * Clears all cached tenant data, Meta user tokens, and transient sessionStorage keys.
 * Preserves per-company namespaced BYO OpenRouter keys (`crm_openrouter_api_key:<companyId>`).
 */
export function clearTenantCaches() {
  if (typeof localStorage !== 'undefined') {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const matchesTenantData = TENANT_DATA_CACHE_PREFIXES.some(
          (prefix) => key === prefix || key.startsWith(`${prefix}:`)
        );
        if (matchesTenantData || UNNAMESPACED_LEGACY_KEYS.includes(key)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore storage cleanup errors
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('crm_skipped_pwd_upgrade');
      sessionStorage.removeItem('lateron_prefill');
    } catch {
      // ignore sessionStorage cleanup errors
    }
  }
}

/**
 * Persists the current tenant company record cleanly in localStorage,
 * purging prior tenant caches synchronously if switching companies.
 */
export function setActiveCompanyCache(company) {
  try {
    const previousCompanyId = getActiveCompanyId();
    if (company?.id && previousCompanyId && previousCompanyId !== company.id) {
      clearTenantCaches();
    }
    if (company) {
      localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, JSON.stringify(company));
    } else {
      localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

