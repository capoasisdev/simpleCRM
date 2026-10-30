import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  MessageSquare,
  Mail,
  CheckCheck,
  Check,
  AlertCircle,
  Zap,
  Phone,
  ExternalLink,
  Ghost,
  User,
  Filter,
  Calendar,
  Shield,
  Inbox,
  Send,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Menu
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchWhatsAppMessages } from '../lib/whatsapp';
import { fetchEmailLogs, fetchEmailTemplates, sendEmailViaResend, renderEmailVariables } from '../lib/email';
import { getMessagesScope, isLeadAssignedToUser, hasPermission } from '../lib/permissions';
import CustomSelect from './common/CustomSelect';
import Skeleton from './common/Skeleton';
import { haptic } from '../lib/haptics';
import { registerBackHandler } from '../lib/backButton';
import '../styles/messages.css';

const getInitials = (name) => {
  if (!name) return 'C';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatMessageTime = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

const formatRelativeDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return formatMessageTime(dateStr);
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const formatDateDivider = (dateStr) => {
  if (!dateStr) return 'Today';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Today';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const isWithinDateRange = (dateStr, filter, startStr, endStr) => {
  if (!dateStr || filter === 'all') return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  if (filter === 'today') {
    return d >= startOfToday && d < startOfTomorrow;
  }

  if (filter === 'yesterday') {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    return d >= startOfYesterday && d < startOfToday;
  }

  if (filter === 'last7') {
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return d >= sevenDaysAgo && d < startOfTomorrow;
  }

  if (filter === 'last30') {
    const thirtyDaysAgo = new Date(startOfToday);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return d >= thirtyDaysAgo && d < startOfTomorrow;
  }

  if (filter === 'custom') {
    if (startStr) {
      const start = new Date(startStr);
      if (!isNaN(start.getTime()) && d < start) return false;
    }
    if (endStr) {
      const end = new Date(endStr);
      end.setHours(23, 59, 59, 999);
      if (!isNaN(end.getTime()) && d > end) return false;
    }
    return true;
  }

  return true;
};

export default function MessagesView({ currentUser, onNavigateToLead }) {
  const [rawWhatsAppMessages, setRawWhatsAppMessages] = useState([]);
  const [rawEmailLogs, setRawEmailLogs] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [leadsList, setLeadsList] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [selectedChannelFilter, setSelectedChannelFilter] = useState('all'); // 'all' | 'whatsapp' | 'email'
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);
  const channelDropdownRef = useRef(null);

  // Close channel dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(e.target)) {
        setIsChannelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPipelineId, setSelectedPipelineId] = useState('all');
  const [selectedStageId, setSelectedStageId] = useState('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Quick Send Email Modal state
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendEmailError, setSendEmailError] = useState(null);
  const [sendEmailSuccess, setSendEmailSuccess] = useState(false);

  // Set of email message IDs expanded by the user
  const [expandedEmailIds, setExpandedEmailIds] = useState(new Set());

  const toggleEmailExpand = (msgId) => {
    setExpandedEmailIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  const chatEndRef = useRef(null);

  // Mobile screen detection (phone / WhatsApp style single-column navigation)
  const [isMobileScreen, setIsMobileScreen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768;
    }
    return false;
  });
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle mobile hardware back button and browser navigation
  useEffect(() => {
    if (isMobileScreen && selectedContactId) {
      return registerBackHandler(() => {
        setSelectedContactId(null);
        return true;
      });
    }
  }, [selectedContactId, isMobileScreen]);

  useEffect(() => {
    if (isMobileDrawerOpen) {
      return registerBackHandler(() => {
        setIsMobileDrawerOpen(false);
        return true;
      });
    }
  }, [isMobileDrawerOpen]);

  const handleMobileBack = () => {
    haptic.light();
    setSelectedContactId(null);
  };

  // Permission evaluation
  const hasViewPermission = hasPermission(currentUser, 'messages', 'view');
  const canViewAll = currentUser?.role === 'admin' || getMessagesScope(currentUser) === 'all';

  // Load initial messages, emails, pipelines, and leads
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        const [msgs, emails, pipesRes, leadsRes] = await Promise.all([
          fetchWhatsAppMessages(),
          fetchEmailLogs(),
          supabase.from('pipelines').select('*'),
          supabase
            .from('leads')
            .select('id, name, phone, email, assigned_to, stage, pipeline_id, created_at')
            .order('created_at', { ascending: false })
        ]);

        if (isMounted) {
          if (Array.isArray(msgs)) setRawWhatsAppMessages(msgs);
          if (Array.isArray(emails)) setRawEmailLogs(emails);
          if (pipesRes.data) setPipelines(pipesRes.data);
          if (leadsRes.data) setLeadsList(leadsRes.data);
        }
      } catch (err) {
        console.error('Error loading omnichannel messages data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    // Listen for locally dispatched messages & emails
    const handleNewWhatsApp = (e) => {
      const newMsg = e.detail;
      if (newMsg) {
        setRawWhatsAppMessages((prev) => [newMsg, ...prev.filter((m) => m.id !== newMsg.id)]);
      }
    };
    const handleNewEmail = (e) => {
      const newEmail = e.detail;
      if (newEmail) {
        setRawEmailLogs((prev) => [newEmail, ...prev.filter((m) => m.id !== newEmail.id)]);
      }
    };

    window.addEventListener('crm-whatsapp-message-sent', handleNewWhatsApp);
    window.addEventListener('crm-email-sent', handleNewEmail);

    // Subscribe to Supabase Realtime changes on leads table to keep stages synchronized
    const leadsChannel = supabase
      .channel('messages-leads-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            setLeadsList((prev) => [payload.new, ...prev.filter((l) => l.id !== payload.new.id)]);
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            setLeadsList((prev) => prev.map((l) => (l.id === payload.new.id ? { ...l, ...payload.new } : l)));
          } else if (payload.eventType === 'DELETE' && payload.old) {
            setLeadsList((prev) => prev.filter((l) => l.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Subscribe to Supabase Realtime changes on whatsapp_messages table
    const waChannel = supabase
      .channel('whatsapp-messages-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          if (payload.new) {
            setRawWhatsAppMessages((prev) => [payload.new, ...prev.filter((m) => m.id !== payload.new.id)]);
          }
        }
      )
      .subscribe();

    // Subscribe to Supabase Realtime changes on email_logs table
    const emailChannel = supabase
      .channel('email-logs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'email_logs' },
        (payload) => {
          if (payload.new) {
            setRawEmailLogs((prev) => [payload.new, ...prev.filter((m) => m.id !== payload.new.id)]);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      window.removeEventListener('crm-whatsapp-message-sent', handleNewWhatsApp);
      window.removeEventListener('crm-email-sent', handleNewEmail);
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(waChannel);
      supabase.removeChannel(emailChannel);
    };
  }, []);

  // Map of pipelines
  const pipelineMap = useMemo(() => {
    const map = new Map();
    pipelines.forEach((p) => map.set(p.id, p));
    return map;
  }, [pipelines]);

  // Lead resolution indices (prioritize the most recently created lead)
  const leadsIndex = useMemo(() => {
    const byId = new Map();
    const byPhone = new Map();
    const byEmail = new Map();
    const emailToPhone = new Map();

    const sortedLeads = [...leadsList].sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });

    sortedLeads.forEach((l) => {
      if (l.id && !byId.has(String(l.id))) byId.set(String(l.id), l);
      let pKey = '';
      if (l.phone) {
        const clean = String(l.phone).replace(/\D/g, '');
        if (clean) {
          pKey = clean.length >= 10 ? clean.slice(-10) : clean;
          if (!byPhone.has(pKey)) byPhone.set(pKey, l);
        }
      }
      if (l.email) {
        const clean = String(l.email).toLowerCase().trim();
        if (clean) {
          if (!byEmail.has(clean)) byEmail.set(clean, l);
          if (pKey && !emailToPhone.has(clean)) emailToPhone.set(clean, pKey);
        }
      }
    });

    return { byId, byPhone, byEmail, emailToPhone };
  }, [leadsList]);

  // Normalize all messages into a unified structure
  const normalizedMessages = useMemo(() => {
    const list = [];

    // WhatsApp Messages
    rawWhatsAppMessages.forEach((msg) => {
      list.push({
        id: String(msg.id),
        channel: 'whatsapp',
        leadId: msg.lead_id || null,
        leadName: msg.lead_name || 'Contact',
        phone: msg.phone || '',
        email: null,
        pipelineId: msg.pipeline_id || null,
        stageId: msg.stage_id || null,
        templateName: msg.template_name || '',
        subject: null,
        body: msg.message_body || '',
        status: msg.status || 'sent',
        errorMessage: null,
        isAutomated: Boolean(msg.is_automated),
        createdAt: msg.created_at || new Date().toISOString()
      });
    });

    // Email Logs
    rawEmailLogs.forEach((log) => {
      list.push({
        id: String(log.id),
        channel: 'email',
        leadId: log.lead_id || null,
        leadName: log.lead_name || 'Contact',
        phone: null,
        email: log.lead_email || '',
        pipelineId: log.pipeline_id || null,
        stageId: log.stage_id || null,
        templateName: log.template_name || '',
        subject: log.subject || '(No subject)',
        body: log.body || '',
        status: log.status || 'sent',
        errorMessage: log.error_message || null,
        isAutomated: Boolean(log.is_automated),
        createdAt: log.created_at || new Date().toISOString()
      });
    });

    return list;
  }, [rawWhatsAppMessages, rawEmailLogs]);

  // Group active communications by Contact / Lead
  const conversationGroups = useMemo(() => {
    const groups = new Map();

    normalizedMessages.forEach((msg) => {
      // Resolve matching lead record
      let lead = null;
      if (msg.leadId && leadsIndex.byId.has(String(msg.leadId))) {
        lead = leadsIndex.byId.get(String(msg.leadId));
      } else if (msg.phone) {
        const cleanP = String(msg.phone).replace(/\D/g, '');
        const pKey = cleanP.length >= 10 ? cleanP.slice(-10) : cleanP;
        if (pKey && leadsIndex.byPhone.has(pKey)) {
          lead = leadsIndex.byPhone.get(pKey);
        }
      } else if (msg.email) {
        const cleanE = String(msg.email).toLowerCase().trim();
        if (cleanE && leadsIndex.byEmail.has(cleanE)) {
          lead = leadsIndex.byEmail.get(cleanE);
        }
      }

      // Permissions check
      if (!canViewAll && lead) {
        if (!isLeadAssignedToUser(lead, currentUser)) return;
      }

      // Determine stable unique key for this conversation
      // Prioritize Phone Number first, then Email, then Lead ID, then Message ID
      const rawPhone = lead?.phone || msg.phone;
      const cleanPhoneDigits = rawPhone ? String(rawPhone).replace(/\D/g, '') : '';
      let phoneKey = cleanPhoneDigits.length >= 10 ? cleanPhoneDigits.slice(-10) : cleanPhoneDigits;

      const rawEmail = lead?.email || msg.email;
      const emailKey = rawEmail ? String(rawEmail).toLowerCase().trim() : '';

      // If phone wasn't directly present, resolve canonical phone number via emailToPhone mapping
      if (!phoneKey && emailKey && leadsIndex.emailToPhone.has(emailKey)) {
        phoneKey = leadsIndex.emailToPhone.get(emailKey);
      }

      let groupKey = '';
      if (phoneKey) {
        groupKey = `phone_${phoneKey}`;
      } else if (emailKey) {
        groupKey = `email_${emailKey}`;
      } else if (lead?.id || msg.leadId) {
        groupKey = `lead_${lead?.id || msg.leadId}`;
      } else {
        groupKey = `msg_${msg.id}`;
      }

      const defaultPipe = pipelines.find((p) => p.is_default) || pipelines[0];
      const pipeId = lead?.pipeline_id || msg.pipelineId || defaultPipe?.id;
      const pipe = pipelineMap.get(pipeId);
      const stageId = lead?.stage || msg.stageId || 'new';
      const stageObj = pipe?.stages?.find((s) => s.id === stageId);
      const stageName = stageObj?.label || stageId;

      const contactName = lead?.name || msg.leadName || 'Contact';
      const contactPhone = lead?.phone || msg.phone || '';
      const contactEmail = lead?.email || msg.email || '';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          leadId: lead?.id || msg.leadId || null,
          leadName: contactName,
          phone: contactPhone,
          displayPhone: contactPhone,
          email: contactEmail,
          pipelineId: pipeId,
          pipelineName: pipe?.name || 'Standard Pipeline',
          stageId,
          stageName,
          channels: new Set([msg.channel]),
          latestMessage: msg,
          messagesList: [msg]
        });
      } else {
        const existing = groups.get(groupKey);
        existing.channels.add(msg.channel);
        if (!existing.messagesList.some((m) => m.id === msg.id && m.channel === msg.channel)) {
          existing.messagesList.push(msg);
        }

        // Keep most complete phone/email/leadName
        if (!existing.phone && contactPhone) existing.phone = contactPhone;
        if (!existing.displayPhone && contactPhone) existing.displayPhone = contactPhone;
        if (!existing.email && contactEmail) existing.email = contactEmail;
        if ((!existing.leadName || existing.leadName === 'Contact') && contactName !== 'Contact') {
          existing.leadName = contactName;
        }

        if (new Date(msg.createdAt) > new Date(existing.latestMessage.createdAt)) {
          existing.latestMessage = msg;
          if (lead?.id || msg.leadId) {
            existing.leadId = lead?.id || msg.leadId;
          }
          if (contactName && contactName !== 'Contact') {
            existing.leadName = contactName;
          }
          existing.pipelineId = pipeId;
          existing.pipelineName = pipe?.name || 'Standard Pipeline';
          existing.stageId = stageId;
          existing.stageName = stageName;
        }
      }
    });

    // Sort conversations: newest activity first
    const arr = Array.from(groups.values());
    arr.sort((a, b) => {
      const timeA = a.latestMessage ? new Date(a.latestMessage.createdAt).getTime() : 0;
      const timeB = b.latestMessage ? new Date(b.latestMessage.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    return arr;
  }, [normalizedMessages, leadsIndex, pipelines, pipelineMap, canViewAll, currentUser]);

  // Counts for Channel Filter Tabs
  const channelCounts = useMemo(() => {
    let waCount = 0;
    let emailCount = 0;

    conversationGroups.forEach((c) => {
      if (c.channels.has('whatsapp')) waCount++;
      if (c.channels.has('email')) emailCount++;
    });

    return {
      all: conversationGroups.length,
      whatsapp: waCount,
      email: emailCount
    };
  }, [conversationGroups]);

  // Filter conversations by Search, Channel, Pipeline, Stage, Date
  const filteredConversations = useMemo(() => {
    return conversationGroups.filter((conv) => {
      // Channel Filter
      if (selectedChannelFilter !== 'all') {
        if (!conv.channels.has(selectedChannelFilter)) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = (conv.leadName || '').toLowerCase().includes(q);
        const matchesPhone = (conv.phone || '').includes(q);
        const matchesEmail = (conv.email || '').toLowerCase().includes(q);
        const matchesBody = conv.messagesList.some((m) =>
          (m.body || '').toLowerCase().includes(q) || (m.subject || '').toLowerCase().includes(q)
        );
        if (!matchesName && !matchesPhone && !matchesEmail && !matchesBody) return false;
      }

      // Pipeline Filter
      if (selectedPipelineId !== 'all') {
        const matchesPipeline =
          conv.pipelineId === selectedPipelineId ||
          conv.messagesList.some((m) => m.pipelineId === selectedPipelineId);
        if (!matchesPipeline) return false;
      }

      // Stage Filter
      if (selectedStageId !== 'all') {
        const matchesCurrentStage = conv.stageId === selectedStageId;
        const matchesMessageStage = conv.messagesList.some((m) => m.stageId === selectedStageId);
        if (!matchesCurrentStage && !matchesMessageStage) {
          return false;
        }
      }

      // Date Filter
      if (selectedDateFilter !== 'all') {
        const hasMatchingDate = conv.messagesList.some((m) =>
          isWithinDateRange(m.createdAt, selectedDateFilter, customStartDate, customEndDate)
        );
        if (!hasMatchingDate) return false;
      }

      return true;
    });
  }, [
    conversationGroups,
    selectedChannelFilter,
    searchQuery,
    selectedPipelineId,
    selectedStageId,
    selectedDateFilter,
    customStartDate,
    customEndDate
  ]);

  // Currently active conversation (On mobile, only active when contact is explicitly clicked)
  const activeConversation = useMemo(() => {
    if (selectedContactId) {
      const found = filteredConversations.find((c) => c.id === selectedContactId);
      if (found) return found;
    }
    if (!isMobileScreen) {
      return filteredConversations[0] || null;
    }
    return null;
  }, [selectedContactId, filteredConversations, isMobileScreen]);

  // Active messages stream for the selected conversation
  const activeMessages = useMemo(() => {
    if (!activeConversation) return [];
    let list = activeConversation.messagesList;

    // Filter by selected channel if channel filter is active
    if (selectedChannelFilter !== 'all') {
      list = list.filter((m) => m.channel === selectedChannelFilter);
    }

    // Filter by date if active
    if (selectedDateFilter !== 'all') {
      list = list.filter((m) =>
        isWithinDateRange(m.createdAt, selectedDateFilter, customStartDate, customEndDate)
      );
    }

    // Chronological order: oldest to newest
    return list.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [activeConversation, selectedChannelFilter, selectedDateFilter, customStartDate, customEndDate]);

  // Auto-scroll chat to bottom when conversation or message count changes
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation?.id, activeMessages.length]);

  // Pipeline stage options for filter dropdown
  const stageFilterOptions = useMemo(() => {
    const defaultOpts = [{ value: 'all', label: 'All Stages' }];
    if (selectedPipelineId === 'all') {
      const allStagesMap = new Map();
      pipelines.forEach((p) => {
        (p.stages || []).forEach((s) => {
          if (!allStagesMap.has(s.id)) {
            allStagesMap.set(s.id, { value: s.id, label: s.label || s.id });
          }
        });
      });
      return [...defaultOpts, ...Array.from(allStagesMap.values())];
    }
    const target = pipelines.find((p) => p.id === selectedPipelineId);
    if (!target || !Array.isArray(target.stages)) return defaultOpts;
    return [...defaultOpts, ...target.stages.map((s) => ({ value: s.id, label: s.label || s.id }))];
  }, [selectedPipelineId, pipelines]);

  const handleOpenSendEmailModal = async (conv) => {
    setShowSendEmailModal(true);
    setSendEmailError(null);
    setSendEmailSuccess(false);
    setSelectedTemplateId('');
    setComposeSubject('');
    setComposeBody('');

    try {
      const tmpls = await fetchEmailTemplates();
      setEmailTemplates(tmpls || []);
    } catch (e) {
      console.warn('Failed to load email templates:', e);
    }
  };

  const handleSelectTemplate = (tmplId) => {
    setSelectedTemplateId(tmplId);
    if (!tmplId) {
      setComposeSubject('');
      setComposeBody('');
      return;
    }
    const found = emailTemplates.find((t) => t.id === tmplId);
    if (found) {
      const leadContext = {
        name: activeConversation?.leadName || '',
        phone: activeConversation?.phone || '',
        company: activeConversation?.city || ''
      };
      setComposeSubject(renderEmailVariables(found.subject || '', leadContext));
      setComposeBody(renderEmailVariables(found.body_html || found.body || '', leadContext));
    }
  };

  const handleSendEmailSubmit = async (e) => {
    e.preventDefault();
    if (!activeConversation?.email) {
      setSendEmailError('Contact does not have a valid email address.');
      return;
    }
    if (!composeSubject.trim() || !composeBody.trim()) {
      setSendEmailError('Subject and message content are required.');
      return;
    }

    setIsSendingEmail(true);
    setSendEmailError(null);

    try {
      const selectedTmpl = emailTemplates.find((t) => t.id === selectedTemplateId);
      const res = await sendEmailViaResend({
        to: activeConversation.email,
        leadId: activeConversation.leadId,
        leadName: activeConversation.leadName,
        template: selectedTmpl,
        templateName: selectedTmpl?.name || 'Direct Email',
        subject: composeSubject,
        html: composeBody,
        pipelineId: activeConversation.pipelineId,
        stageId: activeConversation.stageId,
        isAutomated: false
      });

      if (res.success) {
        setSendEmailSuccess(true);
        setTimeout(async () => {
          setShowSendEmailModal(false);
          setSendEmailSuccess(false);
          // Refetch email logs so it appears instantly in the conversation thread
          const updatedLogs = await fetchEmailLogs();
          setRawEmailLogs(updatedLogs);
          window.dispatchEvent(
            new CustomEvent('crm-email-sent', {
              detail: { to: activeConversation.email, leadId: activeConversation.leadId }
            })
          );
        }, 800);
      } else {
        setSendEmailError(res.error || 'Failed to send email. Check your Resend API settings in Integrations.');
      }
    } catch (err) {
      setSendEmailError(err.message || 'An unexpected error occurred while sending the email.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  if (!hasViewPermission) {
    return (
      <div className="messages-view-container">
        <div className="messages-empty-chat" style={{ height: '100%', minHeight: '400px' }}>
          <div className="messages-empty-chat-icon">
            <Shield size={28} />
          </div>
          <h3>Access Restricted</h3>
          <p>You do not have permission to view the messages inbox. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  const isMobileChatOpen = isMobileScreen && !!activeConversation;

  return (
    <div className={`messages-view-container ${isMobileChatOpen ? 'is-mobile-chat-open' : ''}`}>
      {/* Top Toolbar: Search, Channel Selector, & Pipeline Filters */}
      <header className="messages-toolbar">
        <div className="messages-toolbar-left">
          <div className="messages-title-group">
            <h2 className="messages-title">Messages</h2>
            {isLoading ? (
              <Skeleton width="34px" height="20px" borderRadius="999px" />
            ) : (
              <span className="messages-count-badge" title="Total active conversations">
                {filteredConversations.length}
              </span>
            )}
          </div>

          {/* Omnichannel Channel Selector Dropdown */}
          {(() => {
            const channelOptions = [
              { id: 'all', label: 'All', icon: Inbox, count: channelCounts.all },
              { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, count: channelCounts.whatsapp, colorClass: 'whatsapp' },
              { id: 'email', label: 'Email', icon: Mail, count: channelCounts.email, colorClass: 'email' }
            ];
            const activeChannel = channelOptions.find((c) => c.id === selectedChannelFilter) || channelOptions[0];
            const ActiveChannelIcon = activeChannel.icon;

            return (
              <div className="messages-channel-dropdown-wrap" ref={channelDropdownRef}>
                <button
                  type="button"
                  className={`messages-channel-select-trigger ${isChannelDropdownOpen ? 'active' : ''}`}
                  onClick={() => setIsChannelDropdownOpen(!isChannelDropdownOpen)}
                  title="Filter conversations by channel"
                  aria-haspopup="listbox"
                  aria-expanded={isChannelDropdownOpen}
                >
                  <ActiveChannelIcon size={14} className={`messages-channel-trigger-icon ${activeChannel.colorClass || ''}`} />
                  <span className="messages-channel-current-name">{activeChannel.label}</span>
                  <span className="messages-channel-count-badge">{activeChannel.count}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`messages-channel-chevron ${isChannelDropdownOpen ? 'open' : ''}`}
                  />
                </button>

                {isChannelDropdownOpen && (
                  <div className="messages-channel-dropdown-menu" role="listbox">
                    {channelOptions.map((opt) => {
                      const OptIcon = opt.icon;
                      const isSelected = selectedChannelFilter === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`messages-channel-dropdown-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedChannelFilter(opt.id);
                            setIsChannelDropdownOpen(false);
                          }}
                        >
                          <div className="messages-channel-item-left">
                            <OptIcon size={14} className={`messages-channel-item-icon ${opt.colorClass || ''}`} />
                            <span>{opt.label}</span>
                          </div>
                          <div className="messages-channel-item-right">
                            <span className="messages-channel-item-count">{opt.count}</span>
                            {isSelected && <Check size={14} strokeWidth={2} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Search Box */}
          <div className="messages-search-box">
            <Search size={14} className="messages-search-icon" />
            <input
              type="text"
              placeholder="Search contact"
              className="messages-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="messages-toolbar-filters">
          <div className="messages-filter-item">
            <CustomSelect
              value={selectedPipelineId}
              onChange={(val) => {
                setSelectedPipelineId(val);
                setSelectedStageId('all');
              }}
              options={[
                { value: 'all', label: 'All Pipelines' },
                ...pipelines.map((p) => ({ value: p.id, label: p.name }))
              ]}
              placeholder="Select Pipeline"
            />
          </div>

          <div className="messages-filter-item">
            <CustomSelect
              value={selectedStageId}
              onChange={setSelectedStageId}
              options={stageFilterOptions}
              placeholder="Select Stage"
            />
          </div>
        </div>

        {/* Mobile Toolbar Actions (Hamburger Menu) */}
        <div className="messages-mobile-toolbar-actions">
          <button
            type="button"
            className={`messages-mobile-menu-btn ${isMobileDrawerOpen ? 'active' : ''}`}
            onClick={() => setIsMobileDrawerOpen((prev) => !prev)}
            aria-label={isMobileDrawerOpen ? 'Close filters and search' : 'Open filters and search'}
            title="Filters & Search"
          >
            {isMobileDrawerOpen ? <X size={18} strokeWidth={2} /> : <Menu size={18} strokeWidth={2} />}
          </button>
        </div>
      </header>

      {/* Main Split Layout */}
      <div className="messages-workspace">
        {/* Mobile Slide-Out Filters & Controls Drawer */}
        {isMobileDrawerOpen && (
          <>
            <div
              className="messages-mobile-drawer-backdrop"
              onClick={() => setIsMobileDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside
              className="messages-mobile-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Messages Filters and Controls"
            >
              <div className="messages-drawer-header">
                <div className="messages-drawer-title-wrap">
                  <MessageSquare size={16} strokeWidth={2} style={{ color: '#0284c7' }} />
                  <span className="messages-drawer-title">Messages & Filters</span>
                </div>
              </div>

              <div className="messages-drawer-body">
                {/* Search Bar */}
                <div className="messages-drawer-section">
                  <div className="messages-drawer-section-title">Search</div>
                  <div className="messages-drawer-search-wrap">
                    <Search size={15} strokeWidth={1.75} className="messages-drawer-search-icon" />
                    <input
                      type="text"
                      className="messages-drawer-search-input"
                      placeholder="Search contact..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="messages-drawer-search-clear"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Channel Filter */}
                <div className="messages-drawer-section">
                  <div className="messages-drawer-section-title">Channel</div>
                  <div className="messages-drawer-channel-list">
                    {[
                      { id: 'all', label: 'All Channels', icon: Inbox, count: channelCounts.all },
                      { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, count: channelCounts.whatsapp, colorClass: 'whatsapp' },
                      { id: 'email', label: 'Email', icon: Mail, count: channelCounts.email, colorClass: 'email' }
                    ].map((opt) => {
                      const OptIcon = opt.icon;
                      const isSelected = selectedChannelFilter === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={`messages-drawer-channel-btn ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedChannelFilter(opt.id);
                            setIsMobileDrawerOpen(false);
                          }}
                        >
                          <div className="messages-drawer-channel-btn-left">
                            <OptIcon size={14} className={`messages-drawer-channel-icon ${opt.colorClass || ''}`} />
                            <span>{opt.label}</span>
                          </div>
                          <div className="messages-drawer-channel-btn-right">
                            <span className="messages-drawer-channel-count">{opt.count}</span>
                            {isSelected && <Check size={14} strokeWidth={2.5} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pipeline & Stage Filters */}
                <div className="messages-drawer-section">
                  <div className="messages-drawer-section-title">Pipeline & Stage</div>
                  <div className="messages-drawer-select-group">
                    <div className="messages-drawer-select-item">
                      <label className="messages-drawer-select-lbl">Pipeline</label>
                      <CustomSelect
                        value={selectedPipelineId}
                        onChange={(val) => {
                          setSelectedPipelineId(val);
                          setSelectedStageId('all');
                        }}
                        options={[
                          { value: 'all', label: 'All Pipelines' },
                          ...pipelines.map((p) => ({ value: p.id, label: p.name }))
                        ]}
                        placeholder="Select Pipeline"
                      />
                    </div>
                    <div className="messages-drawer-select-item">
                      <label className="messages-drawer-select-lbl">Stage</label>
                      <CustomSelect
                        value={selectedStageId}
                        onChange={setSelectedStageId}
                        options={stageFilterOptions}
                        placeholder="Select Stage"
                      />
                    </div>
                  </div>
                </div>

                {/* Date Filter */}
                <div className="messages-drawer-section" style={{ borderBottom: 'none' }}>
                  <div className="messages-drawer-section-title">
                    <span>Date Range</span>
                    {selectedDateFilter !== 'all' && (
                      <button
                        type="button"
                        className="messages-drawer-reset-date-btn"
                        onClick={() => {
                          setSelectedDateFilter('all');
                          setCustomStartDate('');
                          setCustomEndDate('');
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="messages-drawer-date-presets">
                    {[
                      { id: 'all', label: 'All Dates' },
                      { id: 'today', label: 'Today' },
                      { id: 'yesterday', label: 'Yesterday' },
                      { id: 'last7', label: 'Last 7 Days' },
                      { id: 'last30', label: 'Last 30 Days' },
                      { id: 'custom', label: 'Custom' }
                    ].map((item) => {
                      const isSelected = selectedDateFilter === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`messages-drawer-date-chip ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedDateFilter(item.id);
                            if (item.id !== 'custom') {
                              setCustomStartDate('');
                              setCustomEndDate('');
                            }
                          }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  {selectedDateFilter === 'custom' && (
                    <div className="messages-drawer-custom-date-box">
                      <div className="messages-drawer-custom-row">
                        <input
                          type="date"
                          className="messages-drawer-date-input"
                          value={customStartDate}
                          onChange={(e) => setCustomStartDate(e.target.value)}
                          title="Start Date"
                        />
                        <span>to</span>
                        <input
                          type="date"
                          className="messages-drawer-date-input"
                          value={customEndDate}
                          onChange={(e) => setCustomEndDate(e.target.value)}
                          title="End Date"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </>
        )}

        {/* Left Column: Contact Roster */}
        <aside className="messages-contacts-panel" aria-label="Contacts Roster">
          {/* Sidebar Date Filter Header */}
          <div className="messages-sidebar-header">
            <div className="messages-sidebar-header-left">
              <Calendar size={13} className="messages-sidebar-header-icon" />
              <span className="messages-sidebar-header-title">Date</span>
            </div>

            <div className="messages-sidebar-header-right">
              <CustomSelect
                value={selectedDateFilter}
                onChange={(val) => {
                  setSelectedDateFilter(val);
                  if (val !== 'custom') {
                    setCustomStartDate('');
                    setCustomEndDate('');
                  }
                }}
                options={[
                  { value: 'all', label: 'All Dates' },
                  { value: 'today', label: 'Today' },
                  { value: 'yesterday', label: 'Yesterday' },
                  { value: 'last7', label: 'Last 7 Days' },
                  { value: 'last30', label: 'Last 30 Days' },
                  { value: 'custom', label: 'Custom Range...' }
                ]}
                className="messages-sidebar-select-wrap"
              />
            </div>
          </div>

          {/* Optional Custom Date Range Inputs */}
          {selectedDateFilter === 'custom' && (
            <div className="messages-sidebar-custom-date-row">
              <input
                type="date"
                className="messages-custom-date-input"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                title="Start Date"
              />
              <span className="messages-custom-date-sep">to</span>
              <input
                type="date"
                className="messages-custom-date-input"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                title="End Date"
              />
            </div>
          )}

          {isLoading ? (
            <ul className="messages-contacts-list messages-skeleton-list" aria-label="Loading contacts">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <li key={i} className="messages-contact-item messages-skeleton-item">
                  <div className="messages-avatar" style={{ background: 'transparent' }}>
                    <Skeleton circle width="40px" height="40px" />
                  </div>
                  <div className="messages-contact-details">
                    <div className="messages-contact-row-top" style={{ marginBottom: '6px' }}>
                      <Skeleton width={i % 3 === 0 ? '55%' : i % 2 === 0 ? '46%' : '38%'} height="15px" borderRadius="4px" />
                      <Skeleton width="46px" height="11px" borderRadius="3px" />
                    </div>
                    <div className="messages-contact-row-bottom">
                      <Skeleton width={i % 2 === 0 ? '42%' : '32%'} height="12px" borderRadius="3px" />
                      <div className="messages-contact-channel-icons">
                        <Skeleton width="16px" height="16px" borderRadius="4px" />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : filteredConversations.length === 0 ? (
            <div className="messages-contacts-empty">
              {searchQuery.trim() ? (
                <>
                  <Ghost size={32} strokeWidth={1.2} />
                  <p>No messages match &ldquo;{searchQuery}&rdquo;</p>
                </>
              ) : selectedDateFilter !== 'all' ? (
                <>
                  <Ghost size={32} strokeWidth={1.2} />
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                    No communications in selected date range.
                  </p>
                  <button
                    type="button"
                    className="btn-messages-reset-date"
                    onClick={() => {
                      setSelectedDateFilter('all');
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }}
                  >
                    Reset Date Filter
                  </button>
                </>
              ) : (
                <>
                  <div className="messages-empty-chat-icon">
                    <Inbox size={22} strokeWidth={1.8} style={{ color: '#0284c7' }} />
                  </div>
                  <h4 style={{ margin: '0', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                    {!canViewAll ? 'No Messages for Your Leads' : 'No Communications Yet'}
                  </h4>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.45, maxWidth: '240px' }}>
                    {!canViewAll
                      ? 'Automated WhatsApp and Email messages sent to leads assigned to you will appear here.'
                      : 'Automated WhatsApp messages and Resend emails sent by pipeline automations will appear here.'}
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="messages-contacts-list">
              {filteredConversations.map((conv) => {
                const isSelected = activeConversation?.id === conv.id;
                const latest = conv.latestMessage;

                return (
                  <li
                    key={conv.id}
                    className={`messages-contact-item ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedContactId(conv.id)}
                  >
                    <div className="messages-avatar">
                      {getInitials(conv.leadName)}
                    </div>

                    <div className="messages-contact-details">
                      <div className="messages-contact-row-top">
                        <span className="messages-contact-name">{conv.leadName}</span>
                        <span className="messages-contact-time">
                          {latest ? formatRelativeDate(latest.createdAt) : ''}
                        </span>
                      </div>

                      <div className="messages-contact-row-bottom">
                        <span className="messages-contact-phone">
                          {conv.phone || conv.email || 'No contact info'}
                        </span>
                        <div className="messages-contact-channel-icons">
                          {conv.channels.has('whatsapp') && (
                            <MessageSquare
                              size={13}
                              className="messages-card-channel-icon whatsapp"
                              strokeWidth={2.2}
                              title="WhatsApp message sent"
                            />
                          )}
                          {conv.channels.has('email') && (
                            <Mail
                              size={13}
                              className="messages-card-channel-icon email"
                              strokeWidth={2.2}
                              title="Email sent"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Right Column: Active Chat / Email Stream */}
        <section className="messages-chat-panel" aria-label="Conversation Thread">
          {activeConversation ? (
            <>
              {/* Chat Header */}
              <div className="messages-chat-header">
                <div className="messages-chat-header-info">
                  <button
                    type="button"
                    className="messages-mobile-back-btn"
                    onClick={handleMobileBack}
                    aria-label="Back to contacts list"
                  >
                    <ArrowLeft size={18} strokeWidth={2.2} />
                  </button>
                  <div className="messages-avatar messages-avatar-header">
                    {getInitials(activeConversation.leadName)}
                  </div>
                  <div className="messages-chat-header-titles">
                    <div className="messages-chat-header-title-row">
                      <span className="messages-chat-contact-name">
                        {activeConversation.leadName}
                      </span>
                    </div>
                    <div className="messages-chat-contact-meta">
                      {activeConversation.phone && (
                        <span className="messages-chat-meta-item">
                          <Phone size={11} className="messages-chat-meta-icon" />
                          <span>{activeConversation.phone}</span>
                        </span>
                      )}
                      {activeConversation.phone && activeConversation.email && (
                        <span className="messages-chat-meta-dot">·</span>
                      )}
                      {activeConversation.email && (
                        <span className="messages-chat-meta-item" title={activeConversation.email}>
                          <Mail size={11} className="messages-chat-meta-icon" />
                          <span className="messages-chat-meta-email-text">{activeConversation.email}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chat Thread */}
              <div className="messages-chat-thread">
                {activeMessages.length === 0 ? (
                  <div className="messages-empty-chat" style={{ height: '100%', minHeight: '340px' }}>
                    <div className="messages-empty-chat-icon">
                      <Inbox size={26} strokeWidth={1.5} />
                    </div>
                    <h3>No communications found for {activeConversation.leadName}</h3>
                    <p>Automated WhatsApp messages and Resend emails will be logged here as they are dispatched.</p>
                  </div>
                ) : (
                  activeMessages.map((msg, index) => {
                    const showDateDivider =
                      index === 0 ||
                      new Date(msg.createdAt).toDateString() !==
                      new Date(activeMessages[index - 1].createdAt).toDateString();

                    return (
                      <div key={msg.id || index} className="messages-bubble-wrapper">
                        {showDateDivider && (
                          <div className="messages-date-divider">
                            <span className="messages-date-pill">
                              {formatDateDivider(msg.createdAt)}
                            </span>
                          </div>
                        )}

                        {/* WhatsApp Message Bubble */}
                        {msg.channel === 'whatsapp' ? (
                          <div className="messages-bubble-row">
                            <div className={`messages-bubble ${msg.isAutomated ? 'is-automated' : ''}`}>
                              {msg.isAutomated && (
                                <div className="messages-bubble-badge-row">
                                  <span className="messages-bubble-auto-tag">
                                    <Zap size={11} strokeWidth={2.5} />
                                    Automated WhatsApp
                                  </span>
                                  {msg.templateName && (
                                    <span className="messages-bubble-template-name">
                                      {msg.templateName}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="messages-bubble-text">
                                {msg.body || `[Template: ${msg.templateName}]`}
                              </div>

                              <div className="messages-bubble-footer">
                                <span className="messages-bubble-time">
                                  {formatMessageTime(msg.createdAt)}
                                </span>
                                <span className="messages-bubble-ticks" title="Sent via WhatsApp Cloud API">
                                  <CheckCheck size={14} strokeWidth={2.5} />
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Email Card (Collapsible Preview) */
                          <div className="messages-bubble-row email">
                            <div
                              className={`messages-email-card ${expandedEmailIds.has(msg.id || index) ? 'is-expanded' : 'is-collapsed'}`}
                              onClick={() => toggleEmailExpand(msg.id || index)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleEmailExpand(msg.id || index);
                                }
                              }}
                            >
                              <div className="messages-email-header">
                                <div className="messages-email-header-left">
                                  <span className="messages-email-badge">
                                    <Mail size={12} strokeWidth={2.2} />
                                    <span>Email</span>
                                  </span>
                                  {msg.templateName && (
                                    <span className="messages-email-template-pill">
                                      {msg.templateName}
                                    </span>
                                  )}
                                  {msg.status === 'sent' && (
                                    <span className="messages-email-status sent" title="Delivered via Resend">
                                      <Check size={11} strokeWidth={2.5} /> Sent
                                    </span>
                                  )}
                                  {msg.status === 'failed' && (
                                    <span className="messages-email-status failed">
                                      <AlertCircle size={11} strokeWidth={2.5} /> Failed
                                    </span>
                                  )}
                                </div>
                                <div className="messages-email-header-right">
                                  <span className="messages-email-time">
                                    {formatMessageTime(msg.createdAt)}
                                  </span>
                                  <span
                                    className="messages-email-chevron-btn"
                                    title={expandedEmailIds.has(msg.id || index) ? "Collapse message" : "Expand message"}
                                  >
                                    {expandedEmailIds.has(msg.id || index) ? (
                                      <ChevronUp size={14} />
                                    ) : (
                                      <ChevronDown size={14} />
                                    )}
                                  </span>
                                </div>
                              </div>

                              <div className="messages-email-subject-row">
                                <span className="messages-email-subject">
                                  {msg.subject || '(No subject line)'}
                                </span>
                                {!expandedEmailIds.has(msg.id || index) && (
                                  <span className="messages-email-expand-hint">
                                    Click to view
                                  </span>
                                )}
                              </div>

                              {expandedEmailIds.has(msg.id || index) && (
                                <div
                                  className="messages-email-body"
                                  onClick={(e) => e.stopPropagation()}
                                  dangerouslySetInnerHTML={{
                                    __html: msg.body.startsWith('<')
                                      ? msg.body
                                      : msg.body.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('')
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Panel Footer Actions */}
              <div className="messages-chat-footer">
                {activeConversation.leadId && onNavigateToLead && (
                  <button
                    type="button"
                    className="btn-messages-footer-action btn-view-lead"
                    onClick={() => onNavigateToLead(activeConversation.leadId)}
                  >
                    <User size={14} strokeWidth={2} />
                    <span>View Lead</span>
                  </button>
                )}

                {activeConversation.phone && (
                  <a
                    href={`https://wa.me/${String(activeConversation.phone).replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-messages-footer-action btn-whatsapp"
                    title="Open chat in WhatsApp Web"
                  >
                    <ExternalLink size={14} strokeWidth={2} />
                    <span>WhatsApp Web</span>
                  </a>
                )}

                {activeConversation.email && (
                  <button
                    type="button"
                    className="btn-messages-footer-action btn-send-email"
                    onClick={() => handleOpenSendEmailModal(activeConversation)}
                    title={`Send email to ${activeConversation.email} via Resend`}
                  >
                    <Mail size={14} strokeWidth={2} />
                    <span>Send Email</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="messages-empty-chat">
              <div className="messages-empty-chat-icon">
                <Inbox size={26} strokeWidth={1.5} />
              </div>
              <h3>{conversationGroups.length === 0 ? 'No Active Communications' : 'Select a Conversation'}</h3>
              <p>
                {conversationGroups.length === 0
                  ? 'When pipeline stage automations trigger WhatsApp or Email messages, conversation threads will appear here automatically.'
                  : 'Choose a contact from the left roster to view their complete message and email history.'}
              </p>
            </div>
          )}
        </section>
      </div>
      {/* Quick Send Email Modal */}
      {showSendEmailModal && activeConversation && (
        <div className="messages-modal-backdrop" onClick={() => !isSendingEmail && setShowSendEmailModal(false)}>
          <div className="messages-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="messages-modal-header">
              <div>
                <h3 className="messages-modal-title">Send Email</h3>
                <p className="messages-modal-subtitle">
                  Sending to <strong>{activeConversation.leadName}</strong> ({activeConversation.email}) via Resend
                </p>
              </div>
              <button
                type="button"
                className="messages-modal-close-btn"
                disabled={isSendingEmail}
                onClick={() => setShowSendEmailModal(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendEmailSubmit} className="messages-modal-form">
              {sendEmailError && (
                <div className="messages-modal-alert error">
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{sendEmailError}</span>
                </div>
              )}

              {sendEmailSuccess && (
                <div className="messages-modal-alert success">
                  <CheckCheck size={15} style={{ flexShrink: 0 }} />
                  <span>Email dispatched successfully via Resend!</span>
                </div>
              )}

              <div className="messages-modal-field">
                <label className="messages-modal-label">Choose a Template (Optional)</label>
                <select
                  className="messages-modal-select"
                  value={selectedTemplateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  disabled={isSendingEmail}
                >
                  <option value="">-- Custom Email (Write from scratch) --</option>
                  {emailTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.subject || 'No subject'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="messages-modal-field">
                <label className="messages-modal-label">
                  Subject Line <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  className="messages-modal-input"
                  placeholder="e.g. Following up on your franchise inquiry"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  required
                  disabled={isSendingEmail}
                />
              </div>

              <div className="messages-modal-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="messages-modal-label" style={{ margin: 0 }}>
                    Message Body (HTML supported) <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Supports &#123;&#123;name&#125;&#125;, &#123;&#123;phone&#125;&#125;</span>
                </div>
                <textarea
                  className="messages-modal-textarea"
                  rows={8}
                  placeholder="Hi {{name}},&#10;&#10;Thank you for reaching out..."
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  required
                  disabled={isSendingEmail}
                />
              </div>

              <div className="messages-modal-footer">
                <button
                  type="button"
                  className="btn-messages-modal-cancel"
                  disabled={isSendingEmail}
                  onClick={() => setShowSendEmailModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-messages-modal-submit"
                  disabled={isSendingEmail || sendEmailSuccess}
                >
                  {isSendingEmail ? (
                    <>
                      <Loader2 size={14} className="messages-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>Send via Resend</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
