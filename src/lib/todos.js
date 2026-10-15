/**
 * todos.js - Full To-Do Lists & Custom Pipeline Engine for SimpleCRM
 * Supports dual Supabase + LocalStorage caching and offline fallback.
 */
import { supabase } from './supabase';

const LOCAL_LISTS_KEY = 'crm_todo_lists_cache';
const LOCAL_TODOS_KEY = 'crm_todos_cache';

export const DEFAULT_STAGES = [
  { id: 'todo', name: 'To Do' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'done', name: 'Done' }
];

export const DEFAULT_LIST = {
  id: '5f6d1cf0-8da9-4c97-83a1-7e7101dca13b',
  name: 'General Work',
  stages: DEFAULT_STAGES,
  created_at: new Date().toISOString(),
  created_by: 'System'
};

// ----------------- LOCAL CACHE HELPERS -----------------
export function getCachedLists() {
  try {
    const raw = localStorage.getItem(LOCAL_LISTS_KEY);
    if (!raw) return [DEFAULT_LIST];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_LIST];
    // Clean up any legacy non-UUID entries
    return parsed.map((l) =>
      l.id === 'default-list-general' ? { ...l, id: DEFAULT_LIST.id } : l
    );
  } catch {
    return [DEFAULT_LIST];
  }
}

