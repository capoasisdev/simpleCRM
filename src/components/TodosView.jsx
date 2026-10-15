import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ListTodo,
  Plus,
  Search,
  Filter,
  LayoutGrid,
  ListCheck,
  Check,
  Calendar,
  AlertCircle,
  Clock,
  User,
  Building,
  MoreVertical,
  Edit2,
  Trash2,
  CheckCircle2,
  GripVertical,
  X,
  ChevronDown,
  Layers,
  ArrowRight,
  ExternalLink,
  AlignLeft,
  CornerDownLeft
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  fetchTodoLists,
  createTodoList,
  updateTodoList,
  deleteTodoList,
  fetchTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  DEFAULT_STAGES,
  getCachedLists,
  getCachedTodos
} from '../lib/todos';
import Skeleton from './common/Skeleton';
import '../styles/todos.css';

export default function TodosView({ currentUser }) {
  // Synchronous cache hydration for instant zero-flicker mounts
  const [lists, setLists] = useState(() => getCachedLists());
  const [selectedListId, setSelectedListId] = useState(() => {
    const cached = getCachedLists();
    return cached.length > 0 ? cached[0].id : null;
  });
  const [todos, setTodos] = useState(() => {
    const initialListId = getCachedLists()[0]?.id;
    return getCachedTodos(initialListId);
  });
  const [isLoadingLists, setIsLoadingLists] = useState(() => {
    const cached = getCachedLists();
    return !cached || cached.length === 0;
  });
  const [isLoadingTodos, setIsLoadingTodos] = useState(() => {
    const initialListId = getCachedLists()[0]?.id;
    const cached = getCachedTodos(initialListId);
    return !cached || cached.length === 0;
  });

  // View & Filter States (persisted in localStorage)
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('crm_todos_view_mode') || 'board';
    } catch {
      return 'board';
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('crm_todos_view_mode', mode);
    } catch {}
  };

  // Inline Task Composer State
  const [inlineStageId, setInlineStageId] = useState(null);
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineDescription, setInlineDescription] = useState('');
  const [inlineShowDesc, setInlineShowDesc] = useState(false);
  const [inlinePriority, setInlinePriority] = useState('medium');
  const [inlinePriorityDropdownOpen, setInlinePriorityDropdownOpen] = useState(false);

  // Custom Dropdown State for Cards
  const [openCardDropdown, setOpenCardDropdown] = useState(null); // { todoId: string, type: 'stage' | 'priority' } | null

  // In-Card Inline Edit State
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  // Drag and Drop & Auto-scroll State
  const boardRef = useRef(null);
  const [draggedTodoId, setDraggedTodoId] = useState(null);
  const [dragOverStageId, setDragOverStageId] = useState(null);
  const justDraggedRef = useRef(false);

  const draggedTodo = useMemo(() => {
    if (!draggedTodoId) return null;
    return todos.find((t) => t.id === draggedTodoId) || null;
  }, [todos, draggedTodoId]);

  // Auto-scroll loop
  const scrollVelocityRef = useRef(0);
  const scrollAnimationIdRef = useRef(null);

  const startAutoScroll = () => {
    if (scrollAnimationIdRef.current) return;
    const loop = () => {
      if (boardRef.current && scrollVelocityRef.current !== 0) {
        boardRef.current.scrollLeft += scrollVelocityRef.current;
      }
      scrollAnimationIdRef.current = requestAnimationFrame(loop);
    };
    scrollAnimationIdRef.current = requestAnimationFrame(loop);
  };

  const stopAutoScroll = () => {
    if (scrollAnimationIdRef.current) {
      cancelAnimationFrame(scrollAnimationIdRef.current);
      scrollAnimationIdRef.current = null;
    }
    scrollVelocityRef.current = 0;
  };

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (!e.target.closest('.todo-card-dropdown-wrap')) {
        setOpenCardDropdown(null);
        setInlinePriorityDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // Modal States
  const [taskModal, setTaskModal] = useState({ isOpen: false, task: null, defaultStageId: 'todo' });
  const [listModal, setListModal] = useState({ isOpen: false, list: null });
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'list' | 'task', item: object }

  // 1. Load Lists
  const loadLists = async () => {
    try {
      const data = await fetchTodoLists();
      setLists(data);
      if (data.length > 0) {
        setSelectedListId((prev) => {
          if (!prev || prev === 'default-list-general' || !data.some((l) => l.id === prev)) {
            return data[0].id;
          }
          return prev;
        });
        const targetId = (!selectedListId || selectedListId === 'default-list-general' || !data.some((l) => l.id === selectedListId))
          ? data[0].id
          : selectedListId;
        const cachedForList = getCachedTodos(targetId);
        if (cachedForList && cachedForList.length > 0) {
          setTodos(cachedForList);
        }
      }
    } catch (e) {
      console.warn('Error fetching todo lists:', e);
    } finally {
      setIsLoadingLists(false);
    }
  };

  useEffect(() => {
    loadLists();
  }, []);

  // 2. Load Leads for lead linker


  // 3. Load Todos for active list
  const activeList = useMemo(() => {
    return lists.find((l) => l.id === selectedListId) || lists[0] || null;
  }, [lists, selectedListId]);

  const loadTodosForActiveList = async () => {
    if (!activeList) return;
    // Only show full loading skeleton if there are NO cached todos in state!
    if (todos.length === 0) {
      setIsLoadingTodos(true);
    }
    try {
      const data = await fetchTodos(activeList.id);
      setTodos(data);
    } catch (e) {
      console.warn('Error fetching todos:', e);
    } finally {
      setIsLoadingTodos(false);
    }
  };

  useEffect(() => {
    if (activeList?.id) {
      loadTodosForActiveList();
    }
  }, [activeList?.id]);

  // Stages for current active list
  const currentStages = useMemo(() => {
    if (!activeList?.stages || !Array.isArray(activeList.stages) || activeList.stages.length === 0) {
      return DEFAULT_STAGES;
    }
    return activeList.stages;
  }, [activeList]);

  // Filtered Todos
  const filteredTodos = useMemo(() => {
    return todos.filter((t) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title?.toLowerCase().includes(q);
        const matchesDesc = t.description?.toLowerCase().includes(q);
        const matchesLead = t.lead_name?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesLead) return false;
      }
      // Priority filter
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) {
        return false;
      }
      return true;
    });
  }, [todos, searchQuery, priorityFilter]);

  // ----------------- TASK ACTIONS -----------------
  const handleToggleComplete = async (e, todo) => {
    e.stopPropagation();
    const newCompleted = !todo.is_completed;
    const updates = {
      is_completed: newCompleted,
      completed_at: newCompleted ? new Date().toISOString() : null
    };

    // If marking completed and there is a "done" stage, move to it
    const doneStage = currentStages.find((s) => s.id === 'done' || s.name.toLowerCase() === 'done' || s.name.toLowerCase() === 'completed');
    if (newCompleted && doneStage) {
      updates.stage_id = doneStage.id;
    }

    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, ...updates } : t)));
    await updateTodo(todo.id, updates);
  };

  const handleMoveStage = async (todo, newStageId) => {
    const isDone = newStageId === 'done' || currentStages.find((s) => s.id === newStageId)?.name.toLowerCase() === 'done';
    const updates = {
      stage_id: newStageId,
      is_completed: isDone,
      completed_at: isDone ? new Date().toISOString() : null
    };

    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, ...updates } : t)));
    await updateTodo(todo.id, updates);
  };

  const handleChangePriority = async (todo, newPriority) => {
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, priority: newPriority } : t)));
    await updateTodo(todo.id, { priority: newPriority });
  };

  const handleStartInlineEdit = (todo) => {
    setEditingTaskId(todo.id);
    setEditTitle(todo.title);
    setOpenCardDropdown(null);
  };

  const handleSaveInlineEdit = async (todoId) => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setEditingTaskId(null);
      return;
    }
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, title: trimmed } : t)));
    setEditingTaskId(null);
    await updateTodo(todoId, { title: trimmed });
  };

  const handleCancelInlineEdit = () => {
    setEditingTaskId(null);
    setEditTitle('');
  };

  // ----------------- DRAG AND DROP HANDLERS -----------------
  const handleDragStart = (e, todo) => {
    // Exclude clicks inside buttons, inputs, textareas, dropdowns, card footer, or checkbox
    if (e.target.closest('button, input, textarea, select, .todo-card-bottom, .todo-checkbox')) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    setDraggedTodoId(todo.id);
    justDraggedRef.current = true;
    e.dataTransfer.setData('text/plain', todo.id);
    e.dataTransfer.effectAllowed = 'move';

    const cardElement = e.currentTarget.closest('.todo-card') || e.currentTarget;
    if (cardElement && e.dataTransfer.setDragImage) {
      const rect = cardElement.getBoundingClientRect();
      const offsetX = Math.min(Math.max(20, e.clientX - rect.left), rect.width - 20);
      const offsetY = Math.min(Math.max(16, e.clientY - rect.top), rect.height - 16);
      e.dataTransfer.setDragImage(cardElement, offsetX, offsetY);
    }

    setOpenCardDropdown(null);
  };

  const handleDragEnd = () => {
    setDraggedTodoId(null);
    setDragOverStageId(null);
    stopAutoScroll();
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 150);
  };

  const handleBoardDragOver = (e) => {
    e.preventDefault();
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = e.clientX;
    const edgeThreshold = 100;
    const maxSpeed = 16;

    if (x < rect.left + edgeThreshold && x >= rect.left - 50) {
      const distance = Math.max(0, rect.left + edgeThreshold - x);
      const intensity = distance / edgeThreshold;
      scrollVelocityRef.current = -Math.max(4, Math.round(intensity * maxSpeed));
      startAutoScroll();
    } else if (x > rect.right - edgeThreshold && x <= rect.right + 50) {
      const distance = Math.max(0, x - (rect.right - edgeThreshold));
      const intensity = distance / edgeThreshold;
      scrollVelocityRef.current = Math.max(4, Math.round(intensity * maxSpeed));
      startAutoScroll();
    } else {
      scrollVelocityRef.current = 0;
    }

    // Vertical auto-scroll for tall columns
    const colCards = e.target.closest?.('.todos-column-cards');
    if (colCards) {
      const colRect = colCards.getBoundingClientRect();
      const y = e.clientY;
      if (y < colRect.top + 60 && y >= colRect.top) {
        colCards.scrollTop -= 8;
      } else if (y > colRect.bottom - 60 && y <= colRect.bottom) {
        colCards.scrollTop += 8;
      }
    }
  };

  const handleColumnDragOver = (e, stageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStageId !== stageId) {
      setDragOverStageId(stageId);
    }
  };

  const handleColumnDrop = async (e, targetStageId) => {
    e.preventDefault();
    stopAutoScroll();
    setDragOverStageId(null);

    const todoId = e.dataTransfer.getData('text/plain') || draggedTodoId;
    if (!todoId) return;

    const todoToMove = todos.find((t) => t.id === todoId);
    if (!todoToMove || todoToMove.stage_id === targetStageId) {
      setDraggedTodoId(null);
      return;
    }

    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 150);

    setDraggedTodoId(null);
    handleMoveStage(todoToMove, targetStageId);
  };

  // ----------------- INLINE TASK HANDLERS -----------------
  const handleToggleInlineAdd = (stageId) => {
    if (inlineStageId === stageId) {
      setInlineStageId(null);
      setInlineTitle('');
      setInlineDescription('');
      setInlineShowDesc(false);
      setInlinePriorityDropdownOpen(false);
    } else {
      setInlineStageId(stageId);
      setInlineTitle('');
      setInlineDescription('');
      setInlineShowDesc(false);
      setInlinePriority('medium');
      setInlinePriorityDropdownOpen(false);
    }
  };

  const handleCreateInlineTask = async (e, stageId) => {
    if (e) e.preventDefault();
    const trimmedTitle = inlineTitle.trim();
    if (!trimmedTitle) return;

    const tempId = `todo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isDone = stageId === 'done' || currentStages.find((s) => s.id === stageId)?.name.toLowerCase() === 'done';

    // Optimistic task for immediate 0ms UI update
    const optimisticTask = {
      id: tempId,
      list_id: activeList?.id,
      title: trimmedTitle,
      description: inlineDescription.trim(),
      stage_id: stageId,
      priority: inlinePriority,
      is_completed: isDone,
      completed_at: isDone ? new Date().toISOString() : null,
      due_date: null,
      created_at: new Date().toISOString(),
      created_by: currentUser?.name || 'User'
    };

    // Close composer immediately and insert task at top of list
    setInlineStageId(null);
    setInlineTitle('');
    setInlineDescription('');
    setInlineShowDesc(false);
    setInlinePriorityDropdownOpen(false);
    setTodos((prev) => [optimisticTask, ...prev]);

    // Persist in background
    try {
      const created = await createTodo({
        listId: activeList.id,
        title: trimmedTitle,
        description: inlineDescription.trim(),
        stageId: stageId,
        stage_id: stageId,
        priority: inlinePriority,
        createdBy: currentUser?.name || 'User'
      });
      if (created?.id && created.id !== tempId) {
        setTodos((prev) => prev.map((t) => (t.id === tempId ? { ...t, id: created.id } : t)));
      }
    } catch (err) {
      console.warn('Background sync for task:', err);
    }
  };

  // ----------------- MODAL HANDLERS -----------------
  const handleSaveTask = async (formData) => {
    if (taskModal.task) {
      // Edit
      const updated = await updateTodo(taskModal.task.id, formData);
      setTodos((prev) => prev.map((t) => (t.id === taskModal.task.id ? { ...t, ...formData } : t)));
    } else {
      // Create
      const created = await createTodo({
        listId: activeList.id,
        ...formData,
        createdBy: currentUser?.name || 'User'
      });
      setTodos((prev) => [created, ...prev]);
    }
    setTaskModal({ isOpen: false, task: null, defaultStageId: 'todo' });
  };

  const handleDeleteTask = async (todoId) => {
    await deleteTodo(todoId);
    setTodos((prev) => prev.filter((t) => t.id !== todoId));
    setDeleteConfirm(null);
    setTaskModal({ isOpen: false, task: null, defaultStageId: 'todo' });
  };

  const handleSaveList = async (name, stages) => {
    if (listModal.list) {
      // Edit list
      const updated = await updateTodoList(listModal.list.id, { name, stages });
      setLists((prev) => prev.map((l) => (l.id === listModal.list.id ? { ...l, name, stages } : l)));
    } else {
      // Create list
      const created = await createTodoList({
        name,
        stages: stages || DEFAULT_STAGES,
        createdBy: currentUser?.name || 'User'
      });
      setLists((prev) => [...prev, created]);
      setSelectedListId(created.id);
    }
    setListModal({ isOpen: false, list: null });
  };

  const handleDeleteList = async (listId) => {
    await deleteTodoList(listId);
    setLists((prev) => prev.filter((l) => l.id !== listId));
    setDeleteConfirm(null);
    const remaining = lists.filter((l) => l.id !== listId);
    if (remaining.length > 0) {
      setSelectedListId(remaining[0].id);
    } else {
      setSelectedListId(null);
    }
  };

  // Helper for formatting due date status
  const formatDueDate = (dateStr) => {
    if (!dateStr) return null;
    const due = new Date(dateStr);
    const now = new Date();
    const isToday = due.toDateString() === now.toDateString();
    const isOverdue = due < now && !isToday;

    const formatted = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return {
      text: isToday ? 'Due Today' : isOverdue ? `Overdue (${formatted})` : formatted,
      status: isOverdue ? 'overdue' : isToday ? 'today' : 'upcoming'
    };
  };

  const [isListDropdownOpen, setIsListDropdownOpen] = useState(false);
  const listDropdownRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (listDropdownRef.current && !listDropdownRef.current.contains(e.target)) {
        setIsListDropdownOpen(false);
      }
      setOpenCardDropdown(null);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  return (
    <div className="todos-container">
      {/* Single Unified Compact Toolbar */}
      <div className="todos-unified-toolbar">
        {/* Left Side: List Switcher & List Actions */}
        <div className="todos-toolbar-left">
          <div className="todos-list-selector-wrap" ref={listDropdownRef}>
            <button
              type="button"
              className={`todos-list-select-trigger ${isListDropdownOpen ? 'active' : ''}`}
              onClick={() => setIsListDropdownOpen(!isListDropdownOpen)}
              title="Switch task list"
              aria-haspopup="listbox"
              aria-expanded={isListDropdownOpen}
            >
              {isLoadingLists ? (
                <Skeleton width="90px" height="14px" borderRadius="4px" />
              ) : (
                <>
                  <span className="todos-current-list-name">{activeList?.name || 'General Work'}</span>
                  <span className="todos-list-count-badge">{filteredTodos.length}</span>
                </>
              )}
              <ChevronDown size={14} strokeWidth={2} className={`todos-chevron ${isListDropdownOpen ? 'open' : ''}`} />
            </button>

            {isListDropdownOpen && (
              <div className="todos-list-dropdown-menu" role="listbox">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="option"
                    aria-selected={selectedListId === l.id}
                    className={`todos-list-dropdown-item ${selectedListId === l.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedListId(l.id);
                      setIsListDropdownOpen(false);
                      const cachedForList = getCachedTodos(l.id);
                      if (cachedForList && cachedForList.length > 0) {
                        setTodos(cachedForList);
                      }
                    }}
                  >
                    <span>{l.name}</span>
                    {selectedListId === l.id && <Check size={14} strokeWidth={2} />}
                  </button>
                ))}

                <div className="todos-list-dropdown-divider" />

                <button
                  type="button"
                  className="todos-list-dropdown-add"
                  onClick={() => {
                    setIsListDropdownOpen(false);
                    setListModal({ isOpen: true, list: null });
                  }}
                >
                  <Plus size={14} strokeWidth={2} />
                  <span>Create New List</span>
                </button>
              </div>
            )}
          </div>

          {activeList && (
            <div className="todos-list-quick-actions">
              <button
                type="button"
                className="todos-toolbar-icon-btn"
                onClick={() => setListModal({ isOpen: true, list: activeList })}
                title="Edit List Name & Stages"
              >
                <Edit2 size={13} strokeWidth={1.8} />
                <span>Edit</span>
              </button>
              {lists.length > 1 && (
                <button
                  type="button"
                  className="todos-toolbar-icon-btn delete"
                  onClick={() => setDeleteConfirm({ type: 'list', item: activeList })}
                  title="Delete List"
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Search, Priority Filter, View Switcher & Add Task */}
        <div className="todos-toolbar-right">
          <div className="todos-search-wrap">
            <Search size={13} className="todos-search-icon" />
            <input
              type="text"
              placeholder="Search tasks..."
              className="todos-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select
            className="todos-filter-select"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">Priority: All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <div className="todos-view-toggle">
            <button
              type="button"
              className={`todos-toggle-btn ${viewMode === 'board' ? 'active' : ''}`}
              onClick={() => handleSetViewMode('board')}
              title="Kanban Board View"
            >
              <LayoutGrid size={13} />
            </button>
            <button
              type="button"
              className={`todos-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleSetViewMode('list')}
              title="Checklist Table View"
            >
              <ListCheck size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isLoadingTodos ? (
        viewMode === 'board' ? (
          /* Kanban Board Loading Skeleton */
          <div className="todos-board">
            {(currentStages.length > 0 ? currentStages : [
              { id: 'todo', name: 'To Do' },
              { id: 'in_progress', name: 'In Progress' },
              { id: 'review', name: 'Review' },
              { id: 'done', name: 'Done' }
            ]).map((stage, sIdx) => (
              <div key={stage.id} className="todos-column">
                <div className="todos-column-header">
                  <div className="todos-column-title-wrap">
                    <span className="todos-column-title">{stage.name}</span>
                    <Skeleton width="18px" height="16px" borderRadius="10px" />
                  </div>
                  <Skeleton width="68px" height="26px" borderRadius="5px" />
                </div>
                <div className="todos-column-cards">
                  {[1, 2, 3].slice(0, sIdx === 0 ? 3 : sIdx === 1 ? 2 : 1).map((cIdx) => (
                    <div key={cIdx} className="todo-card-skeleton">
                      <Skeleton width={cIdx === 1 ? '90%' : '75%'} height="15px" borderRadius="4px" />
                      <Skeleton width="45%" height="11px" borderRadius="3px" style={{ opacity: 0.65 }} />
                      <div className="todo-card-skeleton-bottom">
                        <Skeleton width="64px" height="20px" borderRadius="12px" />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Skeleton width="22px" height="22px" borderRadius="4px" />
                          <Skeleton width="22px" height="22px" borderRadius="4px" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Checklist Table Loading Skeleton */
          <div className="todos-table-card">
            <div className="todos-table-header-bar">
              <Skeleton width="120px" height="18px" borderRadius="4px" />
              <Skeleton width="80px" height="28px" borderRadius="6px" />
            </div>
            <table className="todos-table">
              <thead>
                <tr>
                  <th style={{ width: '38px' }}></th>
                  <th>Task</th>
                  <th>Stage</th>
                  <th>Priority</th>
                  <th style={{ textAlign: 'right', width: '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="table-row-skeleton">
                    <td><Skeleton width="17px" height="17px" borderRadius="4px" /></td>
                    <td><Skeleton width={`${55 + (i * 7)}%`} height="14px" borderRadius="4px" /></td>
                    <td><Skeleton width="75px" height="20px" borderRadius="10px" /></td>
                    <td><Skeleton width="60px" height="18px" borderRadius="10px" /></td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <Skeleton width="24px" height="24px" borderRadius="4px" />
                        <Skeleton width="24px" height="24px" borderRadius="4px" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filteredTodos.length === 0 && !searchQuery && priorityFilter === 'all' && viewMode === 'list' ? (
        <div className="todos-empty-state">
          <ListTodo size={40} strokeWidth={1.5} color="#94a3b8" />
          <h3>No tasks in this list yet</h3>
          <p>Add your first task to kick off your pipeline workflow.</p>
          <button
            type="button"
            className="todos-btn-primary"
            onClick={() => {
              setViewMode('board');
              handleToggleInlineAdd(currentStages[0]?.id || 'todo');
            }}
          >
            <Plus size={15} />
            <span>Create First Task</span>
          </button>
        </div>
      ) : viewMode === 'board' ? (
        /* ---------------- KANBAN BOARD VIEW ---------------- */
        <div
          ref={boardRef}
          className={`todos-board ${draggedTodoId ? 'is-dragging-active' : ''}`}
          onDragOver={handleBoardDragOver}
          onDragLeave={stopAutoScroll}
        >
          {currentStages.map((stage) => {
            const stageTodos = filteredTodos.filter((t) => t.stage_id === stage.id);
            const isCurrentStage = draggedTodo && draggedTodo.stage_id === stage.id;
            const isTargetColumn = dragOverStageId === stage.id && draggedTodo && !isCurrentStage;

            return (
              <div
                key={stage.id}
                className={`todos-column ${isTargetColumn ? 'drag-over-column' : ''}`}
                onDragOver={(e) => handleColumnDragOver(e, stage.id)}
                onDrop={(e) => handleColumnDrop(e, stage.id)}
              >
                <div className="todos-column-header">
                  <div className="todos-column-title-wrap">
                    <span className="todos-column-title">{stage.name}</span>
                    <span className="todos-column-badge">{stageTodos.length}</span>
                  </div>
                  <button
                    type="button"
                    className="todos-col-add-btn"
                    onClick={() => handleToggleInlineAdd(stage.id)}
                    title={inlineStageId === stage.id ? "Cancel task creation" : `Add task to ${stage.name}`}
                  >
                    {inlineStageId === stage.id ? (
                      <X size={12} strokeWidth={2.2} />
                    ) : (
                      <Plus size={12} strokeWidth={2.2} />
                    )}
                    <span>{inlineStageId === stage.id ? 'Cancel' : 'Add Task'}</span>
                  </button>
                </div>

                <div
                  className="todos-column-cards"
                  onDragOver={(e) => handleColumnDragOver(e, stage.id)}
                  onDrop={(e) => handleColumnDrop(e, stage.id)}
                >
                  {/* Inline Task Composer Card rendered at the top of the column */}
                  {inlineStageId === stage.id && (
                    <div className="todos-inline-composer-card">
                      <form onSubmit={(e) => handleCreateInlineTask(e, stage.id)}>
                        <div className="todos-inline-body">
                          <textarea
                            ref={(el) => {
                              if (el) {
                                el.style.height = 'auto';
                                el.style.height = `${Math.max(el.scrollHeight, 38)}px`;
                              }
                            }}
                            rows={1}
                            className="todos-inline-title-input"
                            placeholder="What needs to be done?"
                            value={inlineTitle}
                            onChange={(e) => {
                              setInlineTitle(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = `${Math.max(e.target.scrollHeight, 38)}px`;
                            }}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleCreateInlineTask(e, stage.id);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleToggleInlineAdd(stage.id);
                              }
                            }}
                          />

                          {inlineShowDesc ? (
                            <textarea
                              rows={2}
                              className="todos-inline-desc-input"
                              placeholder="Add details, notes, or checklist..."
                              value={inlineDescription}
                              onChange={(e) => setInlineDescription(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  handleCreateInlineTask(e, stage.id);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  handleToggleInlineAdd(stage.id);
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="todos-inline-add-desc-btn"
                              onClick={() => setInlineShowDesc(true)}
                            >
                              <AlignLeft size={12} strokeWidth={2} />
                              <span>Add description</span>
                            </button>
                          )}
                        </div>

                        <div className="todos-inline-footer">
                          {/* Custom Priority Pill matching the cards */}
                          <div className="todo-card-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`todo-priority-pill-btn ${inlinePriority}`}
                              onClick={() => setInlinePriorityDropdownOpen(!inlinePriorityDropdownOpen)}
                            >
                              <span className="todo-priority-dot" />
                              <span className="todo-priority-text">
                                {inlinePriority.charAt(0).toUpperCase() + inlinePriority.slice(1)}
                              </span>
                              <ChevronDown size={11} strokeWidth={2} className="todo-pill-chevron" />
                            </button>

                            {inlinePriorityDropdownOpen && (
                              <div className="todo-card-custom-menu priority-menu">
                                <div className="todo-card-menu-header">Priority</div>
                                {['low', 'medium', 'high', 'urgent'].map((p) => (
                                  <button
                                    key={p}
                                    type="button"
                                    className={`todo-card-menu-item ${inlinePriority === p ? 'selected' : ''}`}
                                    onClick={() => {
                                      setInlinePriority(p);
                                      setInlinePriorityDropdownOpen(false);
                                    }}
                                  >
                                    <div className="todo-card-menu-item-left">
                                      <span className={`todo-priority-dot ${p}`} />
                                      <span style={{ textTransform: 'capitalize' }}>{p}</span>
                                    </div>
                                    {inlinePriority === p && <Check size={14} strokeWidth={2.5} />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="todos-inline-actions">
                            <button
                              type="button"
                              className="todos-inline-cancel-btn"
                              onClick={() => handleToggleInlineAdd(stage.id)}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="todos-inline-save-btn"
                              disabled={!inlineTitle.trim()}
                              title="Add Task (Enter ↵)"
                            >
                              <span>Add Task</span>
                              <CornerDownLeft size={12} strokeWidth={2.4} className="todos-btn-enter-icon" />
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>
                  )}
                  {/* Drop Preview of dragged card in target column */}
                  {isTargetColumn && draggedTodo && (
                    <div className="todo-card-drop-preview">
                      <svg className="drop-preview-animated-border" aria-hidden="true">
                        <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="8" ry="8" />
                      </svg>
                      <div className="todo-card-top" style={{ cursor: 'default' }}>
                        <div className="todo-card-title-wrap">
                          <h4 className="todo-card-title">{draggedTodo.title}</h4>
                          {draggedTodo.description && (
                            <p className="todo-card-desc">{draggedTodo.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="todo-card-bottom" style={{ pointerEvents: 'none' }}>
                        <span className={`todo-priority-pill-btn ${draggedTodo.priority || 'medium'}`}>
                          <span className="todo-priority-dot" />
                          <span className="todo-priority-text">
                            {(draggedTodo.priority || 'medium').charAt(0).toUpperCase() + (draggedTodo.priority || 'medium').slice(1)}
                          </span>
                        </span>
                      </div>
                    </div>
                  )}

                  {stageTodos.length > 0 ? (
                    stageTodos.map((todo) => {
                      const dueInfo = formatDueDate(todo.due_date);

                      return (
                        <div
                          key={todo.id}
                          className={`todo-card ${editingTaskId === todo.id ? 'editing' : ''} ${draggedTodoId === todo.id ? 'is-dragging' : ''}`}
                          draggable={editingTaskId !== todo.id}
                          onDragStart={(e) => handleDragStart(e, todo)}
                          onDragEnd={handleDragEnd}
                        >
                          <div
                            className="todo-card-top"
                            aria-label={editingTaskId === todo.id ? undefined : "Drag to move task to another stage"}
                          >
                            <div className="todo-card-title-wrap">
                              {editingTaskId === todo.id ? (
                                <textarea
                                  ref={(el) => {
                                    if (el) {
                                      el.style.height = 'auto';
                                      el.style.height = `${el.scrollHeight}px`;
                                    }
                                  }}
                                  rows={1}
                                  className="todo-card-inline-input"
                                  value={editTitle}
                                  onChange={(e) => {
                                    setEditTitle(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = `${e.target.scrollHeight}px`;
                                  }}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleSaveInlineEdit(todo.id);
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      handleCancelInlineEdit();
                                    }
                                  }}
                                />
                              ) : (
                                <>
                                  <h4 className="todo-card-title">{todo.title}</h4>
                                  {todo.description && (
                                    <p className="todo-card-desc">{todo.description}</p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          <div className="todo-card-bottom">
                            {/* Priority pill with custom dropdown */}
                            <div className="todo-card-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={`todo-priority-pill-btn ${todo.priority || 'medium'}`}
                                onClick={() =>
                                  setOpenCardDropdown(
                                    openCardDropdown?.todoId === todo.id && openCardDropdown?.type === 'priority'
                                      ? null
                                      : { todoId: todo.id, type: 'priority' }
                                  )
                                }
                                title="Change priority"
                              >
                                <span>{todo.priority || 'medium'}</span>
                                <ChevronDown size={11} strokeWidth={2} />
                              </button>

                              {openCardDropdown?.todoId === todo.id && openCardDropdown?.type === 'priority' && (
                                <div className="todo-card-custom-menu priority-menu">
                                  <div className="todo-card-menu-header">Priority</div>
                                  {['low', 'medium', 'high', 'urgent'].map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      className={`todo-card-menu-item ${todo.priority === p ? 'selected' : ''}`}
                                      onClick={() => {
                                        handleChangePriority(todo, p);
                                        setOpenCardDropdown(null);
                                      }}
                                    >
                                      <div className="todo-card-menu-item-left">
                                        <span className={`todo-priority-dot ${p}`} />
                                        <span style={{ textTransform: 'capitalize' }}>{p}</span>
                                      </div>
                                      {todo.priority === p && <Check size={14} strokeWidth={2.5} />}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Actions: Edit, Custom Stage Dropdown & Delete Button */}
                            <div className="todo-card-actions">
                              {editingTaskId === todo.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="todo-card-save-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveInlineEdit(todo.id);
                                    }}
                                    title="Save changes (Enter)"
                                  >
                                    <Check size={13} strokeWidth={2.5} />
                                    <span>Save</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="todo-card-cancel-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelInlineEdit();
                                    }}
                                    title="Cancel (Esc)"
                                  >
                                    <X size={13} strokeWidth={2} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  {/* Dedicated Pencil Button in Footer */}
                                  <button
                                    type="button"
                                    className="todo-card-action-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartInlineEdit(todo);
                                    }}
                                    title="Edit task"
                                  >
                                    <Edit2 size={13} strokeWidth={1.8} />
                                  </button>

                                  {/* Delete button with confirmation */}
                                  <button
                                    type="button"
                                    className="todo-card-del-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteConfirm({ type: 'task', item: todo });
                                    }}
                                    title="Delete task"
                                  >
                                    <Trash2 size={13} strokeWidth={1.8} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : inlineStageId !== stage.id ? (
                    <div className="todos-column-empty">
                      <ListTodo size={28} strokeWidth={1.5} className="todos-column-empty-icon" />
                      <span className="todos-column-empty-text">No tasks</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ---------------- CHECKLIST TABLE VIEW ---------------- */
        <div className="todos-table-card">
          <div className="todos-table-header-bar">
            <span className="todos-table-header-title">{activeList?.name || 'Tasks'} ({filteredTodos.length})</span>
            <button
              type="button"
              className="todos-btn-primary"
              style={{ height: '28px', padding: '0 10px', fontSize: '11.5px' }}
              onClick={() => {
                setViewMode('board');
                handleToggleInlineAdd(currentStages[0]?.id || 'todo');
              }}
            >
              <Plus size={13} strokeWidth={2} />
              <span>Add Task</span>
            </button>
          </div>
          <table className="todos-table">
            <thead>
              <tr>
                <th style={{ width: '38px' }}></th>
                <th>Task</th>
                <th>Stage</th>
                <th>Priority</th>
                <th style={{ textAlign: 'right', width: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTodos.map((todo) => {
                const stageObj = currentStages.find((s) => s.id === todo.stage_id);

                return (
                  <tr key={todo.id} style={{ cursor: 'pointer' }} onClick={() => setTaskModal({ isOpen: true, task: todo, defaultStageId: todo.stage_id })}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`todo-checkbox ${todo.is_completed ? 'checked' : ''}`}
                        onClick={(e) => handleToggleComplete(e, todo)}
                      >
                        {todo.is_completed && <Check size={11} strokeWidth={3} />}
                      </button>
                    </td>
                    <td>
                      <div className="todos-table-title-cell">
                        <span style={{
                          fontWeight: 500,
                          textDecoration: todo.is_completed ? 'line-through' : 'none',
                          color: todo.is_completed ? '#94a3b8' : '#0f172a'
                        }}>
                          {todo.title}
                        </span>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="todos-table-stage-badge">
                        {stageObj?.name || 'Stage'}
                      </span>
                    </td>
                    <td>
                      <span className={`todo-priority-pill ${todo.priority || 'medium'}`}>
                        {todo.priority || 'medium'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        <button
                          type="button"
                          className="todos-icon-btn"
                          onClick={() => setTaskModal({ isOpen: true, task: todo, defaultStageId: todo.stage_id })}
                          title="Edit"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="todos-icon-btn"
                          onClick={() => setDeleteConfirm({ type: 'task', item: todo })}
                          title="Delete"
                          style={{ color: '#ef4444' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ----------------- TASK MODAL (Edit Only) ----------------- */}
      {taskModal.isOpen && taskModal.task && (
        <TaskDetailsModal
          task={taskModal.task}
          defaultStageId={taskModal.defaultStageId}
          stages={currentStages}
          currentUser={currentUser}
          onClose={() => setTaskModal({ isOpen: false, task: null, defaultStageId: 'todo' })}
          onSave={handleSaveTask}
          onDelete={() => handleDeleteTask(taskModal.task?.id)}
        />
      )}

      {/* ----------------- LIST MODAL (Create & Edit with Stages) ----------------- */}
      {listModal.isOpen && (
        <ListConfigModal
          list={listModal.list}
          onClose={() => setListModal({ isOpen: false, list: null })}
          onSave={handleSaveList}
        />
      )}

      {/* ----------------- CONFIRM DELETE MODAL ----------------- */}
      {deleteConfirm && (
        <div className="lead-modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="todo-modal" style={{ width: '400px', textAlign: 'center', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
              <Trash2 size={22} color="#dc2626" />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 8px 0' }}>
              Delete {deleteConfirm.type === 'list' ? 'To-Do List' : 'Task'}?
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>
              Are you sure you want to delete{' '}
              <strong>"{deleteConfirm.item?.name || deleteConfirm.item?.title}"</strong>?
              {deleteConfirm.type === 'list' && ' All tasks inside this list will also be removed.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
              <button
                type="button"
                className="todos-btn-secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="todos-btn-primary"
                style={{ backgroundColor: '#dc2626' }}
                onClick={() => {
                  if (deleteConfirm.type === 'list') {
                    handleDeleteList(deleteConfirm.item.id);
                  } else {
                    handleDeleteTask(deleteConfirm.item.id);
                  }
                }}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------- SUB-COMPONENTS / MODALS -----------------

function TaskDetailsModal({ task, defaultStageId, stages, currentUser, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(task?.title || '');
  const [priority, setPriority] = useState(task?.priority || 'medium');

  const targetStageId = task?.stage_id || defaultStageId || stages[0]?.id || 'todo';
  const targetStage = stages.find((s) => s.id === targetStageId) || stages[0];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave({
      title: title.trim(),
      description: task?.description || '',
      stage_id: targetStageId,
      priority,
      due_date: null,
      assigned_to: currentUser?.name || 'User',
      lead_id: null,
      lead_name: ''
    });
  };

  return (
    <div className="lead-modal-backdrop" onClick={onClose}>
      <div className="todo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="todo-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3>{task ? 'Edit Task' : 'New Task'}</h3>
            {targetStage && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: '#f1f5f9',
                  color: '#334155'
                }}
              >
                {targetStage.name}
              </span>
            )}
          </div>
          <button type="button" className="lead-modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="todo-modal-body">
            <div className="todo-field-group">
              <label>Task *</label>
              <input
                type="text"
                required
                autoFocus
                placeholder="What needs to be done?"
                className="todo-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="todo-field-group">
              <label>Priority</label>
              <select
                className="todo-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="todo-modal-footer">
            {task ? (
              <button
                type="button"
                className="todo-delete-btn"
                onClick={onDelete}
              >
                Delete Task
              </button>
            ) : <div />}

            <div className="todo-modal-right-actions">
              <button type="button" className="todos-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="todos-btn-primary">
                {task ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ListConfigModal({ list, onClose, onSave }) {
  const [name, setName] = useState(list?.name || '');
  const [stageList, setStageList] = useState(list?.stages || DEFAULT_STAGES);

  const handleAddStage = () => {
    const newId = `stage_${Date.now()}`;
    setStageList([
      ...stageList,
      { id: newId, name: '' }
    ]);
  };

  const handleRemoveStage = (id) => {
    if (stageList.length <= 1) {
      alert('You must have at least one pipeline stage.');
      return;
    }
    setStageList(stageList.filter((s) => s.id !== id));
  };

  const handleUpdateStage = (id, key, val) => {
    setStageList(stageList.map((s) => (s.id === id ? { ...s, [key]: val } : s)));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const validStages = stageList.filter((s) => s.name.trim().length > 0);
    if (validStages.length === 0) {
      alert('You must have at least one pipeline stage with a name.');
      return;
    }
    onSave(name.trim(), validStages);
  };

  return (
    <div className="lead-modal-backdrop" onClick={onClose}>
      <div className="todo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="todo-modal-header">
          <h3>{list ? 'Edit List & Stages' : 'Create To-Do List'}</h3>
          <button type="button" className="lead-modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="todo-modal-body">
            <div className="todo-field-group">
              <label className="todo-field-label">List Name *</label>
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. Sales Follow-ups, Sprint Q4..."
                className="todo-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="todo-field-group" style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label className="todo-field-label" style={{ margin: 0 }}>Pipeline Stages</label>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>
                  {stageList.length} {stageList.length === 1 ? 'stage' : 'stages'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto', padding: '1px' }}>
                {stageList.map((stg, idx) => (
                  <div key={stg.id} className="todo-stage-item">
                    <div className="todo-stage-drag-icon" title="Stage order">
                      <GripVertical size={14} />
                    </div>

                    <input
                      type="text"
                      className="todo-stage-input-field"
                      value={stg.name}
                      onChange={(e) => handleUpdateStage(stg.id, 'name', e.target.value)}
                      placeholder={`Stage ${idx + 1} Name`}
                      required
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddStage();
                        }
                      }}
                    />

                    <button
                      type="button"
                      className="todo-stage-delete-btn"
                      onClick={() => handleRemoveStage(stg.id)}
                      title="Remove stage"
                      disabled={stageList.length <= 1}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="todo-add-stage-dashed-btn"
                onClick={handleAddStage}
              >
                <Plus size={14} strokeWidth={2} />
                <span>Add Stage</span>
              </button>
            </div>
          </div>

          <div className="todo-modal-footer">
            <div />
            <div className="todo-modal-right-actions">
              <button type="button" className="todos-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="todos-btn-primary">
                {list ? 'Save Changes' : 'Create List'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
