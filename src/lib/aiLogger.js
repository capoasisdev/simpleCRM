import { supabase } from './supabase';

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

  const logPayload = {
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

    await supabase
      .from('ai_chat_logs')
      .update({ feedback })
      .eq('id', logId);
  } catch (err) {
    console.warn('Silent feedback update error:', err);
  }
}

function saveLogLocally(entry) {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_LOGS_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    existing.push(entry);
    if (existing.length > 100) existing.shift();
    localStorage.setItem(LOCAL_STORAGE_LOGS_KEY, JSON.stringify(existing));
  } catch {}
}

function updateLocalFeedback(localId, feedback) {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_LOGS_KEY);
    if (!raw) return;
    const existing = JSON.parse(raw);
    const updated = existing.map((e) => (e.id === localId ? { ...e, feedback } : e));
    localStorage.setItem(LOCAL_STORAGE_LOGS_KEY, JSON.stringify(updated));
  } catch {}
}