export function setCachedLists(lists) {
  try {
    localStorage.setItem(LOCAL_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Could not cache todo lists:', e);
  }
}

export function getCachedTodos(listId = null) {
  try {
    const raw = localStorage.getItem(LOCAL_TODOS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (listId && Array.isArray(parsed)) {
      const matchId = listId === 'default-list-general' ? DEFAULT_LIST.id : listId;
      return parsed.filter((t) => t.list_id === matchId || t.list_id === listId);
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setCachedTodos(todos) {
  try {
    localStorage.setItem(LOCAL_TODOS_KEY, JSON.stringify(todos));
  } catch (e) {
    console.warn('Could not cache todos:', e);
  }
}

// ----------------- TODO LISTS CRUD -----------------

/**
 * Fetch all To-Do lists
 */
export async function fetchTodoLists() {
  let lists = [];

  try {
    const { data, error } = await supabase
      .from('crm_todo_lists')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      if (data.length > 0) {
        lists = data;
        setCachedLists(lists);
        return lists;
      } else {
        // Table is empty, auto-create initial list in Supabase
        const { data: created, error: createErr } = await supabase
          .from('crm_todo_lists')
          .insert([
            {
              name: 'General Work',
              stages: DEFAULT_STAGES,
              created_by: 'System'
            }
          ])
          .select()
          .single();

        if (!createErr && created) {
          lists = [created];
          setCachedLists(lists);
          return lists;
        }
      }
    } else if (error) {
      console.warn('Supabase crm_todo_lists query error:', error);
    }
  } catch (err) {
    console.warn('Supabase crm_todo_lists note:', err.message);
  }

  // Fallback to cache
  lists = getCachedLists();
  if (!lists || lists.length === 0) {
    lists = [DEFAULT_LIST];
    setCachedLists(lists);
  }
  return lists;
}

/**
 * Create a new To-Do list with custom stages
 */
export async function createTodoList({ name, description = '', stages = DEFAULT_STAGES, createdBy = 'User' }) {
  const newList = {
    id: `list_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    description,
    stages: Array.isArray(stages) && stages.length > 0 ? stages : DEFAULT_STAGES,
    created_at: new Date().toISOString(),
    created_by: createdBy
  };

  try {
    const { data, error } = await supabase
      .from('crm_todo_lists')
      .insert([
        {
          name: newList.name,
          description: newList.description,
          stages: newList.stages,
          created_by: newList.created_by
        }
      ])
      .select()
      .single();

    if (!error && data) {
      newList.id = data.id;
    }
  } catch (e) {
    console.warn('Note creating list in Supabase:', e.message);
  }

  const currentLists = getCachedLists();
  const updatedLists = [...currentLists, newList];
  setCachedLists(updatedLists);

  return newList;
}

/**
 * Update a To-Do list (name, description, or custom stages)
 */
export async function updateTodoList(listId, updates) {
  try {
    await supabase.from('crm_todo_lists').update(updates).eq('id', listId);
  } catch (e) {
    console.warn('Note updating list in Supabase:', e.message);
  }

  const currentLists = getCachedLists();
  const updatedLists = currentLists.map((l) => (l.id === listId ? { ...l, ...updates } : l));
  setCachedLists(updatedLists);

  return updatedLists.find((l) => l.id === listId);
}

/**
 * Delete a To-Do list and its associated tasks
 */
export async function deleteTodoList(listId) {
  try {
    await supabase.from('crm_todo_lists').delete().eq('id', listId);
  } catch (e) {
    console.warn('Note deleting list in Supabase:', e.message);
  }

  const currentLists = getCachedLists().filter((l) => l.id !== listId);
  setCachedLists(currentLists);

  const currentTodos = getCachedTodos().filter((t) => t.list_id !== listId);
  setCachedTodos(currentTodos);

  return currentLists;
}

// ----------------- TODOS (TASKS) CRUD -----------------

/**
 * Fetch todos for a specific list
 */
export async function fetchTodos(listId) {
  let todos = [];
  const targetListId = (!listId || listId === 'default-list-general') ? DEFAULT_LIST.id : listId;

  try {
    let query = supabase.from('crm_todos').select('*');
    if (targetListId) {
      query = query.eq('list_id', targetListId);
    }
    const { data, error } = await query.order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      todos = data;
      // Update local cache for this list
      const allCached = getCachedTodos().filter((t) => (targetListId ? t.list_id !== targetListId : false));
      setCachedTodos([...allCached, ...todos]);
      return todos;
    } else if (error) {
      console.warn('Supabase crm_todos query error:', error);
    }
  } catch (err) {
    console.warn('Supabase crm_todos note:', err.message);
  }

  // Fallback to cache
  const allLocal = getCachedTodos();
  return targetListId ? allLocal.filter((t) => t.list_id === targetListId) : allLocal;
}

/**
 * Create a new task in a list
 */
export async function createTodo({
  listId,
  title,
  description = '',
  stageId,
  stage_id,
  priority = 'medium',
  dueDate = null,
  assignedTo = '',
  leadId = null,
  leadName = '',
  createdBy = 'User'
}) {
  const resolvedStage = stageId || stage_id || 'todo';
  let resolvedListId = listId;
  if (!resolvedListId || resolvedListId === 'default-list-general') {
    const cached = getCachedLists();
    const found = cached.find((l) => l.id && l.id !== 'default-list-general');
    resolvedListId = found ? found.id : DEFAULT_LIST.id;
  }

  const newTodo = {
    id: `todo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    list_id: resolvedListId,
    title,
    description: description || '',
    stage_id: resolvedStage,
    priority: priority || 'medium',
    due_date: dueDate || null,
    is_completed: resolvedStage === 'done',
    completed_at: resolvedStage === 'done' ? new Date().toISOString() : null,
    assigned_to: assignedTo || '',
    lead_id: leadId || null,
    lead_name: leadName || '',
    sort_order: 0,
    created_at: new Date().toISOString(),
    created_by: createdBy || 'User'
  };

  try {
    const { data, error } = await supabase
      .from('crm_todos')
      .insert([
        {
          list_id: newTodo.list_id,
          title: newTodo.title,
          description: newTodo.description || null,
          stage_id: newTodo.stage_id,
          priority: newTodo.priority,
          due_date: newTodo.due_date,
          is_completed: newTodo.is_completed,
          completed_at: newTodo.completed_at,
          assigned_to: newTodo.assigned_to || null,
          lead_id: newTodo.lead_id,
          lead_name: newTodo.lead_name || null,
          sort_order: 0,
          created_by: newTodo.created_by
        }
      ])
      .select()
      .single();

    if (!error && data) {
      newTodo.id = data.id;
      newTodo.created_at = data.created_at;
    } else if (error) {
      console.warn('Note creating todo in Supabase:', error.message || error);
    }
  } catch (e) {
    console.warn('Note creating todo in Supabase:', e.message);
  }

  const allCached = getCachedTodos();
  setCachedTodos([newTodo, ...allCached]);

  return newTodo;
}

/**
 * Update a task (stage, completion status, priority, title, etc.)
 */
export async function updateTodo(todoId, updates) {
  // If stage changed to done or is_completed changed
  if (updates.stage_id === 'done' && updates.is_completed === undefined) {
    updates.is_completed = true;
    updates.completed_at = new Date().toISOString();
  } else if (updates.is_completed === true && !updates.completed_at) {
    updates.completed_at = new Date().toISOString();
  } else if (updates.is_completed === false) {
    updates.completed_at = null;
  }

  try {
    await supabase.from('crm_todos').update(updates).eq('id', todoId);
  } catch (e) {
    console.warn('Note updating todo in Supabase:', e.message);
  }

  const allCached = getCachedTodos();
  const updatedList = allCached.map((t) => (t.id === todoId ? { ...t, ...updates } : t));
  setCachedTodos(updatedList);

  return updatedList.find((t) => t.id === todoId);
}

/**
 * Delete a task
 */
export async function deleteTodo(todoId) {
  try {
    await supabase.from('crm_todos').delete().eq('id', todoId);
  } catch (e) {
    console.warn('Note deleting todo in Supabase:', e.message);
  }

  const allCached = getCachedTodos().filter((t) => t.id !== todoId);
  setCachedTodos(allCached);

  return true;
}
