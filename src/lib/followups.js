import { supabase } from './supabase';
import { recordActivity } from './activities';

const FOLLOWUPS_STORAGE_KEY = 'crm_lead_followups';

/**
 * Read cached follow-ups from localStorage
 */
export const getStoredFollowUps = () => {
  try {
    const raw = localStorage.getItem(FOLLOWUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Error reading stored follow-ups:', err);
    return [];
  }
};

/**
 * Fetch all follow-ups from Supabase with fallback to local storage
 */
export const fetchFollowUps = async () => {
  const local = getStoredFollowUps();
  try {
    const { data, error } = await supabase
      .from('follow_ups')
      .select('*')
      .order('due_date', { ascending: true });

    if (!error && Array.isArray(data)) {
      localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(data));
      return data;
    }
  } catch (err) {
    console.warn('Error fetching follow-ups:', err);
  }
  return local;
};

/**
 * Save / Create a new Follow-up
 */
export const createFollowUp = async ({
  leadId,
  leadName,
  leadPhone,
  leadEmail,
  title,
  description,
  dueDate,
  userName
}) => {
  let newFollowUp = {
    id: `fu-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    lead_id: leadId || null,
    lead_name: leadName || 'Unnamed Lead',
    lead_phone: leadPhone || '',
    lead_email: leadEmail || '',
    title: title.trim(),
    description: (description || '').trim(),
    due_date: dueDate,
    status: 'pending', // 'pending' | 'completed'
    created_at: new Date().toISOString(),
    created_by: userName || 'Admin'
  };

  // 1. Optimistic update to localStorage
  try {
    const current = getStoredFollowUps();
    const updated = [newFollowUp, ...current.filter((f) => f.id !== newFollowUp.id)];
    localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Error caching follow-up:', e);
  }

  // 2. Broadcast local event
  window.dispatchEvent(new CustomEvent('crm-followups-updated', { detail: newFollowUp }));

  // 3. Record in Activity Log
  try {
    recordActivity({
      type: 'followup_scheduled',
      leadId,
      leadName,
      userName,
      details: `Scheduled follow-up: "${newFollowUp.title}" for ${new Date(dueDate).toLocaleString()}`
    });
  } catch (e) { }

  // 4. Save to Supabase and update local cache with database row
  try {
    const payload = {
      title: newFollowUp.title,
      description: newFollowUp.description,
      due_date: newFollowUp.due_date,
      status: newFollowUp.status,
      created_by: newFollowUp.created_by,
      lead_name: newFollowUp.lead_name,
      lead_phone: newFollowUp.lead_phone,
      lead_email: newFollowUp.lead_email
    };
    if (leadId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId)) {
      payload.lead_id = leadId;
    }
    const { data, error } = await supabase.from('follow_ups').insert([payload]).select().single();
    if (data && !error) {
      newFollowUp = data;
      const current = getStoredFollowUps();
      const updated = current.map((f) => (f.id === newFollowUp.id || f.id.startsWith('fu-') && f.title === newFollowUp.title ? data : f));
      localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('crm-followups-updated', { detail: data }));
    } else if (error) {
      console.warn('Supabase follow-up insert error:', error.message);
    }
  } catch (err) {
    console.warn('Error saving follow-up to Supabase:', err);
  }

  return newFollowUp;
};

/**
 * Mark a follow-up as completed
 */
export const completeFollowUp = async (id, userName) => {
  const current = getStoredFollowUps();
  const target = current.find((f) => f.id === id);
  const updated = current.map((f) =>
    f.id === id ? { ...f, status: 'completed', completed_at: new Date().toISOString() } : f
  );
  localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent('crm-followups-updated', { detail: { id, status: 'completed' } }));

  if (target) {
    recordActivity({
      type: 'followup_completed',
      leadId: target.lead_id,
      leadName: target.lead_name,
      userName,
      details: `Completed follow-up: "${target.title}"`
    });
  }

  try {
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      await supabase.from('follow_ups').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id);
    }
  } catch (e) { }

  return updated;
};

/**
 * Reopen / Mark a follow-up as pending
 */
export const reopenFollowUp = async (id, userName) => {
  const current = getStoredFollowUps();
  const target = current.find((f) => f.id === id);
  const updated = current.map((f) =>
    f.id === id ? { ...f, status: 'pending', completed_at: null } : f
  );
  localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent('crm-followups-updated', { detail: { id, status: 'pending' } }));

  if (target) {
    recordActivity({
      type: 'followup_reopened',
      leadId: target.lead_id,
      leadName: target.lead_name,
      userName,
      details: `Reopened follow-up: "${target.title}"`
    });
  }

  try {
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      await supabase.from('follow_ups').update({ status: 'pending', completed_at: null }).eq('id', id);
    }
  } catch (e) { }

  return updated;
};

/**
 * Helper to check follow-up urgency ('overdue' | 'today' | 'upcoming')
 */
export const getFollowUpUrgency = (dueDateStr) => {
  if (!dueDateStr) return 'upcoming';
  const due = new Date(dueDateStr);
  if (isNaN(due.getTime())) return 'upcoming';

  const now = new Date();
  if (due < now) {
    // Check if it was earlier today
    if (
      due.getDate() === now.getDate() &&
      due.getMonth() === now.getMonth() &&
      due.getFullYear() === now.getFullYear()
    ) {
      return 'today';
    }
    return 'overdue';
  }

  if (
    due.getDate() === now.getDate() &&
    due.getMonth() === now.getMonth() &&
    due.getFullYear() === now.getFullYear()
  ) {
    return 'today';
  }

  return 'upcoming';
};

/**
 * Format follow-up date for display
 */
export const formatFollowUpTime = (dueDateStr) => {
  if (!dueDateStr) return '';
  const due = new Date(dueDateStr);
  if (isNaN(due.getTime())) return dueDateStr;

  const now = new Date();
  const timeStr = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const isToday =
    due.getDate() === now.getDate() &&
    due.getMonth() === now.getMonth() &&
    due.getFullYear() === now.getFullYear();

  if (isToday) {
    return `Today, ${timeStr}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    due.getDate() === tomorrow.getDate() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getFullYear() === tomorrow.getFullYear();

  if (isTomorrow) {
    return `Tomorrow, ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    due.getDate() === yesterday.getDate() &&
    due.getMonth() === yesterday.getMonth() &&
    due.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  const dateStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateStr}, ${timeStr}`;
};

/**
 * Delete / Cancel a follow-up
 */
export const deleteFollowUp = async (id, userName) => {
  if (!id) return [];

  const current = getStoredFollowUps();
  const target = current.find((f) => f.id === id);

  // 1. Delete from Supabase FIRST so database is updated before any event or fetch
  try {
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      await supabase.from('follow_ups').delete().eq('id', id);
    } else if (target) {
      if (target.lead_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.lead_id)) {
        await supabase.from('follow_ups').delete().eq('lead_id', target.lead_id).eq('title', target.title);
      } else if (target.lead_name) {
        await supabase.from('follow_ups').delete().eq('lead_name', target.lead_name).eq('title', target.title);
      }
    }
  } catch (e) {
    console.warn('Error deleting follow-up from Supabase:', e);
  }

  // 2. Remove from local storage (by id and matching title/lead)
  const updated = current.filter((f) => {
    if (f.id === id) return false;
    if (target && target.title && f.title === target.title && (
      (target.lead_id && f.lead_id === target.lead_id) ||
      (target.lead_name && f.lead_name === target.lead_name)
    )) {
      return false;
    }
    return true;
  });
  localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(updated));

  // 3. Record in Activity Log
  if (target) {
    try {
      recordActivity({
        type: 'followup_deleted',
        leadId: target.lead_id,
        leadName: target.lead_name,
        userName,
        details: `Removed follow-up: "${target.title}"`
      });
    } catch (e) { }
  }

  // 4. Broadcast event ONLY AFTER Supabase deletion completes
  window.dispatchEvent(new CustomEvent('crm-followups-updated', { detail: { id, deleted: true } }));

  return updated;
};

