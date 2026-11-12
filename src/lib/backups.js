/**
 * backups.js - Full 7-Day Rolling CRM Backups & Recovery Engine
 */
import { supabase } from './supabase';
import { getActiveCompanyId, requireActiveCompanyId, readTenantCache, writeTenantCache, withCompanyId } from './tenant';

const BACKUP_STORAGE_KEY = 'crm_rolling_backups';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function getLocalBackups() {
  const parsed = readTenantCache(BACKUP_STORAGE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveLocalBackups(backups) {
  writeTenantCache(BACKUP_STORAGE_KEY, backups);
}

/**
 * Prunes backups older than 7 days from Supabase and localStorage
 */
export async function pruneOldBackups() {
  const cutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  // 1. Prune local storage
  const local = getLocalBackups();
  const freshLocal = local.filter((b) => new Date(b.created_at).getTime() >= Date.now() - SEVEN_DAYS_MS);
  saveLocalBackups(freshLocal);

  // 2. Prune Supabase table
  const companyId = getActiveCompanyId();
  if (!companyId) return;
  try {
    await supabase.from('crm_backups').delete().eq('company_id', companyId).lt('created_at', cutoffIso);
  } catch (e) {
    console.warn('Note on Supabase backup pruning:', e.message);
  }
}

/**
 * Fetch all available backups (combining Supabase + Local storage)
 */
export async function fetchBackups() {
  await pruneOldBackups();
  let supabaseBackups = [];
  const companyId = getActiveCompanyId();

  if (companyId) {
    try {
      const { data, error } = await supabase
        .from('crm_backups')
        .select('id, created_at, backup_name, backup_type, record_counts, file_size_bytes, created_by')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        supabaseBackups = data;
      }
    } catch (e) {
      console.warn('Supabase crm_backups query note:', e.message);
    }
  }

  const local = getLocalBackups();

  // Merge & deduplicate by ID or close timestamp
  const seen = new Set();
  const merged = [];

  [...supabaseBackups, ...local].forEach((b) => {
    const key = b.id || b.created_at;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(b);
    }
  });

  return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Creates a full disk snapshot of all CRM tables
 */
export async function createFullBackup({ type = 'manual', createdBy = 'Admin' } = {}) {
  const companyId = requireActiveCompanyId();
  const now = new Date();
  const backupName = type === 'auto' ? 'Daily Auto-Backup' : 'Manual Snapshot';

  // 1. Fetch data across all core CRM tables concurrently
  const [
    leadsRes,
    usersRes,
    followUpsRes,
    activitiesRes,
    pipelinesRes,
    routingRes,
    todoListsRes,
    todosRes
  ] = await Promise.allSettled([
    supabase.from('leads').select('*').eq('company_id', companyId),
    supabase.from('crm_users').select('id, name, email, role, permissions, created_at').eq('company_id', companyId),
    supabase.from('follow_ups').select('*').eq('company_id', companyId),
    supabase.from('lead_activities').select('*').eq('company_id', companyId).limit(2000),
    supabase.from('pipelines').select('*').eq('company_id', companyId),
    supabase.from('lead_routing_config').select('*').eq('company_id', companyId),
    supabase.from('crm_todo_lists').select('*').eq('company_id', companyId),
    supabase.from('crm_todos').select('*').eq('company_id', companyId)
  ]);

  const leads = leadsRes.status === 'fulfilled' && !leadsRes.value.error ? leadsRes.value.data : [];
  const users = usersRes.status === 'fulfilled' && !usersRes.value.error ? usersRes.value.data : [];
  const followUps = followUpsRes.status === 'fulfilled' && !followUpsRes.value.error ? followUpsRes.value.data : [];
  const activities = activitiesRes.status === 'fulfilled' && !activitiesRes.value.error ? activitiesRes.value.data : [];
  const pipelines = pipelinesRes.status === 'fulfilled' && !pipelinesRes.value.error ? pipelinesRes.value.data : [];
  const routing = routingRes.status === 'fulfilled' && !routingRes.value.error ? routingRes.value.data : [];

  const cachedLists = readTenantCache('crm_todo_lists_cache', [], companyId) || [];
  const cachedTodos = readTenantCache('crm_todos_cache', [], companyId) || [];

  const todoLists = todoListsRes.status === 'fulfilled' && !todoListsRes.value.error && todoListsRes.value.data?.length > 0
    ? todoListsRes.value.data
    : cachedLists;

  const todos = todosRes.status === 'fulfilled' && !todosRes.value.error && todosRes.value.data?.length > 0
    ? todosRes.value.data
    : cachedTodos;

  // Local settings fallback
  const localPipeline = readTenantCache('crm_pipeline_columns', null, companyId);

  const fullPayload = {
    version: '1.0',
    crm: 'simplecrm',
    backup_name: backupName,
    created_at: now.toISOString(),
    created_by: createdBy,
    backup_type: type,
    record_counts: {
      leads: leads.length,
      users: users.length,
      follow_ups: followUps.length,
      activities: activities.length,
      pipelines: pipelines.length || (localPipeline ? 1 : 0),
      todo_lists: todoLists.length,
      todos: todos.length
    },
    data: {
      leads,
      crm_users: users,
      follow_ups: followUps,
      lead_activities: activities,
      pipelines,
      lead_routing_config: routing,
      local_pipeline_columns: localPipeline,
      crm_todo_lists: todoLists,
      crm_todos: todos
    }
  };

  const payloadString = JSON.stringify(fullPayload);
  const fileSizeBytes = new Blob([payloadString]).size;

  const backupMeta = {
    id: `backup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    created_at: now.toISOString(),
    backup_name: backupName,
    backup_type: type,
    record_counts: fullPayload.record_counts,
    file_size_bytes: fileSizeBytes,
    created_by: createdBy
  };

  // 2. Persist in Supabase crm_backups table
  try {
    const { data, error } = await supabase.from('crm_backups').insert([
      {
        company_id: companyId,
        backup_name: backupName,
        backup_type: type,
        record_counts: fullPayload.record_counts,
        file_size_bytes: fileSizeBytes,
        created_by: createdBy,
        payload: fullPayload
      }
    ]).select().single();

    if (!error && data) {
      backupMeta.id = data.id;
    }
  } catch (e) {
    console.warn('Note saving backup to Supabase crm_backups:', e.message);
  }

  // 3. Persist in Local Storage (up to 7 days)
  const localList = getLocalBackups();
  const updatedLocal = [{ ...backupMeta, payload: fullPayload }, ...localList].slice(0, 14);
  saveLocalBackups(updatedLocal);

  await pruneOldBackups();
  return { ...backupMeta, payload: fullPayload };
}

/**
 * Loads the full JSON payload for a backup snapshot (in-memory -> Supabase -> localStorage fallback)
 */
export async function loadBackupPayload(backup) {
  if (!backup) {
    throw new Error('Backup data payload could not be loaded.');
  }
  if (backup.payload) {
    return backup.payload;
  }

  const activeCompanyId = getActiveCompanyId();
  if (activeCompanyId && backup.id && !String(backup.id).startsWith('backup_')) {
    try {
      const { data, error } = await supabase
        .from('crm_backups')
        .select('payload')
        .eq('id', backup.id)
        .eq('company_id', activeCompanyId)
        .single();
      if (!error && data?.payload) {
        return data.payload;
      }
    } catch (e) {
      console.warn('Error fetching backup payload:', e);
    }
  }

  const local = getLocalBackups().find((b) => b.id === backup.id);
  if (local?.payload) {
    return local.payload;
  }

  throw new Error('Backup data payload could not be loaded.');
}

/**
 * Downloads a backup snapshot as a physical .json file to the user's disk
 */
export async function downloadBackupToDisk(backup) {
  const payload = await loadBackupPayload(backup);

  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  const fileDate = new Date(backup.created_at || Date.now())
    .toISOString()
    .slice(0, 10);
  link.setAttribute('download', `simplecrm-backup-${fileDate}-${backup.backup_type || 'full'}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Restores CRM state from a backup payload
 */
export async function restoreBackupData(payload) {
  if (!payload || !payload.data) {
    throw new Error('Invalid backup file format. Missing data section.');
  }

  const companyId = requireActiveCompanyId();

  const results = {
    leadsRestored: 0,
    followUpsRestored: 0,
    pipelinesRestored: false
  };

  const { leads, follow_ups, local_pipeline_columns } = payload.data;

  // 1. Restore Leads
  if (Array.isArray(leads) && leads.length > 0) {
    try {
      const scopedLeads = leads.map((row) => ({ ...row, company_id: companyId }));
      const { error } = await supabase
        .from('leads')
        .upsert(scopedLeads, { onConflict: 'id' });
      if (!error) {
        results.leadsRestored = scopedLeads.length;
      }
    } catch (e) {
      console.warn('Error restoring leads to Supabase:', e);
    }
  }

  // 2. Restore Follow-ups
  if (Array.isArray(follow_ups) && follow_ups.length > 0) {
    try {
      const scopedFollowUps = follow_ups.map((row) => ({ ...row, company_id: companyId }));
      const { error } = await supabase
        .from('follow_ups')
        .upsert(scopedFollowUps, { onConflict: 'id' });
      if (!error) {
        results.followUpsRestored = scopedFollowUps.length;
      }
    } catch (e) {
      console.warn('Error restoring follow-ups to Supabase:', e);
    }
  }

  // 3. Restore Pipeline Columns in localStorage
  if (local_pipeline_columns) {
    writeTenantCache('crm_pipeline_columns', local_pipeline_columns, companyId);
    results.pipelinesRestored = true;
  }

  // 4. Restore To-Do Lists and Tasks
  const { crm_todo_lists, crm_todos } = payload.data;
  if (Array.isArray(crm_todo_lists) && crm_todo_lists.length > 0) {
    const scopedLists = withCompanyId(crm_todo_lists, companyId);
    try {
      await supabase.from('crm_todo_lists').upsert(scopedLists, { onConflict: 'id' });
    } catch (e) {
      console.warn('Note restoring crm_todo_lists to Supabase:', e);
    }
    writeTenantCache('crm_todo_lists_cache', scopedLists, companyId);
    results.todoListsRestored = scopedLists.length;
  }

  if (Array.isArray(crm_todos) && crm_todos.length > 0) {
    const scopedTodos = withCompanyId(crm_todos, companyId);
    try {
      await supabase.from('crm_todos').upsert(scopedTodos, { onConflict: 'id' });
    } catch (e) {
      console.warn('Note restoring crm_todos to Supabase:', e);
    }
    writeTenantCache('crm_todos_cache', scopedTodos, companyId);
    results.todosRestored = scopedTodos.length;
  }

  return results;
}

/**
 * Runs a daily auto-backup if no backup was performed today
 */
export async function checkAndRunDailyAutoBackup(currentUser) {
  try {
    const backups = await fetchBackups();
    const now = new Date();
    const todayYMD = now.toISOString().slice(0, 10);

    const hasBackupToday = backups.some((b) => {
      const bYMD = new Date(b.created_at).toISOString().slice(0, 10);
      return bYMD === todayYMD;
    });

    if (!hasBackupToday) {
      console.info('Initiating daily automated CRM backup...');
      await createFullBackup({
        type: 'auto',
        createdBy: currentUser?.name ? `${currentUser.name} (Auto)` : 'Daily Automated Scheduler'
      });
      console.info('Daily automated CRM backup completed.');
    }
  } catch (err) {
    console.warn('Notice on automated backup scheduler:', err);
  }
}
