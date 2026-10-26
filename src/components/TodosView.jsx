import { useState, useEffect, useMemo, useRef } from 'react';
import {
  StickyNote,
  Plus,
  Search,
  Pin,
  Trash2,
  CheckSquare,
  Square,
  AlignLeft,
  X,
  Palette,
  Check,
  Filter,
  ChevronDown
} from 'lucide-react';
import {
  fetchStickyNotes,
  createStickyNote,
  updateStickyNote,
  deleteStickyNote,
  getCachedNotes,
  STICKY_COLORS,
  DEFAULT_COLOR
} from '../lib/todos';
import '../styles/todos.css';

export default function TodosView({ currentUser }) {
  // Ensure there is always at least one note initially
  const [notes, setNotes] = useState(() => {
    const cached = getCachedNotes();
    if (cached.length > 0) return cached;
    return [
      {
        id: `note-${Date.now()}`,
        title: '',
        content: '',
        isChecklist: false,
        checklist: [],
        color: DEFAULT_COLOR,
        isPinned: false,
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.name || 'Me'
      }
    ];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeColorFilter, setActiveColorFilter] = useState('all'); // 'all' | colorId
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [openColorDropdownId, setOpenColorDropdownId] = useState(null);
  const [newlyAddedNoteId, setNewlyAddedNoteId] = useState(null);

  // Mobile specific search bar toggle & filter dropdown states
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef(null);
  const mobileSearchInputRef = useRef(null);

  // Auto-focus mobile search input when opened
  useEffect(() => {
    if (isMobileSearchOpen && mobileSearchInputRef.current) {
      mobileSearchInputRef.current.focus();
    }
  }, [isMobileSearchOpen]);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target)) {
        setIsFilterDropdownOpen(false);
      }
    };
    if (isFilterDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isFilterDropdownOpen]);

  // Close color dropdown when clicking outside
  useEffect(() => {
    const handleGlobalClick = () => {
      setOpenColorDropdownId(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // Load notes on mount and ensure at least 1 note exists
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const data = await fetchStickyNotes();
        if (isMounted) {
          if (!data || data.length === 0) {
            setNotes((prev) => {
              if (prev && prev.length > 0) return prev;
              const blank = createStickyNote({
                title: '',
                content: '',
                isChecklist: false,
                checklist: [],
                color: DEFAULT_COLOR,
                isPinned: false,
                currentUser
              });
              return [blank];
            });
          } else {
            // Safely merge with any notes added locally while fetch was in-flight
            setNotes((prev) => {
              const fetchedIds = new Set(data.map((d) => d.id));
              const localPending = prev.filter((p) => !fetchedIds.has(p.id));
              return [...data, ...localPending];
            });
          }
        }
      } catch (err) {
        console.error('Failed to load sticky notes:', err);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filtered notes
  const filteredNotes = useMemo(() => {
    let result = [...notes];

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((n) => {
        const titleMatch = (n.title || '').toLowerCase().includes(q);
        const contentMatch = (n.content || '').toLowerCase().includes(q);
        const checklistMatch = n.isChecklist && (n.checklist || []).some((item) => (item.text || '').toLowerCase().includes(q));
        return titleMatch || contentMatch || checklistMatch;
      });
    }

    // Color filter
    if (activeColorFilter !== 'all') {
      result = result.filter((n) => n.color === activeColorFilter);
    }

    // Pinned filter
    if (onlyPinned) {
      result = result.filter((n) => n.isPinned);
    }

    // Sort: Pinned first, then chronological order (one after one)
    result.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    return result;
  }, [notes, searchQuery, activeColorFilter, onlyPinned]);

  // Instant direct creation of a blank note (0ms UI latency)
  const handleAddNewNote = (type = 'note', color = DEFAULT_COLOR) => {
    // Clear any active search or pinned filter so the new note is visible immediately
    if (searchQuery) setSearchQuery('');
    if (onlyPinned) setOnlyPinned(false);

    const isCheck = type === 'checklist';
    const note = createStickyNote({
      title: '',
      content: '',
      isChecklist: isCheck,
      checklist: isCheck ? [{ id: `item-${Date.now()}`, text: '', completed: false }] : [],
      color: activeColorFilter !== 'all' ? activeColorFilter : color,
      isPinned: false,
      currentUser
    });

    setNewlyAddedNoteId(note.id);
    setNotes((prev) => [...prev.filter((n) => n.id !== note.id), note]);
  };

  // Update Note fields
  const handleUpdate = async (id, changes) => {
    // Optimistic local state update
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...changes } : n))
    );
    await updateStickyNote(id, changes);
  };

  // Toggle checklist item
  const handleToggleChecklistItem = async (noteId, itemId) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || !note.checklist) return;

    const updatedChecklist = note.checklist.map((item) =>
      item.id === itemId ? { ...item, completed: !item.completed } : item
    );

    handleUpdate(noteId, { checklist: updatedChecklist });
  };

  // Update checklist item text
  const handleUpdateChecklistItemText = (noteId, itemId, text) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || !note.checklist) return;

    const updatedChecklist = note.checklist.map((item) =>
      item.id === itemId ? { ...item, text } : item
    );

    handleUpdate(noteId, { checklist: updatedChecklist });
  };

  // Add checklist item
  const handleAddChecklistItem = (noteId) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;

    const currentList = note.checklist || [];
    const newItem = { id: `item-${Date.now()}`, text: '', completed: false };
    handleUpdate(noteId, { checklist: [...currentList, newItem] });
  };

  // Remove checklist item
  const handleRemoveChecklistItem = (noteId, itemId) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || !note.checklist) return;

    const updatedList = note.checklist.filter((i) => i.id !== itemId);
    handleUpdate(noteId, { checklist: updatedList });
  };

  // Delete Note - 100% instant in 0ms, zero ghost gap, immediate reflow
  const handleDeleteNote = (id) => {
    deleteStickyNote(id);
    const remaining = notes.filter((n) => n.id !== id);

    if (remaining.length === 0) {
      const newBlank = createStickyNote({
        title: '',
        content: '',
        isChecklist: false,
        checklist: [],
        color: DEFAULT_COLOR,
        isPinned: false,
        currentUser
      });
      setNewlyAddedNoteId(newBlank.id);
      setNotes([newBlank]);
      setTimeout(() => {
        setNewlyAddedNoteId((current) => (current === newBlank.id ? null : current));
      }, 300);
    } else {
      setNotes(remaining);
    }
  };

  const formatNoteTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="sticky-board-root">
      {/* Top Controls Toolbar */}
      <header className={`sticky-board-header ${isMobileSearchOpen ? 'is-searching' : ''}`}>
        {isMobileSearchOpen ? (
          <div className="sticky-mobile-search-bar">
            <Search size={16} className="sticky-mobile-search-icon" />
            <input
              ref={mobileSearchInputRef}
              type="text"
              placeholder="Search notes..."
              className="sticky-mobile-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsMobileSearchOpen(false);
                }
              }}
            />
            <button
              type="button"
              className="sticky-mobile-search-close"
              onClick={() => {
                setSearchQuery('');
                setIsMobileSearchOpen(false);
              }}
              aria-label="Close search"
              title="Close search"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <>
            <div className="sticky-header-left">
              <div className="sticky-title-wrap">
                <h1 className="sticky-title">Sticky Notes</h1>
                <span className="sticky-count-badge">
                  {notes.length}
                </span>
              </div>

              {/* Desktop Search input */}
              <div className="sticky-search-wrap desktop-only">
                <Search size={15} className="sticky-search-icon" />
                <input
                  type="text"
                  placeholder="Search notes..."
                  className="sticky-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="sticky-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="sticky-header-right">
              {/* Desktop Filter Pills */}
              <div className="sticky-filter-chips desktop-only">
                <button
                  type="button"
                  className={`sticky-chip ${activeColorFilter === 'all' && !onlyPinned ? 'active' : ''}`}
                  onClick={() => {
                    setActiveColorFilter('all');
                    setOnlyPinned(false);
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`sticky-chip ${onlyPinned ? 'active' : ''}`}
                  onClick={() => setOnlyPinned(!onlyPinned)}
                >
                  <Pin size={12} className={onlyPinned ? 'fill-icon' : ''} />
                  <span>Pinned</span>
                </button>

                {/* Color Swatch Filters */}
                <div className="sticky-swatch-filters">
                  {STICKY_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`sticky-swatch-btn ${activeColorFilter === c.id ? 'selected' : ''}`}
                      style={{ backgroundColor: c.bg, borderColor: c.border }}
                      onClick={() => {
                        setActiveColorFilter(activeColorFilter === c.id ? 'all' : c.id);
                      }}
                      title={`Filter ${c.name} notes`}
                    />
                  ))}
                </div>
              </div>

              {/* Mobile Filter Dropdown */}
              <div className="sticky-filter-dropdown-wrap mobile-only" ref={filterDropdownRef}>
                <button
                  type="button"
                  className={`sticky-filter-dropdown-trigger ${activeColorFilter !== 'all' || onlyPinned ? 'has-filter' : ''}`}
                  onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
                  aria-expanded={isFilterDropdownOpen}
                  aria-label="Filter notes"
                  title="Filter notes"
                >
                  {onlyPinned ? (
                    <Pin size={12} className="fill-icon" />
                  ) : activeColorFilter !== 'all' ? (
                    (() => {
                      const c = STICKY_COLORS.find((col) => col.id === activeColorFilter);
                      return c ? (
                        <span
                          className="sticky-filter-swatch-dot"
                          style={{ backgroundColor: c.bg, borderColor: c.border }}
                        />
                      ) : (
                        <Filter size={13} />
                      );
                    })()
                  ) : (
                    <Filter size={13} />
                  )}
                  <span className="sticky-filter-current-label">
                    {onlyPinned
                      ? 'Pinned'
                      : activeColorFilter !== 'all'
                      ? STICKY_COLORS.find((c) => c.id === activeColorFilter)?.name || 'Filter'
                      : 'All'}
                  </span>
                  <ChevronDown
                    size={12}
                    strokeWidth={2}
                    className={`sticky-filter-chevron ${isFilterDropdownOpen ? 'open' : ''}`}
                  />
                </button>

                {isFilterDropdownOpen && (
                  <div className="sticky-filter-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className={`sticky-filter-menu-item ${activeColorFilter === 'all' && !onlyPinned ? 'selected' : ''}`}
                      onClick={() => {
                        setActiveColorFilter('all');
                        setOnlyPinned(false);
                        setIsFilterDropdownOpen(false);
                      }}
                    >
                      <div className="sticky-filter-menu-item-left">
                        <Filter size={13} />
                        <span>All Notes</span>
                      </div>
                      {activeColorFilter === 'all' && !onlyPinned && <Check size={14} strokeWidth={2.5} />}
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className={`sticky-filter-menu-item ${onlyPinned ? 'selected' : ''}`}
                      onClick={() => {
                        setOnlyPinned(true);
                        setActiveColorFilter('all');
                        setIsFilterDropdownOpen(false);
                      }}
                    >
                      <div className="sticky-filter-menu-item-left">
                        <Pin size={13} className="fill-icon" />
                        <span>Pinned Only</span>
                      </div>
                      {onlyPinned && <Check size={14} strokeWidth={2.5} />}
                    </button>

                    <div className="sticky-filter-menu-divider" />
                    <div className="sticky-filter-menu-section-label">Filter by color</div>

                    {STICKY_COLORS.map((c) => {
                      const isSelected = activeColorFilter === c.id && !onlyPinned;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="menuitem"
                          className={`sticky-filter-menu-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setActiveColorFilter(c.id);
                            setOnlyPinned(false);
                            setIsFilterDropdownOpen(false);
                          }}
                        >
                          <div className="sticky-filter-menu-item-left">
                            <span
                              className="sticky-filter-swatch-dot"
                              style={{ backgroundColor: c.bg, borderColor: c.border }}
                            />
                            <span>{c.name}</span>
                          </div>
                          {isSelected && <Check size={14} strokeWidth={2.5} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Mobile Search Icon Button */}
              <button
                type="button"
                className={`sticky-mobile-search-btn mobile-only ${searchQuery ? 'has-query' : ''}`}
                onClick={() => setIsMobileSearchOpen(true)}
                aria-label="Search notes"
                title="Search notes"
              >
                <Search size={16} strokeWidth={2} />
                {searchQuery && <span className="sticky-search-query-dot" />}
              </button>
            </div>
          </>
        )}
      </header>

      {/* Main Canvas Area */}
      <div className="sticky-board-canvas">
        {/* If search query produced 0 matches */}
        {filteredNotes.length === 0 && (searchQuery || activeColorFilter !== 'all' || onlyPinned) && (
          <div className="sticky-no-results">
            <span>No notes match your filter</span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveColorFilter('all');
                setOnlyPinned(false);
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Notes Grid */}
        <div className="sticky-notes-grid">
          {filteredNotes.map((note) => {
            const colorDef = STICKY_COLORS.find((c) => c.id === note.color) || STICKY_COLORS[0];
            const isColorOpen = openColorDropdownId === note.id;
            const isNewlyAdded = newlyAddedNoteId === note.id;

            return (
              <div
                key={note.id}
                className={`sticky-note-card ${note.color} ${note.isPinned ? 'is-pinned' : ''} ${isNewlyAdded ? 'is-newly-added' : ''}`}
                style={{
                  backgroundColor: colorDef.bg,
                  borderColor: colorDef.border
                }}
              >
                {/* Pin Badge Button */}
                <button
                  type="button"
                  className={`sticky-pin-btn ${note.isPinned ? 'pinned' : ''}`}
                  onClick={() => handleUpdate(note.id, { isPinned: !note.isPinned })}
                  title={note.isPinned ? 'Unpin note' : 'Pin to top'}
                >
                  {note.isPinned ? <Pin size={16} className="fill-pin" /> : <Pin size={16} />}
                </button>

                {/* Note Header / Title */}
                <div className="sticky-note-header">
                  <input
                    type="text"
                    className="sticky-note-title"
                    placeholder="Title"
                    value={note.title || ''}
                    onChange={(e) => handleUpdate(note.id, { title: e.target.value })}
                    style={{ color: colorDef.text }}
                    autoFocus={isNewlyAdded}
                  />
                </div>

                {/* Note Body */}
                <div className="sticky-note-body">
                  {note.isChecklist ? (
                    <div className="sticky-checklist-container">
                      {(note.checklist || []).map((item) => (
                        <div
                          key={item.id}
                          className={`sticky-checklist-item ${item.completed ? 'completed' : ''}`}
                        >
                          <button
                            type="button"
                            className="sticky-item-checkbox"
                            onClick={() => handleToggleChecklistItem(note.id, item.id)}
                            aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
                          >
                            {item.completed ? (
                              <CheckSquare size={16} style={{ color: colorDef.accent }} />
                            ) : (
                              <Square size={16} style={{ color: colorDef.text, opacity: 0.82 }} />
                            )}
                          </button>

                          <input
                            type="text"
                            className="sticky-item-text-input"
                            value={item.text || ''}
                            placeholder="List item..."
                            onChange={(e) =>
                              handleUpdateChecklistItemText(note.id, item.id, e.target.value)
                            }
                            style={{ color: colorDef.text }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddChecklistItem(note.id);
                              }
                            }}
                          />

                          <button
                            type="button"
                            className="sticky-item-del-btn"
                            onClick={() => handleRemoveChecklistItem(note.id, item.id)}
                            title="Remove item"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        className="btn-add-checklist-row"
                        onClick={() => handleAddChecklistItem(note.id)}
                        style={{ color: colorDef.accent }}
                      >
                        <Plus size={13} strokeWidth={2.2} />
                        <span>Add item</span>
                      </button>
                    </div>
                  ) : (
                    <textarea
                      className="sticky-note-textarea"
                      placeholder="Take a note..."
                      value={note.content || ''}
                      onChange={(e) => handleUpdate(note.id, { content: e.target.value })}
                      style={{ color: colorDef.text }}
                      rows={3}
                    />
                  )}
                </div>

                {/* Note Footer Actions */}
                <div className="sticky-note-footer">
                  <div className="sticky-note-footer-left">
                    {/* Color Selector Dropdown */}
                    <div className="sticky-color-dropdown-wrap">
                      <button
                        type="button"
                        className={`note-action-btn ${isColorOpen ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenColorDropdownId(isColorOpen ? null : note.id);
                        }}
                        title="Change note color"
                        style={{ color: colorDef.text }}
                      >
                        <Palette size={16} />
                      </button>

                      {isColorOpen && (
                        <div
                          className="sticky-color-dropdown-menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {STICKY_COLORS.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              className={`sticky-color-menu-item ${note.color === c.id ? 'selected' : ''}`}
                              onClick={() => {
                                handleUpdate(note.id, { color: c.id });
                                setOpenColorDropdownId(null);
                              }}
                            >
                              <span
                                className="sticky-color-circle"
                                style={{ backgroundColor: c.bg, borderColor: c.border }}
                              />
                              <span className="sticky-color-name">{c.name}</span>
                              {note.color === c.id && <Check size={13} className="sticky-color-check" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Mode toggle (Text vs Checklist) */}
                    <button
                      type="button"
                      className="note-action-btn"
                      onClick={() => {
                        const nextIsCheck = !note.isChecklist;
                        let checklist = note.checklist || [];
                        if (nextIsCheck && checklist.length === 0) {
                          const lines = (note.content || '').split('\n').filter(Boolean);
                          checklist = lines.length > 0
                            ? lines.map((l, i) => ({ id: `it-${i}`, text: l, completed: false }))
                            : [{ id: `it-${Date.now()}`, text: '', completed: false }];
                        }
                        handleUpdate(note.id, {
                          isChecklist: nextIsCheck,
                          checklist
                        });
                      }}
                      title={note.isChecklist ? 'Convert to text' : 'Convert to checklist'}
                      style={{ color: colorDef.text }}
                    >
                      {note.isChecklist ? <AlignLeft size={16} /> : <CheckSquare size={16} />}
                    </button>
                  </div>

                  <div className="sticky-note-footer-right">
                    <span className="sticky-timestamp" style={{ color: colorDef.text }}>
                      {formatNoteTime(note.createdAt)}
                    </span>

                    <button
                      type="button"
                      className="sticky-btn-delete"
                      onClick={() => handleDeleteNote(note.id)}
                      title="Delete note"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state when there are no notes */}
        {notes.length === 0 && (
          <div className="sticky-empty-board">
            <div className="sticky-empty-icon-wrap">
              <StickyNote size={32} strokeWidth={1.5} />
            </div>
            <h3>No sticky notes</h3>
            <p>Tap the + button below to create your first note.</p>
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) at Bottom Right */}
      <button
        type="button"
        className="sticky-fab-add"
        onClick={() => handleAddNewNote('note')}
        aria-label="Add new note"
        title="Add note"
      >
        <Plus size={24} strokeWidth={2.4} />
      </button>
    </div>
  );
}
