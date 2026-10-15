/**
 * backups.js - Full 7-Day Rolling CRM Backups & Recovery Engine
 */
import { supabase } from './supabase';

const BACKUP_STORAGE_KEY = 'crm_rolling_backups';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function getLocalBackups() {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Error reading local backups:', e);
    return [];
  }
}

export function saveLocalBackups(backups) {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backups));
  } catch (e) {
    console.warn('Error saving local backups:', e);
  }
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
  try {
    await supabase.from('crm_backups').delete().lt('created_at', cutoffIso);
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

  try {
    const { data, error } = await supabase
      .from('crm_backups')
      .select('id, created_at, backup_name, backup_type, record_counts, file_size_bytes, created_by')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      supabaseBackups = data;
    }
  } catch (e) {
    console.warn('Supabase crm_backups query note:', e.message);
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
    supabase.from('leads').select('*'),
    supabase.from('crm_users').select('id, name, email, role, permissions, created_at'),
    supabase.from('follow_ups').select('*'),
    supabase.from('lead_activities').select('*').limit(2000),
    supabase.from('pipelines').select('*'),
    supabase.from('lead_routing_config').select('*'),
    supabase.from('crm_todo_lists').select('*'),
    supabase.from('crm_todos').select('*')
  ]);

  const leads = leadsRes.status === 'fulfilled' && !leadsRes.value.error ? leadsRes.value.data : [];
  const users = usersRes.status === 'fulfilled' && !usersRes.value.error ? usersRes.value.data : [];
  const followUps = followUpsRes.status === 'fulfilled' && !followUpsRes.value.error ? followUpsRes.value.data : [];
  const activities = activitiesRes.status === 'fulfilled' && !activitiesRes.value.error ? activitiesRes.value.data : [];
  const pipelines = pipelinesRes.status === 'fulfilled' && !pipelinesRes.value.error ? pipelinesRes.value.data : [];
  const routing = routingRes.status === 'fulfilled' && !routingRes.value.error ? routingRes.value.data : [];

  let cachedLists = [];
  let cachedTodos = [];
  try {
    cachedLists = JSON.parse(localStorage.getItem('crm_todo_lists_cache')) || [];
    cachedTodos = JSON.parse(localStorage.getItem('crm_todos_cache')) || [];
  } catch {}

  const todoLists = todoListsRes.status === 'fulfilled' && !todoListsRes.value.error && todoListsRes.value.data?.length > 0
    ? todoListsRes.value.data
    : cachedLists;

  const todos = todosRes.status === 'fulfilled' && !todosRes.value.error && todosRes.value.data?.length > 0
    ? todosRes.value.data
    : cachedTodos;

  // Local settings fallback
  let localPipeline = null;
  try {
    localPipeline = JSON.parse(localStorage.getItem('crm_pipeline_columns'));
  } catch {}

  const fullPayload = {
    version: '1.0',
    crm: 'SimpleCRM',
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
 * Downloads a backup snapshot as a physical .json file to the user's disk
 */
export async function downloadBackupToDisk(backup) {
  let payload = backup.payload;

  // If payload wasn't pre-loaded, fetch it from Supabase
  if (!payload && backup.id && !backup.id.startsWith('backup_')) {
    try {
      const { data, error } = await supabase
        .from('crm_backups')
        .select('payload')
        .eq('id', backup.id)
        .single();
      if (!error && data?.payload) {
        payload = data.payload;
      }
    } catch (e) {
      console.warn('Error fetching backup payload:', e);
    }
  }

  if (!payload) {
    // Check local storage fallback
    const local = getLocalBackups().find((b) => b.id === backup.id);
    if (local?.payload) {
      payload = local.payload;
    }
  }

  if (!payload) {
    throw new Error('Backup data payload could not be loaded.');
  }

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

  const results = {
    leadsRestored: 0,
    followUpsRestored: 0,
    pipelinesRestored: false
  };

  const { leads, follow_ups, local_pipeline_columns } = payload.data;

  // 1. Restore Leads
  if (Array.isArray(leads) && leads.length > 0) {
    try {
      const { error } = await supabase
        .from('leads')
        .upsert(leads, { onConflict: 'id' });
      if (!error) {
        results.leadsRestored = leads.length;
      }
    } catch (e) {
      console.warn('Error restoring leads to Supabase:', e);
    }
  }

  // 2. Restore Follow-ups
  if (Array.isArray(follow_ups) && follow_ups.length > 0) {
    try {
      const { error } = await supabase
        .from('follow_ups')
        .upsert(follow_ups, { onConflict: 'id' });
      if (!error) {
        results.followUpsRestored = follow_ups.length;
      }
    } catch (e) {
      console.warn('Error restoring follow-ups to Supabase:', e);
    }
  }

  // 3. Restore Pipeline Columns in localStorage
  if (local_pipeline_columns) {
    localStorage.setItem('crm_pipeline_columns', JSON.stringify(local_pipeline_columns));
    results.pipelinesRestored = true;
  }

  // 4. Restore To-Do Lists and Tasks
  const { crm_todo_lists, crm_todos } = payload.data;
  if (Array.isArray(crm_todo_lists) && crm_todo_lists.length > 0) {
    try {
      await supabase.from('crm_todo_lists').upsert(crm_todo_lists, { onConflict: 'id' });
    } catch (e) {
      console.warn('Note restoring crm_todo_lists to Supabase:', e);
    }
    localStorage.setItem('crm_todo_lists_cache', JSON.stringify(crm_todo_lists));
    results.todoListsRestored = crm_todo_lists.length;
  }

  if (Array.isArray(crm_todos) && crm_todos.length > 0) {
    try {
      await supabase.from('crm_todos').upsert(crm_todos, { onConflict: 'id' });
    } catch (e) {
      console.warn('Note restoring crm_todos to Supabase:', e);
    }
    localStorage.setItem('crm_todos_cache', JSON.stringify(crm_todos));
    results.todosRestored = crm_todos.length;
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
