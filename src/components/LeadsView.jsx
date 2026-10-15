import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Plus, X, Phone, Mail, Trash2, AlertCircle, MessageSquare, MapPin, Calendar, ChevronDown, Check, User, Copy, Clock, UploadCloud, Ghost, Activity, ArrowRight, UserCheck, CalendarClock, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission, getLeadScope } from '../lib/permissions';
import { recordActivity, fetchLeadActivities } from '../lib/activities';
import { fetchFollowUps, getStoredFollowUps, getFollowUpUrgency, formatFollowUpTime, completeFollowUp, reopenFollowUp, deleteFollowUp } from '../lib/followups';
import ScheduleFollowUpModal from './common/ScheduleFollowUpModal';
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

const formatActivityTimestamp = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const match = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const parsed = new Date(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T00:00:00`);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    }
    return dateStr;
  }

  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (isToday) {
    return `Today, ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  const dateStrFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateStrFormatted}, ${timeStr}`;
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

export default function LeadsView({ currentUser, onNavigate }) {
  const [leads, setLeads] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_leads');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { }
    return [];
  });
  const [columns, setColumns] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_pipeline_columns');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { }
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
    } catch (e) { }
    return true;
  });
  const [tableMissing, setTableMissing] = useState(false);
  const [filterType, setFilterType] = useState(canViewAllLeads ? 'all' : 'my'); // 'all' | 'my' | 'unassigned'
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef(null);

  const filterOptions = [
    { value: 'all', label: 'All Leads' },
    { value: 'my', label: 'My Leads' },
    { value: 'unassigned', label: 'Unassigned' },
    { value: 'followups', label: 'Follow-ups' }
  ];

  const userFilterOptions = canViewAllLeads
    ? filterOptions
    : [
        { value: 'my', label: 'My Assigned Leads' },
        { value: 'followups', label: 'Follow-ups' }
      ];

  const activeFilterLabel = userFilterOptions.find((o) => o.value === filterType)?.label || (canViewAllLeads ? 'All Leads' : 'My Assigned Leads');

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target)) {
        setIsFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!canViewAllLeads && filterType !== 'followups' && filterType !== 'my') {
      setFilterType('my');
    }
  }, [canViewAllLeads]);

  // Selected Lead Details Modal State
  const [selectedLead, setSelectedLead] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [leadToDelete, setLeadToDelete] = useState(null);
  const [followUpToDelete, setFollowUpToDelete] = useState(null);
  const [isDeletingFollowUp, setIsDeletingFollowUp] = useState(false);

  // Active Tab inside Lead Details Modal ('details' | 'activity')
  const [leadDetailTab, setLeadDetailTab] = useState('details');
  const [leadActivities, setLeadActivities] = useState([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);

  // Follow-ups State
  const [followUps, setFollowUps] = useState(() => getStoredFollowUps());
  const [isScheduleFollowUpOpen, setIsScheduleFollowUpOpen] = useState(false);
  const [followUpTargetLead, setFollowUpTargetLead] = useState(null);

  useEffect(() => {
    let isMounted = true;
    fetchFollowUps().then((data) => {
      if (isMounted) setFollowUps(data);
    });

    const handleFollowUpsUpdated = (e) => {
      if (e?.detail?.deleted && e?.detail?.id) {
        setFollowUps((prev) => prev.filter((f) => f.id !== e.detail.id));
      }
      fetchFollowUps().then((data) => {
        if (isMounted) {
          const result = e?.detail?.deleted && e?.detail?.id
            ? data.filter((f) => f.id !== e.detail.id)
            : data;
          setFollowUps(result);
        }
      });
    };

    window.addEventListener('crm-followups-updated', handleFollowUpsUpdated);

    // Supabase Realtime channel for multi-window / multi-device sync
    const fuChannel = supabase
      .channel('followups-realtime-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'follow_ups' },
        (payload) => {
          if (payload.eventType === 'DELETE' && payload.old?.id) {
            setFollowUps((prev) => prev.filter((f) => f.id !== payload.old.id));
          }
          fetchFollowUps().then((data) => {
            if (isMounted) setFollowUps(data);
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      window.removeEventListener('crm-followups-updated', handleFollowUpsUpdated);
      supabase.removeChannel(fuChannel);
    };
  }, []);

  // Helper to get active follow-up for a lead
  const getLeadFollowUp = (leadId, leadName, includeCompleted = false) => {
    if (!followUps || followUps.length === 0) return null;
    const matched = followUps.filter(
      (f) =>
        (includeCompleted ? true : f.status === 'pending') &&
        ((leadId && f.lead_id === leadId) || (leadName && f.lead_name?.toLowerCase() === leadName?.toLowerCase()))
    );
    if (matched.length === 0) return null;
    return matched.sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
  };

  const followUpColumnsData = useMemo(() => {
    if (!followUps || !Array.isArray(followUps)) {
      return { missed: [], today: [], upcoming: [], done: [] };
    }

    let items = [...followUps];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (f) =>
          (f.lead_name || '').toLowerCase().includes(q) ||
          (f.title || '').toLowerCase().includes(q) ||
          (f.description || '').toLowerCase().includes(q) ||
          (f.lead_phone || '').includes(q)
      );
    }

    const missedItems = [];
    const todayItems = [];
    const upcomingItems = [];
    const doneItems = [];

    items.forEach((item) => {
      if (item.status === 'completed') {
        doneItems.push(item);
      } else {
        const urgency = getFollowUpUrgency(item.due_date);
        if (urgency === 'overdue') {
          missedItems.push(item);
        } else if (urgency === 'today') {
          todayItems.push(item);
        } else {
          upcomingItems.push(item);
        }
      }
    });

    missedItems.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    todayItems.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    upcomingItems.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    doneItems.sort((a, b) => new Date(b.completed_at || b.due_date) - new Date(a.completed_at || a.due_date));

    const resolveToLead = (item) => {
      const matched = leads.find(
        (l) => (item.lead_id && l.id === item.lead_id) || (item.lead_name && l.name?.toLowerCase() === item.lead_name?.toLowerCase())
      );
      if (matched) return matched;
      return {
        id: item.lead_id || item.id,
        name: item.lead_name || 'Prospect',
        phone: item.lead_phone || '',
        email: item.lead_email || '',
        city: '',
        stage: columns[0]?.id || 'new',
        created_at: item.created_at || item.due_date,
        date: item.created_at || item.due_date
      };
    };

    const dedupeLeads = (itemList) => {
      const seen = new Set();
      const list = [];
      itemList.forEach((item) => {
        const lead = resolveToLead(item);
        if (!seen.has(lead.id)) {
          seen.add(lead.id);
          list.push({ ...lead, _followUp: item });
        }
      });
      return list;
    };

    return {
      missed: dedupeLeads(missedItems),
      today: dedupeLeads(todayItems),
      upcoming: dedupeLeads(upcomingItems),
      done: dedupeLeads(doneItems)
    };
  }, [followUps, leads, searchQuery, columns]);

  const followUpColumns = useMemo(() => [
    { id: 'missed', label: 'Missed', items: followUpColumnsData.missed, isMissed: true },
    { id: 'today', label: 'Today', items: followUpColumnsData.today },
    { id: 'upcoming', label: 'Upcoming', items: followUpColumnsData.upcoming },
    { id: 'done', label: 'Done', items: followUpColumnsData.done, isDone: true }
  ], [followUpColumnsData]);

  useEffect(() => {
    if (!isDetailOpen || !selectedLead) return;

    let isMounted = true;
    setIsLoadingActivities(true);

    const loadActivities = async () => {
      try {
        const acts = await fetchLeadActivities(selectedLead);
        if (isMounted) {
          setLeadActivities(acts);
          setIsLoadingActivities(false);
        }
      } catch (err) {
        if (isMounted) setIsLoadingActivities(false);
      }
    };

    loadActivities();

    const handleLogged = (e) => {
      const newAct = e.detail;
      if (
        newAct &&
        ((selectedLead.id && newAct.lead_id === selectedLead.id) ||
          (selectedLead.name && newAct.lead_name === selectedLead.name))
      ) {
        setLeadActivities((prev) => [newAct, ...prev.filter((a) => a.id !== newAct.id)]);
      }
    };

    window.addEventListener('crm-activity-logged', handleLogged);
    return () => {
      isMounted = false;
      window.removeEventListener('crm-activity-logged', handleLogged);
    };
  }, [isDetailOpen, selectedLead]);

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

  // Drag and Drop & Auto-scroll State
  const boardRef = useRef(null);
  const [draggedLeadId, setDraggedLeadId] = useState(null);
  const [dragOverColumnId, setDragOverColumnId] = useState(null);
  const justDraggedRef = useRef(false);

  const draggedLead = useMemo(() => {
    if (!draggedLeadId) return null;
    return leads.find((l) => l.id === draggedLeadId) || null;
  }, [leads, draggedLeadId]);

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
    const handleDocumentMouseDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') {
        if (window.getSelection && !window.getSelection().isCollapsed) {
          window.getSelection().removeAllRanges();
        }
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      stopAutoScroll();
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, []);

  const handleDragStart = (e, lead) => {
    if (e.target.closest('button, input, select, .lead-card-assign-wrap, .stage-custom-trigger, .lead-card-delete-btn')) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    setDraggedLeadId(lead.id);
    justDraggedRef.current = true;
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';

    const cardElement = e.currentTarget.closest('.lead-card-item') || e.currentTarget;
    if (cardElement && e.dataTransfer.setDragImage) {
      const rect = cardElement.getBoundingClientRect();
      const offsetX = Math.min(Math.max(20, e.clientX - rect.left), rect.width - 20);
      const offsetY = Math.min(Math.max(16, e.clientY - rect.top), rect.height - 16);
      e.dataTransfer.setDragImage(cardElement, offsetX, offsetY);
    }

    setOpenDropdownLeadId(null);
    setOpenAssigneeLeadId(null);
  };

  const handleDragEnd = () => {
    setDraggedLeadId(null);
    setDragOverColumnId(null);
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

    // Near left edge of board
    if (x < rect.left + edgeThreshold && x >= rect.left - 50) {
      const distance = Math.max(0, rect.left + edgeThreshold - x);
      const intensity = distance / edgeThreshold;
      scrollVelocityRef.current = -Math.max(4, Math.round(intensity * maxSpeed));
      startAutoScroll();
    }
    // Near right edge of board
    else if (x > rect.right - edgeThreshold && x <= rect.right + 50) {
      const distance = Math.max(0, x - (rect.right - edgeThreshold));
      const intensity = distance / edgeThreshold;
      scrollVelocityRef.current = Math.max(4, Math.round(intensity * maxSpeed));
      startAutoScroll();
    } else {
      scrollVelocityRef.current = 0;
    }

    // Vertical auto-scroll for tall columns
    const colCards = e.target.closest?.('.leads-column-cards');
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

  const handleColumnDragOver = (e, columnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== columnId) {
      setDragOverColumnId(columnId);
    }
  };

  const handleColumnDrop = async (e, targetColumnId) => {
    e.preventDefault();
    stopAutoScroll();
    setDragOverColumnId(null);

    const leadId = e.dataTransfer.getData('text/plain') || draggedLeadId;
    if (!leadId) return;

    const leadToMove = leads.find((l) => l.id === leadId);
    if (!leadToMove || leadToMove.stage === targetColumnId) {
      setDraggedLeadId(null);
      return;
    }

    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 150);

    // Optimistic local state update - prepend moved lead to top of list
    const movedLead = { ...leadToMove, stage: targetColumnId };
    setLeads((prev) => [movedLead, ...prev.filter((l) => l.id !== leadId)]);
    setDraggedLeadId(null);

    // Record activity for recent activity feed
    recordActivity({
      type: 'stage_change',
      leadId: leadToMove.id,
      leadName: leadToMove.name,
      fromStage: leadToMove.stage,
      toStage: targetColumnId,
      assignedTo: leadToMove.assigned_to || leadToMove.assignedTo,
      userName: currentUser?.name
    });

    // Persist stage update in Supabase
    try {
      const { error } = await supabase
        .from('leads')
        .update({ stage: targetColumnId })
        .eq('id', leadId);

      if (error) {
        console.error('Error updating lead stage on drop:', error);
        // Revert on error
        setLeads((prev) => [leadToMove, ...prev.filter((l) => l.id !== leadId)]);
      }
    } catch (err) {
      console.error('Network error on lead drop:', err);
    }
  };

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
          } catch (e) { }
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
            } catch (e) { }
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
    } catch (e) { }
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
          } catch (e) { }
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
            setLeads((prev) => {
              const old = prev.find((l) => l.id === payload.new.id);
              if (old && old.stage !== payload.new.stage) {
                // If stage changed, move to top of the list
                return [payload.new, ...prev.filter((l) => l.id !== payload.new.id)];
              }
              return prev.map((l) => (l.id === payload.new.id ? payload.new : l));
            });
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
      } catch (e) { }
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
    const targetLead = leads.find((l) => l.id === leadId) || (selectedLead && selectedLead.id === leadId ? selectedLead : null);
    const prevAssignee = targetLead?.assigned_to || targetLead?.assignedTo;

    // Optimistic UI update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, assigned_to: targetVal } : l))
    );
    if (selectedLead && selectedLead.id === leadId) {
      setSelectedLead((prev) => ({ ...prev, assigned_to: targetVal }));
    }

    if (targetLead && prevAssignee !== targetVal) {
      recordActivity({
        type: 'assignment',
        leadId,
        leadName: targetLead.name,
        assignedTo: targetVal,
        userName: currentUser?.name
      });
    }

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

  const handleDeleteFollowUp = async (followUpTarget) => {
    if (!followUpTarget) return;
    const followUpId = followUpTarget.id || followUpTarget;
    try {
      setIsDeletingFollowUp(true);
      // Immediately filter out from state so UI updates in real-time
      setFollowUps((prev) =>
        prev.filter((f) => {
          if (f.id === followUpId) return false;
          if (followUpTarget.title && f.title === followUpTarget.title) {
            if (followUpTarget.lead_id && f.lead_id === followUpTarget.lead_id) return false;
            if (followUpTarget.lead_name && f.lead_name === followUpTarget.lead_name) return false;
          }
          return true;
        })
      );
      await deleteFollowUp(followUpId, currentUser?.name);
      if (isDetailOpen && selectedLead?.id === followUpTarget.lead_id) {
        setIsDetailOpen(false);
      }
    } catch (err) {
      console.warn('Error deleting follow-up:', err);
    } finally {
      setIsDeletingFollowUp(false);
      setFollowUpToDelete(null);
    }
  };

  const handleToggleFollowUpDone = async (fu, shouldComplete) => {
    if (!fu?.id) return;
    const followUpId = fu.id;
    try {
      // Optimistic state update
      setFollowUps((prev) =>
        prev.map((f) =>
          f.id === followUpId
            ? {
                ...f,
                status: shouldComplete ? 'completed' : 'pending',
                completed_at: shouldComplete ? new Date().toISOString() : null
              }
            : f
        )
      );
      if (shouldComplete) {
        await completeFollowUp(followUpId, currentUser?.name);
      } else {
        await reopenFollowUp(followUpId, currentUser?.name);
      }
    } catch (err) {
      console.warn('Error toggling follow-up status:', err);
    }
  };

  const handleUpdateLeadStage = async (leadId, newStage) => {
    const targetLead = leads.find((l) => l.id === leadId);
    if (!targetLead) return;
    const movedLead = { ...targetLead, stage: newStage };
    // Prepend to top of destination column
    setLeads((prev) => [movedLead, ...prev.filter((l) => l.id !== leadId)]);
    if (selectedLead && selectedLead.id === leadId) {
      setSelectedLead(movedLead);
    }
    if (targetLead && targetLead.stage !== newStage) {
      recordActivity({
        type: 'stage_change',
        leadId,
        leadName: targetLead.name,
        fromStage: targetLead.stage,
        toStage: newStage,
        assignedTo: targetLead.assigned_to || targetLead.assignedTo,
        userName: currentUser?.name
      });
    }
    try {
      await supabase.from('leads').update({ stage: newStage }).eq('id', leadId);
    } catch (err) {
      console.warn('Error updating lead stage in Supabase:', err);
    }
  };

  const handleMoveLeadStage = (lead, targetStage) => {
    if (lead.stage === targetStage) return;

    recordActivity({
      type: 'stage_change',
      leadId: lead.id,
      leadName: lead.name,
      fromStage: lead.stage,
      toStage: targetStage,
      assignedTo: lead.assigned_to || lead.assignedTo,
      userName: currentUser?.name
    });

    const currentIndex = columns.findIndex((c) => c.id === lead.stage);
    const targetIndex = columns.findIndex((c) => c.id === targetStage);
    const direction = targetIndex >= currentIndex ? 'right' : 'left';

    // 1. Trigger slide-out animation on exiting column
    setAnimatingLeads((prev) => ({
      ...prev,
      [lead.id]: { direction, phase: 'exit' }
    }));

    // 2. After slide-out (220ms), move lead to new column at the top and begin slide-in
    setTimeout(() => {
      const movedLead = { ...lead, stage: targetStage };
      setLeads((prev) => [movedLead, ...prev.filter((l) => l.id !== lead.id)]);
      if (selectedLead && selectedLead.id === lead.id) {
        setSelectedLead(movedLead);
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

  const renderLeadCard = (lead, includeCompletedFollowUp = false, isFollowUpCol = false) => {
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
        className={`lead-card-item ${animClass} ${isOpen ? 'has-open-dropdown' : ''} ${draggedLeadId === lead.id ? 'is-dragging' : ''} ${isFollowUpCol ? 'no-drag' : ''}`}
        draggable={!isFollowUpCol}
        onDragStart={isFollowUpCol ? undefined : (e) => handleDragStart(e, lead)}
        onDragEnd={isFollowUpCol ? undefined : handleDragEnd}
        onClick={() => {
          if (justDraggedRef.current) return;
          setSelectedLead(lead);
          setLeadDetailTab('details');
          setIsDetailOpen(true);
        }}
        style={{ cursor: 'pointer', ...(isOpen ? { zIndex: 100 } : {}) }}
      >
        <div
          className="lead-card-header-handle"
          title={isFollowUpCol ? undefined : "Drag to move card to another column"}
        >
          <span className="lead-card-name" title={lead.name}>{lead.name}</span>

          {!isFollowUpCol && isAdmin && (
            <div className="lead-card-assign-wrap" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
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
          {!isFollowUpCol && lead.email && (
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
          {!lead.phone && (!isFollowUpCol ? !lead.email : true) && !lead.city && (
            <div className="lead-card-empty-contact">
              <span>No contact details</span>
            </div>
          )}
        </div>

        <div className="lead-card-footer">
          {!isFollowUpCol && (
            <div className="lead-card-timestamp-col">
              <span className="lead-card-date">{formatDate(lead.date || lead.created_at)}</span>
              {formatTime(lead.created_at || lead.date) && (
                <span className="lead-card-time">{formatTime(lead.created_at || lead.date)}</span>
              )}
            </div>
          )}
          <div className="lead-card-actions" style={isFollowUpCol ? { width: '100%', justifyContent: 'space-between' } : undefined}>
            {isFollowUpCol ? (
              (() => {
                const fu = lead._followUp || getLeadFollowUp(lead.id, lead.name, includeCompletedFollowUp);
                const isDone = fu?.status === 'completed' || Boolean(includeCompletedFollowUp);
                return (
                  <button
                    type="button"
                    className={`lead-card-followup-toggle-btn ${isDone ? 'is-done' : 'is-pending'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fu) handleToggleFollowUpDone(fu, !isDone);
                    }}
                    title={isDone ? "Mark as undone (reopen)" : "Mark as done"}
                    aria-label={isDone ? "Mark as undone (reopen)" : "Mark as done"}
                  >
                    {isDone ? (
                      <>
                        <RotateCcw size={11} strokeWidth={2.4} />
                        <span>Undone</span>
                      </>
                    ) : (
                      <>
                        <Check size={11} strokeWidth={2.6} />
                        <span>Done</span>
                      </>
                    )}
                  </button>
                );
              })()
            ) : (
              /* Custom Stage Dropdown */
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
            )}

            {canDeleteLead && (
              <button
                type="button"
                className="lead-action-icon-btn lead-delete-btn"
                title={isFollowUpCol ? "Delete follow-up" : "Delete lead"}
                aria-label={isFollowUpCol ? "Delete follow-up" : "Delete lead"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isFollowUpCol) {
                    const fu = lead._followUp || getLeadFollowUp(lead.id, lead.name, includeCompletedFollowUp);
                    if (fu) {
                      setFollowUpToDelete({ lead, followUp: fu });
                    }
                    return;
                  }
                  setLeadToDelete(lead);
                }}
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {(() => {
          const leadFollowUp = getLeadFollowUp(lead.id, lead.name, includeCompletedFollowUp);
          if (!leadFollowUp) return null;
          const urgency = leadFollowUp.status === 'completed' ? 'done' : getFollowUpUrgency(leadFollowUp.due_date);
          return (
            <div
              className={`lead-card-followup-footer followup-${urgency}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLead(lead);
                setIsDetailOpen(true);
              }}
              title={`Follow-up: ${leadFollowUp.title} (${formatFollowUpTime(leadFollowUp.due_date)})`}
            >
              <div className="lead-card-followup-content">
                <Clock size={11} strokeWidth={2.2} className="lead-card-followup-icon" />
                <span className="lead-card-followup-title">
                  {leadFollowUp.title}
                </span>
              </div>
              <span className="lead-card-followup-time">
                {formatFollowUpTime(leadFollowUp.due_date)}
              </span>
            </div>
          );
        })()}
      </div>
    );
  };

  const selectedLeadFollowUp = selectedLead
    ? selectedLead._followUp || getLeadFollowUp(selectedLead.id, selectedLead.name, true)
    : null;

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
          <div className="leads-filter-dropdown-wrap" ref={filterDropdownRef}>
            <button
              type="button"
              className={`lead-filter-dropdown-btn ${isFilterDropdownOpen ? 'active' : ''}`}
              onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={isFilterDropdownOpen}
            >
              <span>{activeFilterLabel}</span>
              <ChevronDown size={14} strokeWidth={2} className={`filter-chevron ${isFilterDropdownOpen ? 'open' : ''}`} />
            </button>

            {isFilterDropdownOpen && (
              <div className="lead-filter-dropdown-menu" role="listbox">
                {userFilterOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={filterType === opt.value}
                    className={`lead-filter-dropdown-item ${filterType === opt.value ? 'selected' : ''}`}
                    onClick={() => {
                      setFilterType(opt.value);
                      setIsFilterDropdownOpen(false);
                    }}
                  >
                    <span>{opt.label}</span>
                    {filterType === opt.value && <Check size={14} strokeWidth={2} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="leads-actions-group">
          <div className="leads-search-wrapper">
            <Search size={15} strokeWidth={1.75} className="leads-search-icon" />
            <input
              type="text"
              className="leads-search-input"
              placeholder={filterType === 'followups' ? 'Search follow-ups...' : 'Search leads...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {currentUser?.role === 'admin' && onNavigate && (
            <button
              type="button"
              className="lead-import-btn"
              onClick={() => onNavigate('Admin', 'import')}
              title="Import leads in bulk from CSV"
            >
              <UploadCloud size={14} strokeWidth={1.8} />
              <span>Import CSV</span>
            </button>
          )}

          {filterType === 'followups' ? (
            <button
              type="button"
              className="lead-create-btn"
              onClick={() => {
                setFollowUpTargetLead(null);
                setIsScheduleFollowUpOpen(true);
              }}
              title="Schedule a new follow-up"
            >
              <Plus size={15} strokeWidth={2} />
              <span>New Follow-up</span>
            </button>
          ) : (
            canEditLead && (
              <button
                type="button"
                className="lead-create-btn"
                onClick={() => setIsModalOpen(true)}
              >
                <Plus size={15} strokeWidth={2} />
                <span>New Lead</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Board Container with Common Separators */}
      <div
        ref={boardRef}
        className={`leads-board ${filterType === 'followups' ? 'followups-mode' : ''} ${draggedLeadId ? 'is-dragging-active' : ''}`}
        onDragOver={handleBoardDragOver}
        onDragLeave={stopAutoScroll}
        onDrop={stopAutoScroll}
      >
        {filterType === 'followups' ? (
          followUpColumns.map((col) => {
            return (
              <div
                key={col.id}
                className="leads-column followups-column"
              >
                {/* Column Header */}
                <div className="leads-column-header">
                  <div className="leads-col-title-group">
                    <span className="leads-col-title">{col.label}</span>
                  </div>
                  <span className="leads-col-count">
                    <span className="fade-in-value">{col.items.length}</span>
                  </span>
                </div>

                {/* Column Cards */}
                <div className="leads-column-cards">
                  {col.items.length > 0 ? (
                    col.items.map((lead) => renderLeadCard(lead, Boolean(col.isDone), true))
                  ) : (
                    <div className="leads-column-empty">
                      <Ghost size={46} strokeWidth={1.2} className="leads-empty-ghost" />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : columns.length === 0 ? (
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

            const isCurrentStage = Boolean(
              draggedLead && (
                draggedLead.stage === column.id ||
                (isEntryCol && (!draggedLead.stage || draggedLead.stage === 'new' || draggedLead.stage === 'New Leads'))
              )
            );
            const isTargetColumn = dragOverColumnId === column.id && draggedLead && !isCurrentStage;

            return (
              <div
                key={column.id}
                className={`leads-column ${isTargetColumn ? 'drag-over-column' : ''}`}
                onDragOver={(e) => handleColumnDragOver(e, column.id)}
                onDrop={(e) => handleColumnDrop(e, column.id)}
              >
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
                <div
                  className="leads-column-cards"
                  onDragOver={(e) => handleColumnDragOver(e, column.id)}
                  onDrop={(e) => handleColumnDrop(e, column.id)}
                >
                  {/* Drop Preview of dragged card in target column */}
                  {isTargetColumn && draggedLead && (
                    <div className="lead-card-drop-preview">
                      <svg className="drop-preview-animated-border" aria-hidden="true">
                        <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="8" ry="8" />
                      </svg>
                      <div className="lead-card-header-handle" style={{ cursor: 'default' }}>
                        <span className="lead-card-name" title={draggedLead.name}>{draggedLead.name}</span>
                        {resolveAssignee(draggedLead.assigned_to || draggedLead.assignedTo) && (
                          <div className="lead-card-assign-wrap" style={{ pointerEvents: 'none' }}>
                            <span className="lead-card-assignee-badge">
                              {getInitials(resolveAssignee(draggedLead.assigned_to || draggedLead.assignedTo)?.name)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="lead-card-contact-info">
                        {draggedLead.phone && (
                          <div className="lead-card-contact-row">
                            <Phone size={13} strokeWidth={2} className="lead-contact-icon" />
                            <span>{formatPhoneNumber(draggedLead.phone)}</span>
                          </div>
                        )}
                        {draggedLead.email && (
                          <div className="lead-card-contact-row">
                            <Mail size={13} strokeWidth={2} className="lead-contact-icon" />
                            <span>{draggedLead.email}</span>
                          </div>
                        )}
                        {draggedLead.city && (
                          <div className="lead-card-contact-row">
                            <MapPin size={13} strokeWidth={2} className="lead-contact-icon" />
                            <span>{draggedLead.city}</span>
                          </div>
                        )}
                        {!draggedLead.phone && !draggedLead.email && !draggedLead.city && (
                          <div className="lead-card-empty-contact">
                            <span>No contact details</span>
                          </div>
                        )}
                      </div>
                      <div className="lead-card-footer">
                        <div className="lead-card-timestamp-col">
                          <span className="lead-card-date">{formatDate(draggedLead.date || draggedLead.created_at)}</span>
                          {formatTime(draggedLead.created_at || draggedLead.date) && (
                            <span className="lead-card-time">{formatTime(draggedLead.created_at || draggedLead.date)}</span>
                          )}
                        </div>
                        <div className="lead-card-actions">
                          <span className="lead-card-stage-btn" style={{ pointerEvents: 'none' }}>
                            <span className="lead-card-stage-label">{column.label}</span>
                          </span>
                        </div>
                      </div>
                      {(() => {
                        const previewFu = getLeadFollowUp(draggedLead.id, draggedLead.name);
                        if (!previewFu) return null;
                        const pUrgency = getFollowUpUrgency(previewFu.due_date);
                        return (
                          <div className={`lead-card-followup-footer followup-${pUrgency}`} style={{ pointerEvents: 'none' }}>
                            <div className="lead-card-followup-content">
                              <Clock size={11} strokeWidth={2.2} className="lead-card-followup-icon" />
                              <span className="lead-card-followup-title">{previewFu.title}</span>
                            </div>
                            <span className="lead-card-followup-time">{formatFollowUpTime(previewFu.due_date)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

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
                    columnLeads.map((lead) => renderLeadCard(lead))
                  ) : isTargetColumn ? null : (
                    <div className="leads-column-empty">
                      <Ghost size={46} strokeWidth={1.2} className="leads-empty-ghost" />
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
      {/* Centered Lead Details Properties Table Modal */}
      {isDetailOpen && selectedLead && (
        <div className="lead-modal-backdrop" onClick={() => setIsDetailOpen(false)}>
          <div
            className="lead-modal-container lead-properties-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="lead-modal-header lead-properties-header">
              <div className="lead-properties-header-content">
                <div className="lead-properties-header-left">
                  <span className="lead-properties-modal-title">{selectedLead.name}</span>
                </div>
                <div className="lead-properties-header-right">
                  {selectedLead.phone && (
                    <a
                      href={`https://wa.me/${selectedLead.phone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lead-prop-action-btn"
                      title="WhatsApp Web"
                    >
                      <MessageSquare size={12} strokeWidth={2} />
                      <span>WhatsApp</span>
                    </a>
                  )}
                  {selectedLead.email && (
                    <a
                      href={`mailto:${selectedLead.email}`}
                      className="lead-prop-action-btn"
                      title="Send Email"
                    >
                      <Mail size={12} strokeWidth={2} />
                      <span>Email</span>
                    </a>
                  )}
                  {(!selectedLeadFollowUp || selectedLeadFollowUp.status === 'completed') && filterType !== 'followups' && (
                    <button
                      type="button"
                      className="lead-prop-action-btn"
                      onClick={() => {
                        setFollowUpTargetLead(selectedLead);
                        setIsScheduleFollowUpOpen(true);
                      }}
                      title="Schedule Follow-up"
                    >
                      <CalendarClock size={12} strokeWidth={2} />
                      <span>Follow-up</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="lead-properties-close-wrap">
                <button
                  type="button"
                  className="lead-properties-seamless-close-btn"
                  onClick={() => setIsDetailOpen(false)}
                  aria-label="Close"
                  title="Close"
                >
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Modal Body: Switch between Properties and Activity Timeline */}
            {leadDetailTab === 'details' ? (
              <div className="lead-properties-body">
                {selectedLeadFollowUp && (
                  <div className="lead-modal-followup-card">
                    <div className="lead-modal-followup-card-header">
                      <div className="lead-modal-followup-card-title-group">
                        <Clock size={15} strokeWidth={2.2} className="lead-modal-followup-card-icon" />
                        <span className="lead-modal-followup-card-title">
                          {selectedLeadFollowUp.title || 'Follow-up Remarks'}
                        </span>
                      </div>
                      <span
                        className={`lead-modal-followup-card-badge badge-${
                          selectedLeadFollowUp.status === 'completed'
                            ? 'done'
                            : getFollowUpUrgency(selectedLeadFollowUp.due_date)
                        }`}
                      >
                        {selectedLeadFollowUp.status === 'completed'
                          ? 'Completed'
                          : formatFollowUpTime(selectedLeadFollowUp.due_date)}
                      </span>
                    </div>
                    {selectedLeadFollowUp.description ? (
                      <div className="lead-modal-followup-card-desc">
                        {selectedLeadFollowUp.description}
                      </div>
                    ) : (
                      <div className="lead-modal-followup-card-desc empty">
                        No additional remarks provided.
                      </div>
                    )}
                  </div>
                )}

                <table className="lead-properties-table">
                  <tbody>
                    <tr>
                      <td className="lead-prop-label">Full Name</td>
                      <td className="lead-prop-value">{selectedLead.name || '—'}</td>
                    </tr>

                    <tr>
                      <td className="lead-prop-label">Phone Number</td>
                      <td className="lead-prop-value">
                        <div className="lead-prop-copy-wrap">
                          <span>{formatPhoneNumber(selectedLead.phone) || '—'}</span>
                          {selectedLead.phone && (
                            <button
                              type="button"
                              className="lead-prop-copy-btn"
                              onClick={() => copyToClipboard(selectedLead.phone, 'phone')}
                              title="Copy Phone"
                            >
                              {copiedField === 'phone' ? (
                                <Check size={11} strokeWidth={2.5} className="copied-check" />
                              ) : (
                                <Copy size={11} strokeWidth={2} />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td className="lead-prop-label">Email Address</td>
                      <td className="lead-prop-value">
                        <div className="lead-prop-copy-wrap">
                          <span>{selectedLead.email || '—'}</span>
                          {selectedLead.email && (
                            <button
                              type="button"
                              className="lead-prop-copy-btn"
                              onClick={() => copyToClipboard(selectedLead.email, 'email')}
                              title="Copy Email"
                            >
                              {copiedField === 'email' ? (
                                <Check size={11} strokeWidth={2.5} className="copied-check" />
                              ) : (
                                <Copy size={11} strokeWidth={2} />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td className="lead-prop-label">City / Location</td>
                      <td className="lead-prop-value">{selectedLead.city || '—'}</td>
                    </tr>

                    <tr>
                      <td className="lead-prop-label">Pipeline Stage</td>
                      <td className="lead-prop-value">
                        <select
                          className="lead-prop-select"
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
                      </td>
                    </tr>

                    {isAdmin && (
                      <tr>
                        <td className="lead-prop-label">Assigned To</td>
                        <td className="lead-prop-value">
                          <select
                            className="lead-prop-select"
                            value={selectedLead.assigned_to || selectedLead.assignedTo || 'unassigned'}
                            onChange={(e) => handleAssignLead(selectedLead.id, e.target.value)}
                          >
                            <option value="unassigned">Unassigned</option>
                            {teamMembers.map((m) => (
                              <option key={m.id} value={m.name}>
                                {m.name} ({m.role})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )}

                    <tr>
                      <td className="lead-prop-label">Lead Source</td>
                      <td className="lead-prop-value">{selectedLead.form_name || selectedLead.source || 'Meta Ad Campaign'}</td>
                    </tr>

                    <tr>
                      <td className="lead-prop-label">Created Date</td>
                      <td className="lead-prop-value">
                        {formatDate(selectedLead.date || selectedLead.created_at)}
                        {formatTime(selectedLead.created_at || selectedLead.date) ? ` at ${formatTime(selectedLead.created_at || selectedLead.date)}` : ''}
                      </td>
                    </tr>

                    {/* Notes Row */}
                    <tr>
                      <td className="lead-prop-label lead-prop-notes-label">Internal Notes</td>
                      <td className="lead-prop-value">
                        <textarea
                          className="lead-prop-notes-area"
                          placeholder="Write meeting takeaways, qualification notes, follow-up timeline..."
                          value={selectedLead.notes || ''}
                          onChange={(e) => handleUpdateLeadNotes(selectedLead.id, e.target.value)}
                          rows={3}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Table 2: Meta Questionnaire Responses */}
                {selectedLead.custom_fields && Object.keys(selectedLead.custom_fields).length > 0 && (
                  <div className="lead-prop-table-section">
                    <div className="lead-prop-section-divider-bar">
                      <span className="lead-prop-section-title">Meta Form Responses</span>
                      <span className="lead-prop-section-badge">
                        {Object.keys(selectedLead.custom_fields).length} {Object.keys(selectedLead.custom_fields).length === 1 ? 'question' : 'questions'}
                      </span>
                    </div>
                    <table className="lead-properties-table">
                      <tbody>
                        {Object.entries(selectedLead.custom_fields).map(([question, answer]) => {
                          const displayQuestion = question
                            .replace(/_+/g, ' ')
                            .trim()
                            .replace(/^\w/, (c) => c.toUpperCase());
                          const displayAnswer = Array.isArray(answer) ? answer.join(', ') : String(answer);
                          return (
                            <tr key={question}>
                              <td className="lead-prop-label">{displayQuestion}</td>
                              <td className="lead-prop-value">{displayAnswer}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="lead-properties-body lead-audit-table-wrap">
                {isLoadingActivities ? (
                  <div className="lead-activity-tab-loading">
                    <Clock size={16} className="spinning" />
                    <span>Loading audit records...</span>
                  </div>
                ) : leadActivities.length === 0 ? (
                  <div className="lead-activity-tab-empty">
                    <Ghost size={32} strokeWidth={1.2} />
                    <p>No activity records logged yet for this lead.</p>
                  </div>
                ) : (
                  <table className="lead-audit-table">
                    <thead>
                      <tr>
                        <th className="audit-col-time">Time</th>
                        <th className="audit-col-event">Event</th>
                        <th className="audit-col-details">Details</th>
                        <th className="audit-col-user">User / Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leadActivities.map((act, index) => {
                        const isArrival =
                          act.type === 'lead_created' || act.type === 'arrival' || act.type === 'lead_received';
                        const isAssignment = act.type === 'assignment';
                        const isStageChange = act.type === 'stage_change';

                        const fromLabel =
                          columns.find((c) => c.id === act.from_stage)?.label || act.from_stage || 'Initial';
                        const toLabel =
                          columns.find((c) => c.id === act.to_stage)?.label || act.to_stage || 'Stage';

                        return (
                          <tr key={act.id || index}>
                            <td className="audit-cell-time">
                              {formatActivityTimestamp(act.created_at)}
                            </td>
                            <td className="audit-cell-event">
                              <span
                                className={`audit-pill ${
                                  isStageChange
                                    ? 'audit-pill-stage'
                                    : isAssignment
                                    ? 'audit-pill-assign'
                                    : isArrival
                                    ? 'audit-pill-arrival'
                                    : 'audit-pill-default'
                                }`}
                              >
                                {isStageChange
                                  ? 'Stage Change'
                                  : isAssignment
                                  ? 'Assignment'
                                  : isArrival
                                  ? 'Lead Ingested'
                                  : 'Update'}
                              </span>
                            </td>
                            <td className="audit-cell-details">
                              {isStageChange && (
                                <div className="audit-stage-transition">
                                  <span className="audit-stage-tag">{fromLabel}</span>
                                  <span className="audit-stage-arrow">→</span>
                                  <span className="audit-stage-tag active">{toLabel}</span>
                                </div>
                              )}
                              {isAssignment && (
                                <span className="audit-text-main">
                                  Assigned to <strong>{act.assigned_to === 'unassigned' ? 'Unassigned' : act.assigned_to}</strong>
                                </span>
                              )}
                              {isArrival && (
                                <div className="audit-arrival-info">
                                  <span>{act.source || selectedLead.form_name || selectedLead.source || 'Meta Ad Campaign'}</span>
                                  {selectedLead.custom_fields && Object.keys(selectedLead.custom_fields).length > 0 && (
                                    <span className="audit-field-count">
                                      ({Object.keys(selectedLead.custom_fields).length} form answers)
                                    </span>
                                  )}
                                </div>
                              )}
                              {!isStageChange && !isAssignment && !isArrival && (
                                <span>{act.details || 'Lead modified'}</span>
                              )}
                            </td>
                            <td className="audit-cell-user">
                              {act.user_name || (isArrival ? 'System (Webhook)' : isAssignment ? 'Lead Routing' : 'Admin')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div className="lead-modal-footer lead-properties-footer">
              <div className="lead-properties-footer-left">
                <div className="lead-footer-segmented-toggle">
                  <button
                    type="button"
                    className={`lead-footer-toggle-btn ${leadDetailTab === 'details' ? 'active' : ''}`}
                    onClick={() => setLeadDetailTab('details')}
                  >
                    Properties
                  </button>
                  <button
                    type="button"
                    className={`lead-footer-toggle-btn ${leadDetailTab === 'activity' ? 'active' : ''}`}
                    onClick={() => setLeadDetailTab('activity')}
                  >
                    <span>Activity</span>
                    {leadActivities.length > 0 && (
                      <span className="lead-footer-toggle-badge">{leadActivities.length}</span>
                    )}
                  </button>
                </div>
                {canDeleteLead && (
                  filterType === 'followups' ? (
                    selectedLeadFollowUp && (
                      <button
                        type="button"
                        className="lead-detail-delete-btn"
                        onClick={() =>
                          setFollowUpToDelete({
                            lead: selectedLead,
                            followUp: selectedLeadFollowUp
                          })
                        }
                        title="Remove follow-up"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                        <span>Delete Follow-up</span>
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="lead-detail-delete-btn"
                      onClick={() => setLeadToDelete(selectedLead)}
                      title="Delete lead permanently"
                    >
                      <Trash2 size={13} strokeWidth={2} />
                      <span>Delete Lead</span>
                    </button>
                  )
                )}
              </div>
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

      {/* Custom Delete Confirmation Modal */}
      {leadToDelete && (
        <div className="lead-modal-backdrop" style={{ zIndex: 350 }} onClick={() => setLeadToDelete(null)}>
          <div
            className="lead-delete-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-delete-confirm-body">
              <div className="lead-delete-confirm-title">
                <Trash2 size={16} strokeWidth={2} style={{ color: '#dc2626' }} />
                <span>Delete Lead</span>
              </div>
              <p className="lead-delete-confirm-desc">
                Are you sure you want to delete <strong>{leadToDelete.name || 'this lead'}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="lead-delete-confirm-footer">
              <button
                type="button"
                className="lead-modal-cancel-btn"
                onClick={() => setLeadToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lead-delete-confirm-btn"
                onClick={() => {
                  handleDeleteLead(leadToDelete.id);
                  if (selectedLead?.id === leadToDelete.id) {
                    setIsDetailOpen(false);
                  }
                  setLeadToDelete(null);
                }}
              >
                <Trash2 size={13} strokeWidth={2} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Follow-up Confirmation Modal */}
      {followUpToDelete && (
        <div className="lead-modal-backdrop" style={{ zIndex: 350 }} onClick={() => !isDeletingFollowUp && setFollowUpToDelete(null)}>
          <div
            className="lead-delete-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-delete-confirm-body">
              <div className="lead-delete-confirm-title">
                <Trash2 size={16} strokeWidth={2} style={{ color: '#dc2626' }} />
                <span>Delete Follow-up</span>
              </div>
              <p className="lead-delete-confirm-desc">
                Are you sure you want to remove the follow-up for <strong>{followUpToDelete.lead?.name || 'this lead'}</strong>?
              </p>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                The lead will remain safe and intact in your CRM pipeline.
              </div>
            </div>
            <div className="lead-delete-confirm-footer">
              <button
                type="button"
                className="lead-modal-cancel-btn"
                disabled={isDeletingFollowUp}
                onClick={() => setFollowUpToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lead-delete-confirm-btn"
                disabled={isDeletingFollowUp}
                onClick={() => handleDeleteFollowUp(followUpToDelete.followUp)}
              >
                <Trash2 size={13} strokeWidth={2} />
                <span>{isDeletingFollowUp ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Follow-up Modal */}
      <ScheduleFollowUpModal
        isOpen={isScheduleFollowUpOpen}
        onClose={() => {
          setIsScheduleFollowUpOpen(false);
          setFollowUpTargetLead(null);
        }}
        lead={followUpTargetLead || selectedLead}
        availableLeads={leads}
        currentUser={currentUser}
        onSuccess={() => {
          fetchFollowUps().then(setFollowUps);
        }}
      />
    </div>
  );
}
