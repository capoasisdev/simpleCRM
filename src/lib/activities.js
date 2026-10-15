import { supabase } from './supabase';

const ACTIVITIES_STORAGE_KEY = 'crm_lead_activities';

/**
 * Fetch recorded activities from localStorage and optionally Supabase
 */
export const getStoredActivities = () => {
  try {
    const raw = localStorage.getItem(ACTIVITIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Error reading stored activities:', err);
    return [];
  }
};

export const recordActivity = async ({
  type = 'stage_change',
  leadId,
  leadName,
  fromStage,
  toStage,
  assignedTo,
  userName,
  details
}) => {
  const newActivity = {
    id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    type,
    lead_id: leadId,
    lead_name: leadName || 'Unnamed Lead',
    from_stage: fromStage,
    to_stage: toStage,
    assigned_to: assignedTo || '',
    user_name: userName || '',
    details: details || '',
    created_at: new Date().toISOString()
  };

  // 1. Save to localStorage immediately (keeps last 100 activities)
  try {
    const current = getStoredActivities();
    const updated = [newActivity, ...current.filter((a) => a.id !== newActivity.id)].slice(0, 100);
    localStorage.setItem(ACTIVITIES_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Error saving activity to localStorage:', err);
  }

  // 2. Dispatch cross-component event for immediate reactivity
  try {
    window.dispatchEvent(
      new CustomEvent('crm-activity-logged', { detail: newActivity })
    );
  } catch (err) {
    // ignore in non-browser envs
  }

  // 3. Attempt to save to Supabase lead_activities table in the background
  try {
    const payload = {
      lead_name: newActivity.lead_name,
      type: newActivity.type,
      from_stage: newActivity.from_stage,
      to_stage: newActivity.to_stage,
      assigned_to: newActivity.assigned_to,
      user_name: newActivity.user_name,
      details: newActivity.details || null
    };
    if (leadId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId)) {
      payload.lead_id = leadId;
    }
    await supabase.from('lead_activities').insert([payload]);
  } catch (err) {
    // Non-blocking: table might not exist in Supabase yet
  }

  return newActivity;
};

/**
 * Fetch and assemble complete activity timeline for a specific lead
 */
export const fetchLeadActivities = async (lead) => {
  if (!lead) return [];

  // 1. Local activities for this lead
  const localAll = getStoredActivities();
  const localForLead = localAll.filter(
    (a) =>
      (lead.id && a.lead_id === lead.id) ||
      (lead.name && a.lead_name && a.lead_name.trim().toLowerCase() === lead.name.trim().toLowerCase())
  );

  // 2. Fetch from Supabase lead_activities if lead has a valid UUID or lead name
  let remoteForLead = [];
  try {
    const isUuid = lead.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lead.id);
    let query = supabase.from('lead_activities').select('*');
    if (isUuid && lead.name) {
      query = query.or(`lead_id.eq.${lead.id},lead_name.eq.${lead.name}`);
    } else if (isUuid) {
      query = query.eq('lead_id', lead.id);
    } else if (lead.name) {
      query = query.eq('lead_name', lead.name);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      remoteForLead = data;
    }
  } catch (err) {
    // Non-blocking fallback
  }

  // 3. Merge local and remote by id
  const seenIds = new Set();
  const combined = [];
  [...localForLead, ...remoteForLead].forEach((act) => {
    const key = act.id || `${act.type}-${act.created_at}-${act.to_stage || act.assigned_to}`;
    if (!seenIds.has(key)) {
      seenIds.add(key);
      combined.push(act);
    }
  });

  // 4. Ensure baseline arrival event is present
  const hasArrival = combined.some(
    (a) => a.type === 'lead_created' || a.type === 'arrival' || a.type === 'lead_received'
  );
  if (!hasArrival) {
    let arrivalTime = lead.created_at;
    if (!arrivalTime && lead.date) {
      const match = String(lead.date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (match) {
        arrivalTime = new Date(`${match[3]}-${match[2]}-${match[1]}T09:00:00Z`).toISOString();
      } else {
        const d = new Date(lead.date);
        arrivalTime = !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
      }
    }
    if (!arrivalTime || isNaN(new Date(arrivalTime).getTime())) {
      arrivalTime = new Date().toISOString();
    }

    combined.push({
      id: `synthetic-arrival-${lead.id || 'new'}`,
      type: 'lead_created',
      lead_id: lead.id,
      lead_name: lead.name,
      to_stage: lead.stage || 'new',
      source: lead.form_name || lead.source || 'Meta Ad Campaign',
      created_at: arrivalTime,
      is_synthesized: true
    });
  }

  // 5. Ensure baseline assignment event is present if assigned
  const assignee = lead.assigned_to || lead.assignedTo;
  const hasAssignment = combined.some((a) => a.type === 'assignment');
  if (!hasAssignment && assignee && assignee !== 'unassigned') {
    let assignTime = lead.created_at;
    if (assignTime) {
      const d = new Date(assignTime);
      d.setMinutes(d.getMinutes() + 1);
      assignTime = d.toISOString();
    } else {
      assignTime = new Date().toISOString();
    }

    combined.push({
      id: `synthetic-assignment-${lead.id || 'assign'}`,
      type: 'assignment',
      lead_id: lead.id,
      lead_name: lead.name,
      assigned_to: assignee,
      user_name: 'Lead Routing',
      created_at: assignTime,
      is_synthesized: true
    });
  }

  // 6. Sort all chronologically descending (newest first)
  combined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return combined;
};
