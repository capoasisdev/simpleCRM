import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, X, Phone, Mail, Trash2, AlertCircle, MessageSquare, MapPin, Calendar, ChevronDown, Check, User, Copy, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission, getLeadScope } from '../lib/permissions';
import Skeleton from './common/Skeleton';
import '../styles/leads.css';


const getInitials = (name) => {
  if (!name) return 'L';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return dateStr;
};

const formatTime = (dateStr) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  const trimmed = phone.trim();

  // If already has space after country code (e.g. "+91 9700087502"), return as is
  if (/^\+\d{1,4}\s/.test(trimmed)) {
    return trimmed;
  }

  // +91 (India)
  if (trimmed.startsWith('+91')) {
    return `+91 ${trimmed.slice(3).trim()}`;
  }

  // Generic international with + (e.g. +1, +44, +971)
  const match = trimmed.match(/^(\+\d{1,3})(\d+)$/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }

  // 12-digit Indian number without + (e.g. 919700087502)
  if (/^91\d{10}$/.test(trimmed)) {
    return `+91 ${trimmed.slice(2)}`;
  }

  return trimmed;
};

export default function LeadsView({ currentUser }) {
  const [leads, setLeads] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_leads');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [columns, setColumns] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_pipeline_columns');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const leadScope = getLeadScope(currentUser);
  const canViewAllLeads = currentUser?.role === 'admin' || leadScope === 'all';
  const canEditLead = hasPermission(currentUser, 'leads', 'edit');
  const canDeleteLead = hasPermission(currentUser, 'leads', 'delete');

  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_leads');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch (e) {}
    return true;
  });
  const [tableMissing, setTableMissing] = useState(false);
  const [filterType, setFilterType] = useState(canViewAllLeads ? 'all' : 'my'); // 'all' | 'my' | 'unassigned'
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!canViewAllLeads) {
      setFilterType('my');
    }
  }, [canViewAllLeads]);

  // Selected Lead Details Modal State
  const [selectedLead, setSelectedLead] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const copyToClipboard = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Animated Column Shifting State
  const [animatingLeads, setAnimatingLeads] = useState({});

  // Custom Stage Dropdown Open State (by Lead ID)
  const [openDropdownLeadId, setOpenDropdownLeadId] = useState(null);
  const [dropdownDirection, setDropdownDirection] = useState('down');

  // Custom Assignee Dropdown Open State (by Lead ID)
  const [openAssigneeLeadId, setOpenAssigneeLeadId] = useState(null);
  const [assigneeDirection, setAssigneeDirection] = useState('down');

  // Team members list for assignee dropdown
  const [teamMembers, setTeamMembers] = useState([]);

  // Fetch dynamic pipeline stages from Supabase & subscribe to realtime
  useEffect(() => {
    let isMounted = true;

    const fetchPipeline = async () => {
      try {
        const { data, error } = await supabase
          .from('pipelines')
          .select('*')
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && isMounted && data?.stages && Array.isArray(data.stages) && data.stages.length > 0) {
          const sorted = [...data.stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          setColumns(sorted);
          try {
            localStorage.setItem('crm_pipeline_columns', JSON.stringify(sorted));
          } catch (e) {}
          const entryCol = sorted.find((s) => s.is_entry) || sorted.find((s) => s.id === 'new') || sorted[0];
          if (entryCol?.id) {
            setNewLeadStage((prev) => (sorted.some((c) => c.id === prev) ? prev : entryCol.id));
          }
        }
      } catch (err) {
        console.warn('Error fetching dynamic pipeline stages:', err);
      }
    };

    fetchPipeline();

    const pipeChannel = supabase
      .channel('pipeline-stages-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pipelines' },
        (payload) => {
          if (!isMounted) return;
          if (payload.new?.stages && Array.isArray(payload.new.stages) && payload.new.stages.length > 0) {
            const sorted = [...payload.new.stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            setColumns(sorted);
            try {
              localStorage.setItem('crm_pipeline_columns', JSON.stringify(sorted));
            } catch (e) {}
            const entryCol = sorted.find((s) => s.is_entry) || sorted.find((s) => s.id === 'new') || sorted[0];
            if (entryCol?.id) {
              setNewLeadStage((prev) => (sorted.some((c) => c.id === prev) ? prev : entryCol.id));
            }
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(pipeChannel);
    };
  }, []);

  // Fetch team members from crm_users
  useEffect(() => {
    let isMounted = true;
    const fetchTeam = async () => {
      try {
        const { data, error } = await supabase
          .from('crm_users')
          .select('id, name, email, role')
          .order('name', { ascending: true });
        if (!error && isMounted && data) {
          setTeamMembers(data);
        }
      } catch (err) {
        console.warn('Error fetching team members:', err);
      }
    };
    fetchTeam();
    return () => {
      isMounted = false;
    };
  }, []);

  // Outside click listener to auto-close dropdowns
  useEffect(() => {
    if (!openDropdownLeadId && !openAssigneeLeadId) return;
    const handleOutsideClick = () => {
      setOpenDropdownLeadId(null);
      setOpenAssigneeLeadId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [openDropdownLeadId, openAssigneeLeadId]);

  // New Lead Form State
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadStage, setNewLeadStage] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_pipeline_columns');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed[0]?.id) return parsed[0].id;
      }
    } catch (e) {}
    return 'new';
  });

  // Fetch leads from Supabase on mount & setup Realtime subscription
  useEffect(() => {
    let isMounted = true;

    const fetchLeads = async () => {
      try {
        if (!leads || leads.length === 0) {
          setIsLoading(true);
        }
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
            if (isMounted) setTableMissing(true);
          } else {
            console.warn('Supabase fetch error:', error.message);
          }
        } else if (isMounted && data) {
          setTableMissing(false);
          setLeads(data);
          try {
            localStorage.setItem('crm_cached_leads', JSON.stringify(data));
          } catch (e) {}
        }
      } catch (err) {
        console.warn('Network error fetching leads from Supabase:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchLeads();

    // Subscribe to Realtime Postgres changes
    const channel = supabase
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        (payload) => {
          if (!isMounted) return;
          if (payload.eventType === 'INSERT') {
            setLeads((prev) => {
              if (prev.some((l) => l.id === payload.new.id)) return prev;
              return [payload.new, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setLeads((prev) => prev.filter((l) => l.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            setLeads((prev) =>
              prev.map((l) => (l.id === payload.new.id ? payload.new : l))
            );
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Persist leads to localStorage cache for instant zero-flicker mounts
  useEffect(() => {
    if (leads && leads.length > 0) {
      try {
        localStorage.setItem('crm_cached_leads', JSON.stringify(leads));
      } catch (e) {}
    }
  }, [leads]);

  const isAdmin = currentUser?.role === 'admin';

  // Strict check whether a lead is assigned to a specific user
  const isLeadAssignedToUser = (lead, user) => {
    if (!lead || !user) return false;
    const assigned = (lead.assigned_to || lead.assignedTo || '').toLowerCase().trim();
    if (!assigned || assigned === 'unassigned' || assigned === 'none') return false;

    const userName = (user.name || '').toLowerCase().trim();
    const userFirst = userName.split(' ')[0] || '';
    const userEmail = (user.email || '').toLowerCase().trim();
    const userId = (user.id || '').toLowerCase().trim();

    return (
      assigned === userName ||
      assigned === userFirst ||
      (userEmail && assigned === userEmail) ||
      (userId && assigned === userId) ||
      (userName.includes('pranav') && assigned === 'pranav') ||
      (userName.includes('dipak') && (assigned.includes('dipak') || assigned === 'bd01@salado.in'))
    );
  };

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      // If user scope is restricted to assigned leads only
      if (!canViewAllLeads) {
        if (!isLeadAssignedToUser(lead, currentUser)) return false;
      } else {
        // Multi-tab filter for users with 'all' scope or admin
        if (filterType === 'my') {
          if (!isLeadAssignedToUser(lead, currentUser)) return false;
        } else if (filterType === 'unassigned') {
          const rawAssigned = (lead.assigned_to || lead.assignedTo || '').toLowerCase().trim();
          const isUnassigned =
            !rawAssigned ||
            rawAssigned === 'unassigned' ||
            rawAssigned === 'none' ||
            rawAssigned === 'unassigned pool';
          if (!isUnassigned) return false;
        }
      }

      // Search query across name, email, phone
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = (lead.name || '').toLowerCase().includes(query);
        const matchesEmail = (lead.email || '').toLowerCase().includes(query);
        const matchesPhone = (lead.phone || '').includes(query);
        return matchesName || matchesEmail || matchesPhone;
      }

      return true;
    });
  }, [leads, filterType, searchQuery, currentUser, canViewAllLeads]);

  const resolveAssignee = (assignedTo) => {
    if (!assignedTo || assignedTo === 'unassigned' || assignedTo === 'none') return null;
    const lower = assignedTo.toLowerCase();
    const matched = teamMembers.find(
      (u) =>
        u.id === assignedTo ||
        u.name?.toLowerCase() === lower ||
        u.email?.toLowerCase() === lower ||
        (lower === 'pranav' && u.name?.toLowerCase().includes('pranav'))
    );
    if (matched) return matched;
    return { name: assignedTo, email: '' };
  };

  const handleAssignLead = async (leadId, assigneeName) => {
    setOpenAssigneeLeadId(null);
    const targetVal = assigneeName === 'unassigned' ? 'unassigned' : assigneeName;

    // Optimistic UI update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, assigned_to: targetVal } : l))
    );

    try {
      const { error } = await supabase
        .from('leads')
        .update({ assigned_to: targetVal })
        .eq('id', leadId);
      if (error) console.error('Failed to update assignee in Supabase:', error);
    } catch (err) {
      console.error('Network error updating assignee:', err);
    }
  };

  const handleCreateLead = async (e) => {
    e.preventDefault();
    if (!newLeadName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const leadPayload = {
      name: newLeadName.trim(),
      phone: newLeadPhone.trim() || '+91 98201 00000',
      email: newLeadEmail.trim() || `${newLeadName.toLowerCase().replace(/\s+/g, '.')}@client.in`,
      date: todayStr,
      stage: newLeadStage,
      assigned_to: 'pranav'
    };

    // Optimistic ID for instant UI feedback
    const tempId = `temp-${Date.now()}`;
    const optimisticLead = { id: tempId, ...leadPayload };
    setLeads((prev) => [optimisticLead, ...prev]);

    setNewLeadName('');
    setNewLeadPhone('');
    setNewLeadEmail('');
    setIsModalOpen(false);

    try {
      const { data, error } = await supabase
        .from('leads')
        .insert([leadPayload])
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST205') {
          setTableMissing(true);
        }
        console.warn('Supabase insert note:', error.message);
      } else if (data) {
        setTableMissing(false);
        setLeads((prev) =>
          prev.map((l) => (l.id === tempId ? data : l))
        );
      }
    } catch (err) {
      console.warn('Error inserting lead:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLead = async (leadId) => {
    // Optimistic delete
    setLeads((prev) => prev.filter((l) => l.id !== leadId));

    try {
      const { error } = await supabase.from('leads').delete().eq('id', leadId);
      if (error) {
        console.warn('Error deleting lead from Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Error deleting lead:', err);
    }
  };

  const handleUpdateLeadStage = async (leadId, newStage) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage: newStage } : l)));
    if (selectedLead && selectedLead.id === leadId) {
      setSelectedLead((prev) => ({ ...prev, stage: newStage }));
    }
    try {
      await supabase.from('leads').update({ stage: newStage }).eq('id', leadId);
    } catch (err) {
      console.warn('Error updating lead stage in Supabase:', err);
    }
  };

  const handleMoveLeadStage = (lead, targetStage) => {
    if (lead.stage === targetStage) return;

    const currentIndex = columns.findIndex((c) => c.id === lead.stage);
    const targetIndex = columns.findIndex((c) => c.id === targetStage);
    const direction = targetIndex >= currentIndex ? 'right' : 'left';

    // 1. Trigger slide-out animation on exiting column
    setAnimatingLeads((prev) => ({
      ...prev,
      [lead.id]: { direction, phase: 'exit' }
    }));

    // 2. After slide-out (220ms), move lead to new column in state and begin slide-in
    setTimeout(() => {
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, stage: targetStage } : l))
      );
      if (selectedLead && selectedLead.id === lead.id) {
        setSelectedLead((prev) => ({ ...prev, stage: targetStage }));
      }

      setAnimatingLeads((prev) => ({
        ...prev,
        [lead.id]: { direction, phase: 'enter' }
      }));

      // Background sync with Supabase
      (async () => {
        try {
          const { error } = await supabase
            .from('leads')
            .update({ stage: targetStage })
            .eq('id', lead.id);
          if (error) {
            console.error('Failed to update stage in Supabase:', error.message);
          }
        } catch (err) {
          console.error('Network error updating stage:', err);
        }
      })();

      // 3. Clear animation class after slide-in completes (260ms)
      setTimeout(() => {
        setAnimatingLeads((prev) => {
          const next = { ...prev };
          delete next[lead.id];
          return next;
        });
      }, 260);
    }, 220);
  };

  const handleUpdateLeadNotes = async (leadId, notes) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, notes } : l)));
    if (selectedLead && selectedLead.id === leadId) {
      setSelectedLead((prev) => ({ ...prev, notes }));
    }
    try {
      await supabase.from('leads').update({ notes }).eq('id', leadId);
    } catch (err) {
      console.warn('Error updating lead notes in Supabase:', err);
    }
  };

  return (
    <div className="leads-view-container">
      {/* Informative banner if Supabase table is not yet created in the schema */}
      {tableMissing && (
        <div className="leads-notice-bar">
          <div className="leads-notice-content">
            <AlertCircle size={15} color="#f59e0b" />
            <span>
              Connected to Supabase! Run the table script in <span className="leads-notice-code">supabase/schema.sql</span> to save leads to PostgreSQL.
            </span>
          </div>
          <button
            type="button"
            className="leads-notice-dismiss"
            onClick={() => setTableMissing(false)}
            title="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Controls Toolbar */}
      <div className="leads-toolbar">
        <div className="leads-filters-group">
          {canViewAllLeads ? (
            <>
              <button
                type="button"
                className={`lead-filter-btn ${filterType === 'all' ? 'active' : ''}`}
                onClick={() => setFilterType('all')}
              >
                All Leads
              </button>
              <button
                type="button"
                className={`lead-filter-btn ${filterType === 'my' ? 'active' : ''}`}
                onClick={() => setFilterType('my')}
              >
                My Leads
              </button>
              <button
                type="button"
                className={`lead-filter-btn ${filterType === 'unassigned' ? 'active' : ''}`}
                onClick={() => setFilterType('unassigned')}
              >
                Unassigned
              </button>
            </>
          ) : (
            <div className="lead-filter-btn active" style={{ cursor: 'default' }}>
              My Assigned Leads
            </div>
          )}
        </div>

        <div className="leads-actions-group">
          <div className="leads-search-wrapper">
            <Search size={15} strokeWidth={1.75} className="leads-search-icon" />
            <input
              type="text"
              className="leads-search-input"
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {canEditLead && (
            <button
              type="button"
              className="lead-create-btn"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus size={15} strokeWidth={2} />
              <span>New Lead</span>
            </button>
          )}
        </div>
      </div>

      {/* Board Container with Common Separators */}
      <div className="leads-board">
        {columns.length === 0 ? (
          [1, 2, 3, 4].map((n) => (
            <div key={n} className="leads-column">
              <div className="leads-column-header">
                <div className="leads-col-title-group">
                  <Skeleton width="85px" height="15px" borderRadius="4px" />
                </div>
                <Skeleton width="18px" height="15px" borderRadius="10px" />
              </div>
              <div className="leads-column-cards">
                {[1, 2].map((i) => (
                  <div key={i} className="lead-card-skeleton">
                    <div style={{ marginBottom: '2px' }}>
                      <Skeleton width="110px" height="14px" />
                    </div>
                    <Skeleton width="100%" height="52px" borderRadius="4px" />
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          columns.map((column) => {
            const isEntryCol = Boolean(column.is_entry);
            const columnLeads = filteredLeads.filter((l) => {
              if (l.stage === column.id) return true;
              // Fallback: if lead's stage does not match any current column, show it in the designated Entry Stage
              if (isEntryCol && !columns.some((c) => c.id === l.stage)) {
                return true;
              }
              return false;
            });

            return (
              <div key={column.id} className="leads-column">
                {/* Column Header */}
                <div className="leads-column-header">
                  <div className="leads-col-title-group">
                    <span className="leads-col-title">{column.label}</span>
                  </div>
                  <span className="leads-col-count">
                    {isLoading ? (
                      <Skeleton width="18px" height="15px" borderRadius="10px" />
                    ) : (
                      <span className="fade-in-value">{columnLeads.length}</span>
                    )}
                  </span>
                </div>

              {/* Column Cards (Shared Separators) */}
              <div className="leads-column-cards">
                {isLoading ? (
                  [1, 2].map((i) => (
                    <div key={i} className="lead-card-skeleton">
                      {/* Header with name */}
                      <div style={{ marginBottom: '2px' }}>
                        <Skeleton width="110px" height="14px" />
                      </div>

                      {/* Contact rows */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <Skeleton width="135px" height="12px" />
                        <Skeleton width="165px" height="12px" />
                        <Skeleton width="95px" height="12px" />
                      </div>

                      {/* Footer with date and actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <Skeleton width="65px" height="11px" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Skeleton width="75px" height="22px" borderRadius="4px" />
                          <Skeleton width="14px" height="14px" />
                        </div>
                      </div>
                    </div>
                  ))
                ) : columnLeads.length > 0 ? (
                  columnLeads.map((lead) => {
                    const anim = animatingLeads[lead.id];
                    let animClass = 'fade-in-card';
                    if (anim) {
                      if (anim.phase === 'exit') {
                        animClass = anim.direction === 'right' ? 'lead-card-slide-out-right' : 'lead-card-slide-out-left';
                      } else if (anim.phase === 'enter') {
                        animClass = anim.direction === 'right' ? 'lead-card-slide-in-right' : 'lead-card-slide-in-left';
                      }
                    }

                    const isStageOpen = openDropdownLeadId === lead.id;
                    const isAssigneeOpen = openAssigneeLeadId === lead.id;
                    const isOpen = isStageOpen || isAssigneeOpen;
                    const assignedUser = resolveAssignee(lead.assigned_to || lead.assignedTo);

                    return (
                      <div
                        key={lead.id}
                        className={`lead-card-item ${animClass} ${isOpen ? 'has-open-dropdown' : ''}`}
                        onClick={() => {
                          setSelectedLead(lead);
                          setIsDetailOpen(true);
                        }}
                        style={{ cursor: 'pointer', ...(isOpen ? { zIndex: 100 } : {}) }}
                      >
                        <div className="lead-card-top-row">
                          <span className="lead-card-name" title={lead.name}>{lead.name}</span>

                          {isAdmin && (
                            <div className="lead-card-assign-wrap" onClick={(e) => e.stopPropagation()}>
                              {assignedUser ? (
                                <button
                                  type="button"
                                  className={`lead-card-assignee-badge ${isAssigneeOpen ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenDropdownLeadId(null);
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    setAssigneeDirection(spaceBelow < 260 ? 'up' : 'down');
                                    setOpenAssigneeLeadId((prev) => (prev === lead.id ? null : lead.id));
                                  }}
                                  title={`Assigned to ${assignedUser.name}. Click to change.`}
                                >
                                  <span>{getInitials(assignedUser.name)}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={`lead-card-assign-plus-btn ${isAssigneeOpen ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenDropdownLeadId(null);
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    setAssigneeDirection(spaceBelow < 260 ? 'up' : 'down');
                                    setOpenAssigneeLeadId((prev) => (prev === lead.id ? null : lead.id));
                                  }}
                                  title="Assign lead to team member"
                                >
                                  <Plus size={12} strokeWidth={2.4} />
                                </button>
                              )}

                              {isAssigneeOpen && (
                                <div className={`lead-card-assignee-menu ${assigneeDirection === 'up' ? 'drop-up' : ''}`} onClick={(e) => e.stopPropagation()}>
                                  <div className="lead-card-assignee-menu-header">Assign lead</div>
                                  <div className="lead-card-assignee-menu-list">
                                    {teamMembers.map((member) => {
                                      const isSelected =
                                        assignedUser?.id === member.id ||
                                        assignedUser?.name?.toLowerCase() === member.name?.toLowerCase();
                                      return (
                                        <button
                                          key={member.id}
                                          type="button"
                                          className={`lead-card-assignee-menu-item ${isSelected ? 'selected' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleAssignLead(lead.id, member.name);
                                          }}
                                        >
                                          <div className="lead-card-assignee-item-left">
                                            <span className="lead-assignee-avatar-mini">{getInitials(member.name)}</span>
                                            <span className="lead-card-assignee-name">{member.name}</span>
                                          </div>
                                          {isSelected && <Check size={12} strokeWidth={2.5} className="lead-card-assignee-check" />}
                                        </button>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      className={`lead-card-assignee-menu-item ${!assignedUser ? 'selected' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAssignLead(lead.id, 'unassigned');
                                      }}
                                    >
                                      <div className="lead-card-assignee-item-left">
                                        <span className="lead-assignee-avatar-mini muted">—</span>
                                        <span className="lead-card-assignee-name" style={{ color: '#64748b' }}>Unassigned</span>
                                      </div>
                                      {!assignedUser && <Check size={12} strokeWidth={2.5} className="lead-card-assignee-check" />}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="lead-card-contact-info">
                          {lead.phone && (
                            <div className="lead-card-contact-row">
                              <Phone size={13} strokeWidth={2} className="lead-contact-icon" />
                              <span>{formatPhoneNumber(lead.phone)}</span>
                            </div>
                          )}
                          {lead.email && (
                            <div className="lead-card-contact-row">
                              <Mail size={13} strokeWidth={2} className="lead-contact-icon" />
                              <span>{lead.email}</span>
                            </div>
                          )}
                          {lead.city && (
                            <div className="lead-card-contact-row">
                              <MapPin size={13} strokeWidth={2} className="lead-contact-icon" />
                              <span>{lead.city}</span>
                            </div>
                          )}
                          {!lead.phone && !lead.email && !lead.city && (
                            <div className="lead-card-empty-contact">
                              <span>No contact details</span>
                            </div>
                          )}
                        </div>

                        <div className="lead-card-footer">
                          <div className="lead-card-timestamp-col">
                            <span className="lead-card-date">{formatDate(lead.date || lead.created_at)}</span>
                            {formatTime(lead.created_at || lead.date) && (
                              <span className="lead-card-time">{formatTime(lead.created_at || lead.date)}</span>
                            )}
                          </div>
                          <div className="lead-card-actions">
                            {/* Custom Stage Dropdown */}
                            <div className="lead-card-stage-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
                              {canEditLead ? (
                                <button
                                  type="button"
                                  className={`lead-card-stage-btn ${openDropdownLeadId === lead.id ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    const isUp = spaceBelow < 300;
                                    setDropdownDirection(isUp ? 'up' : 'down');
                                    setOpenDropdownLeadId((prev) => (prev === lead.id ? null : lead.id));
                                    if (isUp) {
                                      e.currentTarget.closest('.lead-card-item')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                    }
                                  }}
                                  title="Change stage"
                                  aria-label="Change stage"
                                >
                                  <span className="lead-card-stage-label">
                                    {columns.find((c) => c.id === lead.stage)?.label || 'Stage'}
                                  </span>
                                  <ChevronDown size={11} strokeWidth={2} className="lead-card-stage-chevron" />
                                </button>
                              ) : (
                                <span className="lead-card-stage-btn" style={{ cursor: 'default', opacity: 0.85 }}>
                                  <span className="lead-card-stage-label">
                                    {columns.find((c) => c.id === lead.stage)?.label || 'Stage'}
                                  </span>
                                </span>
                              )}

                              {canEditLead && openDropdownLeadId === lead.id && (
                                <div className={`lead-card-stage-menu ${dropdownDirection === 'up' ? 'drop-up' : ''}`} onClick={(e) => e.stopPropagation()}>
                                  <div className="lead-card-stage-menu-header">Move to stage</div>
                                  {columns.map((col) => {
                                    const isCurrent = lead.stage === col.id;
                                    return (
                                      <button
                                        key={col.id}
                                        type="button"
                                        className={`lead-card-stage-menu-item ${isCurrent ? 'selected' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenDropdownLeadId(null);
                                          handleMoveLeadStage(lead, col.id);
                                        }}
                                      >
                                        <div className="lead-card-stage-item-left">
                                          <span>{col.label}</span>
                                        </div>
                                        {isCurrent && <Check size={12} strokeWidth={2.5} className="lead-card-stage-check" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {canDeleteLead && (
                              <button
                                type="button"
                                className="lead-action-icon-btn lead-delete-btn"
                                title="Delete lead"
                                aria-label="Delete lead"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteLead(lead.id);
                                }}
                              >
                                <Trash2 size={14} strokeWidth={2} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="leads-column-empty">
                    No leads
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
      </div>

      {/* Quick New Lead Modal */}
      {isModalOpen && (
        <div className="lead-modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div
            className="lead-modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-modal-header">
              <h2 className="lead-modal-title">Create New Lead</h2>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleCreateLead}>
              <div className="lead-modal-body">
                <div className="lead-field-group">
                  <label className="lead-field-label">Contact Name</label>
                  <input
                    type="text"
                    className="lead-field-input"
                    placeholder="e.g. Rahul Sharma"
                    value={newLeadName}
                    onChange={(e) => setNewLeadName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Phone Number</label>
                  <input
                    type="tel"
                    className="lead-field-input"
                    placeholder="e.g. +91 98201 44582"
                    value={newLeadPhone}
                    onChange={(e) => setNewLeadPhone(e.target.value)}
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Email Address</label>
                  <input
                    type="email"
                    className="lead-field-input"
                    placeholder="e.g. rahul.sharma@company.in"
                    value={newLeadEmail}
                    onChange={(e) => setNewLeadEmail(e.target.value)}
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Initial Stage</label>
                  <select
                    className="lead-field-input"
                    value={newLeadStage}
                    onChange={(e) => setNewLeadStage(e.target.value)}
                  >
                    {columns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="lead-modal-footer">
                <button
                  type="button"
                  className="lead-modal-cancel-btn"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lead-modal-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Lead Details & Form Questionnaire Modal */}
      {/* Full Lead Details & Form Questionnaire Modal */}
      {isDetailOpen && selectedLead && (
        <div className="lead-modal-backdrop" onClick={() => setIsDetailOpen(false)}>
          <div
            className="lead-modal-container lead-detail-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-modal-header lead-detail-modal-header">
              <div className="lead-detail-modal-title-wrap">
                <span className="lead-detail-modal-title">Lead Profile</span>
                {selectedLead.form_name && (
                  <span className="lead-form-badge">{selectedLead.form_name}</span>
                )}
              </div>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setIsDetailOpen(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <div className="lead-detail-body">
              {/* Hero Banner with Avatar, Name, Metadata and Stage Selector */}
              <div className="lead-detail-hero">
                <div className="lead-detail-avatar">
                  {getInitials(selectedLead.name)}
                </div>
                <div className="lead-detail-hero-content">
                  <div className="lead-detail-hero-top">
                    <h2 className="lead-detail-name">{selectedLead.name}</h2>
                  </div>
                  <div className="lead-detail-meta-row">
                    <span className="lead-detail-meta-item">
                      <Calendar size={12} strokeWidth={2} />
                      {formatDate(selectedLead.date || selectedLead.created_at)}
                    </span>
                    {formatTime(selectedLead.created_at || selectedLead.date) && (
                      <>
                        <span className="lead-detail-meta-dot">•</span>
                        <span className="lead-detail-meta-item">
                          <Clock size={12} strokeWidth={2} />
                          {formatTime(selectedLead.created_at || selectedLead.date)}
                        </span>
                      </>
                    )}
                    {selectedLead.city && (
                      <>
                        <span className="lead-detail-meta-dot">•</span>
                        <span className="lead-detail-meta-item">
                          <MapPin size={12} strokeWidth={2} />
                          {selectedLead.city}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="lead-detail-stage-pill-wrap">
                  <span className="lead-detail-stage-caption">Stage</span>
                  <select
                    className="lead-detail-stage-select"
                    value={selectedLead.stage}
                    onChange={(e) => handleUpdateLeadStage(selectedLead.id, e.target.value)}
                    disabled={!canEditLead}
                  >
                    {columns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Monochrome Quick Actions Bar */}
              <div className="lead-detail-actions-bar">
                {selectedLead.phone && (
                  <>
                    <a
                      href={`tel:${selectedLead.phone}`}
                      className="lead-detail-btn call-btn"
                      title="Call Lead"
                    >
                      <Phone size={13} strokeWidth={2} />
                      <span>Call {formatPhoneNumber(selectedLead.phone)}</span>
                    </a>
                    <a
                      href={`https://wa.me/${selectedLead.phone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lead-detail-btn whatsapp-btn"
                      title="WhatsApp Chat"
                    >
                      <MessageSquare size={13} strokeWidth={2} />
                      <span>WhatsApp</span>
                    </a>
                  </>
                )}
                {selectedLead.email && (
                  <a
                    href={`mailto:${selectedLead.email}`}
                    className="lead-detail-btn email-btn"
                    title="Send Email"
                  >
                    <Mail size={13} strokeWidth={2} />
                    <span>Email</span>
                  </a>
                )}
              </div>

              {/* Contact Information 2x2 Grid with Field Icons */}
              <div className="lead-detail-grid">
                <div className="lead-detail-card">
                  <div className="lead-detail-card-header">
                    <div className="lead-detail-card-icon-wrap">
                      <User size={13} strokeWidth={2} />
                    </div>
                    <span className="lead-detail-card-label">Full Name</span>
                  </div>
                  <div className="lead-detail-card-val">{selectedLead.name || '—'}</div>
                </div>

                <div className="lead-detail-card">
                  <div className="lead-detail-card-header">
                    <div className="lead-detail-card-icon-wrap">
                      <Phone size={13} strokeWidth={2} />
                    </div>
                    <span className="lead-detail-card-label">Phone Number</span>
                    {selectedLead.phone && (
                      <button
                        type="button"
                        className="lead-detail-copy-btn"
                        onClick={() => copyToClipboard(selectedLead.phone, 'phone')}
                        title="Copy phone number"
                      >
                        {copiedField === 'phone' ? (
                          <Check size={11} strokeWidth={2.5} className="copied-check" />
                        ) : (
                          <Copy size={11} strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </div>
                  <div className="lead-detail-card-val">{formatPhoneNumber(selectedLead.phone) || '—'}</div>
                </div>

                <div className="lead-detail-card">
                  <div className="lead-detail-card-header">
                    <div className="lead-detail-card-icon-wrap">
                      <Mail size={13} strokeWidth={2} />
                    </div>
                    <span className="lead-detail-card-label">Email Address</span>
                    {selectedLead.email && (
                      <button
                        type="button"
                        className="lead-detail-copy-btn"
                        onClick={() => copyToClipboard(selectedLead.email, 'email')}
                        title="Copy email address"
                      >
                        {copiedField === 'email' ? (
                          <Check size={11} strokeWidth={2.5} className="copied-check" />
                        ) : (
                          <Copy size={11} strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </div>
                  <div className="lead-detail-card-val" title={selectedLead.email}>{selectedLead.email || '—'}</div>
                </div>

                <div className="lead-detail-card">
                  <div className="lead-detail-card-header">
                    <div className="lead-detail-card-icon-wrap">
                      <MapPin size={13} strokeWidth={2} />
                    </div>
                    <span className="lead-detail-card-label">City / Location</span>
                  </div>
                  <div className="lead-detail-card-val">{selectedLead.city || '—'}</div>
                </div>
              </div>

              {/* Meta Lead Form Responses */}
              <div className="lead-detail-section">
                <div className="lead-detail-section-heading">
                  <span>Meta Questionnaire Responses</span>
                  {selectedLead.custom_fields && Object.keys(selectedLead.custom_fields).length > 0 && (
                    <span className="lead-detail-section-counter">
                      {Object.keys(selectedLead.custom_fields).length} questions answered
                    </span>
                  )}
                </div>

                <div className="lead-detail-qa-list">
                  {selectedLead.custom_fields && Object.keys(selectedLead.custom_fields).length > 0 ? (
                    Object.entries(selectedLead.custom_fields).map(([question, answer]) => {
                      const displayQuestion = question
                        .replace(/_+/g, ' ')
                        .trim()
                        .replace(/^\w/, (c) => c.toUpperCase());
                      const displayAnswer = Array.isArray(answer) ? answer.join(', ') : String(answer);

                      return (
                        <div key={question} className="lead-detail-qa-card">
                          <div className="lead-detail-question">{displayQuestion}</div>
                          <div className="lead-detail-answer">{displayAnswer}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="lead-detail-qa-empty">
                      No questionnaire fields attached to this lead.
                    </div>
                  )}
                </div>
              </div>

              {/* Internal Notes Section */}
              <div className="lead-detail-section">
                <div className="lead-detail-section-heading">
                  <span>Internal Notes</span>
                </div>
                <textarea
                  className="lead-detail-notes-area"
                  placeholder="Write meeting takeaways, qualification notes, follow-up timeline..."
                  value={selectedLead.notes || ''}
                  onChange={(e) => handleUpdateLeadNotes(selectedLead.id, e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="lead-modal-footer lead-detail-footer">
              {canDeleteLead ? (
                <button
                  type="button"
                  className="lead-detail-delete-btn"
                  onClick={() => {
                    if (window.confirm(`Are you sure you want to delete lead "${selectedLead.name}"?`)) {
                      handleDeleteLead(selectedLead.id);
                      setIsDetailOpen(false);
                    }
                  }}
                  title="Delete lead permanently"
                >
                  <Trash2 size={13} strokeWidth={2} />
                  <span>Delete</span>
                </button>
              ) : <div />}
              <button
                type="button"
                className="lead-modal-submit-btn"
                onClick={() => setIsDetailOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
