import { supabase } from './supabase';

const STORAGE_KEY = 'crm_sticky_notes_v2';

export const STICKY_COLORS = [
  { id: 'yellow', name: 'Yellow', bg: '#fef9c3', border: '#fef08a', accent: '#ca8a04', text: '#713f12', tagBg: '#fef08a' },
  { id: 'green', name: 'Green', bg: '#dcfce7', border: '#bbf7d0', accent: '#16a34a', text: '#14532d', tagBg: '#bbf7d0' },
  { id: 'blue', name: 'Blue', bg: '#e0f2fe', border: '#bae6fd', accent: '#0284c7', text: '#0c4a6e', tagBg: '#bae6fd' }
];

export const DEFAULT_COLOR = 'yellow';

/**
 * Synchronous local cache reader for instant UI render
 */
export function getCachedNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Error reading cached sticky notes:', err);
    return [];
  }
}

/**
 * Synchronous local cache writer
 */
export function setCachedNotes(notes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (err) {
    console.warn('Error writing sticky notes cache:', err);
  }
}

/**
 * Normalizes a raw Supabase crm_todos record into a sticky note object
 */
function normalizeNote(row) {
  let isChecklist = row.stage_id === 'checklist';
  let checklist = [];
  let content = row.description || '';

  if (isChecklist) {
    try {
      checklist = JSON.parse(content);
      if (!Array.isArray(checklist)) checklist = [];
    } catch {
      checklist = [];
      isChecklist = false;
    }
  }

  const validColorIds = STICKY_COLORS.map(c => c.id);
  const color = validColorIds.includes(row.priority) ? row.priority : 'yellow';

  return {
    id: String(row.id),
    title: row.title || '',
    content: isChecklist ? '' : content,
    isChecklist,
    checklist,
    color,
    isPinned: Boolean(row.is_completed),
    createdAt: row.created_at || new Date().toISOString(),
    createdBy: row.created_by || 'Me',
    assignedTo: row.assigned_to || null
  };
}

/**
 * Fetch all sticky notes from Supabase with local cache sync
 */
export async function fetchStickyNotes() {
  try {
    const { data, error } = await supabase
      .from('crm_todos')
      .select('*')
      .order('is_completed', { ascending: false }) // pinned first
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      const notes = data.map(normalizeNote);
      setCachedNotes(notes);
      return notes;
    }
  } catch (err) {
    console.warn('Could not fetch remote sticky notes:', err);
  }

  return getCachedNotes();
}

/**
/**
 * Create a new sticky note synchronously with instant cache update and background Supabase sync
 */
export function createStickyNoteSync({
  title = '',
  content = '',
  isChecklist = false,
  checklist = [],
  color = 'yellow',
  isPinned = false,
  currentUser = null
}) {
  const newId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const createdBy = currentUser?.name || currentUser?.email || 'Me';
  const descriptionPayload = isChecklist ? JSON.stringify(checklist) : content;

  const newNote = {
    id: newId,
    title,
    content: isChecklist ? '' : content,
    isChecklist,
    checklist,
    color,
    isPinned,
    createdAt: new Date().toISOString(),
    createdBy
  };

  // 1. Immediately update local cache synchronously
  const current = getCachedNotes();
  const updated = [...current.filter(n => n.id !== newId), newNote];
  setCachedNotes(updated);

  // 2. Persist to Supabase asynchronously in background (0ms UI latency)
  (async () => {
    try {
      const payload = {
        id: newId,
        title: title || '',
        description: descriptionPayload,
        priority: color,
        stage_id: isChecklist ? 'checklist' : 'note',
        is_completed: isPinned,
        created_by: createdBy
      };

      await supabase
        .from('crm_todos')
        .insert([payload]);
    } catch (err) {
      console.warn('Failed to insert sticky note to Supabase in background:', err);
    }
  })();

  return newNote;
}

export function createStickyNote(params) {
  return createStickyNoteSync(params);
}

/**
 * Update an existing sticky note
 */
export async function updateStickyNote(id, changes) {
  // 1. Update local cache immediately
  const current = getCachedNotes();
  let updatedNote = null;
  const updatedList = current.map(note => {
    if (note.id === id) {
      updatedNote = { ...note, ...changes };
      return updatedNote;
    }
    return note;
  });

  if (updatedNote) {
    setCachedNotes(updatedList);
  }

  // 2. Persist changes to Supabase
  try {
    const payload = {};
    if (changes.title !== undefined) payload.title = changes.title;
    if (changes.color !== undefined) payload.priority = changes.color;
    if (changes.isPinned !== undefined) payload.is_completed = changes.isPinned;

    if (changes.isChecklist !== undefined || changes.checklist !== undefined || changes.content !== undefined) {
      const isChecklist = changes.isChecklist !== undefined ? changes.isChecklist : updatedNote?.isChecklist;
      payload.stage_id = isChecklist ? 'checklist' : 'note';
      if (isChecklist) {
        payload.description = JSON.stringify(changes.checklist || updatedNote?.checklist || []);
      } else {
        payload.description = changes.content !== undefined ? changes.content : (updatedNote?.content || '');
      }
    }

    await supabase
      .from('crm_todos')
      .update(payload)
      .eq('id', id);
  } catch (err) {
    console.warn('Failed to update sticky note in Supabase:', err);
  }

  return updatedNote;
}

/**
/**
 * Delete a sticky note (Instant local cache update + background Supabase delete)
 */
export function deleteStickyNote(id) {
  // 1. Remove from local cache immediately
  const current = getCachedNotes();
  setCachedNotes(current.filter(n => n.id !== id));

  // 2. Remove from Supabase in background
  (async () => {
    try {
      await supabase
        .from('crm_todos')
        .delete()
        .eq('id', id);
    } catch (err) {
      console.warn('Failed to delete sticky note in Supabase:', err);
    }
  })();

  return true;
}
