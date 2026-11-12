import { supabase } from './supabase';
import { getActiveCompanyId, readTenantCache, writeTenantCache } from './tenant';

const LOCAL_STORAGE_LOGS_KEY = 'crm_ai_chat_logs_cache';

/**
 * Log an AI conversation turn silently to Supabase and local cache
 */
export async function logAiInteraction({
  sessionId,
  userQuery,
  assistantResponse,
  modelUsed = 'unknown',
  currentUser = {},
  metadata = {}
}) {
  if (!userQuery || !assistantResponse) return null;

  const companyId = getActiveCompanyId();
  const logPayload = {
    ...(companyId ? { company_id: companyId } : {}),
    session_id: sessionId || null,
    user_id: currentUser?.id || currentUser?.uid || null,
    user_name: currentUser?.name || currentUser?.email || 'Anonymous',
    user_role: currentUser?.role || 'member',
    user_query: userQuery.trim(),
    assistant_response: assistantResponse.trim(),
    model_used: modelUsed,
    feedback: null,
    metadata: metadata || {}
  };

  if (!companyId) {
    const localId = `local-${Date.now()}`;
    saveLogLocally({ ...logPayload, id: localId });
    return localId;
  }

  try {
    const { data, error } = await supabase
      .from('ai_chat_logs')
      .insert([logPayload])
      .select('id')
      .single();

    if (error) {
      console.warn('Supabase ai_chat_logs insert notice (run migration to create table):', error.message);
      const localId = `local-${Date.now()}`;
      saveLogLocally({ ...logPayload, id: localId });
      return localId;
    }

    return data?.id || null;
  } catch (err) {
    console.warn('Silent ai_chat_logs network error:', err);
    const localId = `local-${Date.now()}`;
    saveLogLocally({ ...logPayload, id: localId });
    return localId;
  }
}

/**
 * Update feedback (thumbs_up / thumbs_down) for a specific log entry
 */
export async function updateAiFeedback(logId, feedback) {
  if (!logId) return;

  try {
    if (logId.startsWith('local-')) {
      updateLocalFeedback(logId, feedback);
      return;
    }

    const companyId = getActiveCompanyId();
    if (!companyId) return;

    await supabase
      .from('ai_chat_logs')
      .update({ feedback })
      .eq('id', logId)
      .eq('company_id', companyId);
  } catch (err) {
    console.warn('Silent feedback update error:', err);
  }
}

function saveLogLocally(entry) {
  try {
    const existing = readTenantCache(LOCAL_STORAGE_LOGS_KEY, []);
    const list = Array.isArray(existing) ? existing : [];
    list.push(entry);
    if (list.length > 100) list.shift();
    writeTenantCache(LOCAL_STORAGE_LOGS_KEY, list);
  } catch {}
}

function updateLocalFeedback(localId, feedback) {
  try {
    const existing = readTenantCache(LOCAL_STORAGE_LOGS_KEY, []);
    if (!Array.isArray(existing) || existing.length === 0) return;
    const updated = existing.map((e) => (e.id === localId ? { ...e, feedback } : e));
    writeTenantCache(LOCAL_STORAGE_LOGS_KEY, updated);
  } catch {}
}
