import { useState, useRef, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  UserCheck,
  Briefcase,
  Users,
  Calendar,
  CalendarCheck,
  GitFork,
  Settings,
  Bell,
  Plus,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  Check,
  Activity,
  PhoneCall,
  FileText,
  Mail,
  IndianRupee,
  X,
  Plug,
  GitBranch,
  UploadCloud,
  Zap,
  Database,
  StickyNote,
  ListTodo,
  MessageSquare,
  Layers,
  CalendarClock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission, getDashboardScope, getAnalyticsScope } from '../lib/permissions';
import { getStoredActivities } from '../lib/activities';
import LeadsView from './LeadsView';
import MessagesView from './MessagesView';
import TodosView from './TodosView';
import LaterOnView from './LaterOnView';
import AdminUsersView from './AdminUsersView';
import MetaIntegrationView from './MetaIntegrationView';
import PipelineSettingsView from './PipelineSettingsView';
import CsvImportView from './CsvImportView';
import BackupsView from './BackupsView';
import AnalyticsView from './AnalyticsView';
import NotificationDrawer from './NotificationDrawer';
import AiAssistantWidget from './AiAssistantWidget';
import { getStoredNotifications, clearAllNotifications, markAllNotificationsRead } from '../lib/notifications';
import { checkAndRunDailyAutoBackup } from '../lib/backups';
import Skeleton from './common/Skeleton';
import '../styles/dashboard.css';
import '../styles/analytics.css';

export default function DashboardView({ currentUser, onLogout }) {
  const user = currentUser || {
    name: 'Pranav Patil',
    email: 'pranav.p@capoasis.com',
    role: 'admin'
  };

  const isAdmin = user.role === 'admin' || hasPermission(user, 'admin', 'manage_users');
  const canViewDashboard = hasPermission(user, 'dashboard', 'view');
  const canViewDashboardDeals = hasPermission(user, 'dashboard', 'view_deals');
  const canViewDashboardActivity = hasPermission(user, 'dashboard', 'view_activity');
  const dashboardScope = getDashboardScope(user);
  const isDashboardGlobal = isAdmin || dashboardScope === 'all';
  const canViewAnalytics = hasPermission(user, 'analytics', 'view');
  const analyticsScope = getAnalyticsScope(user);
  const isAnalyticsGlobal = isAdmin || analyticsScope === 'all';
  const canViewLeads = hasPermission(user, 'leads', 'view');
  const canViewMessages = hasPermission(user, 'messages', 'view');
  const canViewPipelines = hasPermission(user, 'pipeline', 'view');
  const canManageUsers = hasPermission(user, 'admin', 'manage_users');
  const canManageRouting = hasPermission(user, 'admin', 'manage_routing');
  const canManageMeta = hasPermission(user, 'admin', 'manage_meta');
  const hasAdminAccess = user.role === 'admin' || canManageUsers || canManageRouting || canManageMeta;

  // URL Routing Helpers
  const TAB_ROUTES = {
    dashboard: 'Dashboard',
    analytics: 'Analytics',
    leads: 'Leads',
    messages: 'Messages',
    todos: 'Todos',
    tasks: 'Todos',
    lateron: 'LaterOn',
    admin: 'Admin'
  };

  const getRouteForTab = (tab, adminSub = 'users') => {
    if (tab === 'Admin') {
      return adminSub === 'users' ? '/admin' : `/admin/${adminSub}`;
    }
    if (tab === 'Messages') {
      return '/messages';
    }
    if (tab === 'Todos') {
      return '/todos';
    }
    if (tab === 'Dashboard') {
      return '/dashboard';
    }
    if (tab === 'Analytics') {
      return '/analytics';
    }
    if (tab === 'LaterOn') {
      return '/lateron';
    }
    return `/${tab.toLowerCase()}`;
  };

  const parseLocation = () => {
    const path = window.location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (path === '' || path === '/' || path === '/dashboard') {
      return { tab: 'Dashboard', adminSub: 'users' };
    }
    if (path === '/dashboard/analytics' || path === '/analytics') {
      return { tab: 'Analytics', adminSub: 'users' };
    }
    if (path.startsWith('/admin')) {
      const parts = path.split('/').filter(Boolean);
      let sub = parts[1] || 'users';
      if (sub === 'routing' || sub === 'automations') sub = 'integrations';
      return { tab: 'Admin', adminSub: sub };
    }
    const clean = path.replace(/^\//, '');
    if (clean === 'pipelines') {
      return { tab: 'Admin', adminSub: 'stages' };
    }
    const matched = TAB_ROUTES[clean];
    if (matched) {
      return { tab: matched, adminSub: 'users' };
    }
    return { tab: 'Dashboard', adminSub: 'users' };
  };

  const initialLoc = parseLocation();
  const validInitialTab = (() => {
    const requested = initialLoc.tab;
    if (requested === 'Pipelines' && !canViewPipelines) return canViewLeads ? 'Leads' : 'Dashboard';
    if (requested === 'Admin' && !hasAdminAccess) return canViewLeads ? 'Leads' : 'Dashboard';
    if (requested === 'Dashboard' && !canViewDashboard) return canViewLeads ? 'Leads' : 'Admin';
    if (requested === 'Analytics' && !canViewAnalytics) return canViewLeads ? 'Leads' : 'Admin';
    return requested || (canViewDashboard ? 'Dashboard' : canViewLeads ? 'Leads' : 'Admin');
  })();

  const [activeTab, setActiveTab] = useState(validInitialTab);
  const [adminSubTab, setAdminSubTab] = useState(
    (initialLoc.adminSub === 'routing' || initialLoc.adminSub === 'automations')
      ? 'users'
      : (initialLoc.adminSub || (canManageUsers ? 'users' : 'integrations'))
  );

  const [isPipelineConfiguring, setIsPipelineConfiguring] = useState(false);
  const [laterOnPrefill, setLaterOnPrefill] = useState(null);
  const [hasVisitedLaterOn, setHasVisitedLaterOn] = useState(validInitialTab === 'LaterOn');

  const handleScheduleWithLaterOn = (lead, channel = 'whatsapp') => {
    if (!lead) return;
    setHasVisitedLaterOn(true);
    const cleanPhone = (lead.phone || '').trim();
    const cleanEmail = (lead.email || '').trim();
    const cleanName = (lead.name || '').trim();
    const prefill = {
      channel,
      phone: cleanPhone,
      email: cleanEmail,
      name: cleanName,
      subject: channel === 'email' ? `Follow-up: ${cleanName || 'Discussion'}` : undefined,
      message: channel === 'email'
        ? `Hi ${cleanName || 'there'},\n\nI wanted to follow up regarding our recent discussion.`
        : `Hi ${cleanName || 'there'}, `
    };

    try {
      sessionStorage.setItem('lateron_prefill', JSON.stringify(prefill));
    } catch (e) {}

    setLaterOnPrefill(prefill);
    navigateTo('LaterOn');

    // Also dispatch directly to iframe if it's already mounted in DOM
    setTimeout(() => {
      const lateronIframe = document.getElementById('lateron-iframe');
      if (lateronIframe?.contentWindow) {
        lateronIframe.contentWindow.postMessage({
          type: 'LATERON_PREFILL',
          ...prefill
        }, '*');
      }
    }, 150);
  };

  const navigateTo = (tabName, subTab = 'users') => {
    setActiveTab(tabName);
    if (tabName === 'LaterOn') {
      setHasVisitedLaterOn(true);
    }
    if (tabName === 'Admin') {
      setAdminSubTab(subTab);
      if (subTab !== 'stages') {
        setIsPipelineConfiguring(false);
      }
    } else {
      setIsPipelineConfiguring(false);
    }
    const path = getRouteForTab(tabName, subTab);
    if (window.location.pathname !== path) {
      window.history.pushState({ tab: tabName, adminSub: subTab }, '', path);
    }
  };

  useEffect(() => {
    // If on root, set URL to /dashboard cleanly
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({ tab: 'Dashboard', adminSub: 'users' }, '', '/dashboard');
    }

    const handlePopState = () => {
      const current = parseLocation();
      setActiveTab(current.tab);
      if (current.tab === 'LaterOn') {
        setHasVisitedLaterOn(true);
      }
      setAdminSubTab(current.adminSub);
    };

    const handleScheduleEvent = (e) => {
      if (e.detail?.lead) {
        handleScheduleWithLaterOn(e.detail.lead, e.detail.channel || 'whatsapp');
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('crm-schedule-lateron', handleScheduleEvent);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('crm-schedule-lateron', handleScheduleEvent);
    };
  }, []);

  const [dealFilter, setDealFilter] = useState('Today');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  // In-app Notifications State
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState(() => getStoredNotifications());

  useEffect(() => {
    const handleNotifAdded = (e) => {
      setNotifications(getStoredNotifications());
      if (e.detail?.openDrawer) {
        setIsNotifDrawerOpen(true);
      }
    };
    const handleNotifsUpdated = (e) => {
      setNotifications(e.detail || getStoredNotifications());
    };

    window.addEventListener('crm-notification-added', handleNotifAdded);
    window.addEventListener('crm-notifications-updated', handleNotifsUpdated);

    return () => {
      window.removeEventListener('crm-notification-added', handleNotifAdded);
      window.removeEventListener('crm-notifications-updated', handleNotifsUpdated);
    };
  }, []);

  // Daily Automated Backup Check for Admin
  useEffect(() => {
    if (user?.role === 'admin') {
      checkAndRunDailyAutoBackup(user);
    }
  }, [user?.role]);

  // Dynamic Supabase data states
  const [leads, setLeads] = useState([]);
  const [deals, setDeals] = useState([]);
  const [pipelinesList, setPipelinesList] = useState([]);
  const [usersList, setUsersList] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_users');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [activities, setActivities] = useState(() => getStoredActivities());
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isDealModalOpen, setIsDealModalOpen] = useState(false);
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);

  // New Deal form states
  const [dealCompany, setDealCompany] = useState('');
  const [dealStage, setDealStage] = useState('Discovery');
  const [dealValue, setDealValue] = useState('');
  const [dealPeriod, setDealPeriod] = useState('Today');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch live leads & deals & users & pipelines from Supabase + subscribe to realtime
  useEffect(() => {
    let isMounted = true;

    const fetchDashboardData = async () => {
      try {
        const [leadsRes, dealsRes, usersRes, pipesRes] = await Promise.all([
          supabase.from('leads').select('*').order('created_at', { ascending: false }),
          supabase.from('deals').select('*').order('created_at', { ascending: false }),
          supabase.from('crm_users').select('*').order('created_at', { ascending: true }),
          supabase.from('pipelines').select('*').order('is_default', { ascending: false })
        ]);

        if (isMounted) {
          if (leadsRes.data) setLeads(leadsRes.data);
          if (dealsRes.data) setDeals(dealsRes.data);
          if (pipesRes.data) setPipelinesList(pipesRes.data);
          if (usersRes.data) {
            setUsersList(usersRes.data);
            try {
              localStorage.setItem('crm_cached_users', JSON.stringify(usersRes.data));
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn('Dashboard data fetch note:', err);
      } finally {
        if (isMounted) {
          setIsLoadingData(false);
        }
      }
    };

    fetchDashboardData();

    // Subscribe to realtime database changes
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === 'INSERT') {
          setLeads((prev) => prev.some((l) => l.id === payload.new.id) ? prev : [payload.new, ...prev]);
        } else if (payload.eventType === 'DELETE') {
          setLeads((prev) => prev.filter((l) => l.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          setLeads((prev) => prev.map((l) => (l.id === payload.new.id ? payload.new : l)));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === 'INSERT') {
          setDeals((prev) => prev.some((d) => d.id === payload.new.id) ? prev : [payload.new, ...prev]);
        } else if (payload.eventType === 'DELETE') {
          setDeals((prev) => prev.filter((d) => d.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          setDeals((prev) => prev.map((d) => (d.id === payload.new.id ? payload.new : d)));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_users' }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === 'INSERT') {
          setUsersList((prev) => prev.some((u) => u.id === payload.new.id) ? prev : [...prev, payload.new]);
        } else if (payload.eventType === 'DELETE') {
          setUsersList((prev) => prev.filter((u) => u.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          setUsersList((prev) => prev.map((u) => (u.id === payload.new.id ? payload.new : u)));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipelines' }, (payload) => {
        if (!isMounted) return;
        if (payload.eventType === 'INSERT') {
          setPipelinesList((prev) => prev.some((p) => p.id === payload.new.id) ? prev : [...prev, payload.new]);
        } else if (payload.eventType === 'DELETE') {
          setPipelinesList((prev) => prev.filter((p) => p.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          setPipelinesList((prev) => prev.map((p) => (p.id === payload.new.id ? payload.new : p)));
        }
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Subscribe to real-time activity events
  useEffect(() => {
    const handleActivityLogged = (e) => {
      if (e.detail) {
        setActivities((prev) => [e.detail, ...prev.filter((a) => a.id !== e.detail.id)].slice(0, 50));
      }
    };
    window.addEventListener('crm-activity-logged', handleActivityLogged);

    const handleStorage = (e) => {
      if (e.key === 'crm_lead_activities') {
        setActivities(getStoredActivities());
      }
    };
    window.addEventListener('storage', handleStorage);

    // Optional: fetch recent activities from Supabase
    (async () => {
      try {
        const { data } = await supabase
          .from('lead_activities')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30);
        if (data && data.length > 0) {
          setActivities((prev) => {
            const map = new Map();
            [...prev, ...data].forEach((item) => {
              if (item.id) map.set(item.id, item);
            });
            return Array.from(map.values()).sort(
              (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
            );
          });
        }
      } catch (err) {
        // Table might not exist yet
      }
    })();

    return () => {
      window.removeEventListener('crm-activity-logged', handleActivityLogged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Format relative time for activities
  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return 'Recently';
    const diff = Date.now() - new Date(timestamp).getTime();
    if (isNaN(diff) || diff < 0) return 'Recently';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Format INR currency values
  const formatINR = (val) => {
    const num = Number(val);
    if (!num || num === 0) return '₹0';
    if (num >= 10000000) {
      return `₹${(num / 10000000).toFixed(2)} Cr`;
    }
    if (num >= 100000) {
      return `₹${(num / 100000).toFixed(1)} L`;
    }
    return `₹${num.toLocaleString('en-IN')}`;
  };

  // Scoped leads & deals based on user permissions
  const scopedLeads = useMemo(() => {
    if (isDashboardGlobal) return leads;
    const userName = (user.name || '').toLowerCase().trim();
    const userEmail = (user.email || '').toLowerCase().trim();
    const userId = (user.id || '').toLowerCase().trim();
    return leads.filter((l) => {
      const assigned = (l.assigned_to || l.assignedTo || '').toLowerCase().trim();
      return assigned && (assigned === userName || assigned === userEmail || (userId && assigned === userId));
    });
  }, [leads, isDashboardGlobal, user]);

  const scopedDeals = useMemo(() => {
    if (isDashboardGlobal) return deals;
    const userName = (user.name || '').toLowerCase().trim();
    const userEmail = (user.email || '').toLowerCase().trim();
    const userId = (user.id || '').toLowerCase().trim();
    return deals.filter((d) => {
      const assigned = (d.assigned_to || d.assignedTo || d.owner || '').toLowerCase().trim();
      return assigned && (assigned === userName || assigned === userEmail || (userId && assigned === userId));
    });
  }, [deals, isDashboardGlobal, user]);

  // Analytics leads & deals based on analytics permission scope
  const analyticsLeads = useMemo(() => {
    if (isAnalyticsGlobal) return leads;
    return scopedLeads;
  }, [leads, scopedLeads, isAnalyticsGlobal]);

  const analyticsDeals = useMemo(() => {
    if (isAnalyticsGlobal) return deals;
    return scopedDeals;
  }, [deals, scopedDeals, isAnalyticsGlobal]);

  // Pipeline metrics computed dynamically from scoped deals
  const pipelineMetrics = useMemo(() => {
    const totalVal = scopedDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const activeCount = scopedDeals.filter((d) => d.stage !== 'Closed Lost').length;
    const closedWonCount = scopedDeals.filter((d) => d.stage === 'Closed Won').length;
    const winRate = scopedDeals.length > 0 ? Math.round((closedWonCount / scopedDeals.length) * 100) : 0;

    return {
      totalValFormatted: formatINR(totalVal),
      activeDealsCount: activeCount,
      winRateFormatted: `${winRate}%`
    };
  }, [scopedDeals]);

  // Lead conversion metrics computed dynamically from scoped leads
  const conversionMetrics = useMemo(() => {
    const totalLeads = scopedLeads.length;
    const contactedCount = scopedLeads.filter((l) => l.stage === 'contacted').length;
    const qualifiedCount = scopedLeads.filter((l) => l.stage === 'qualified').length;
    const proposalCount = scopedLeads.filter((l) => l.stage === 'proposal').length;

    return [
      {
        label: isDashboardGlobal ? 'Inbound Leads' : 'My Leads',
        count: totalLeads,
        sub: totalLeads > 0 ? (isDashboardGlobal ? '100% total pool' : '100% assigned') : '0 leads'
      },
      {
        label: 'Contacted',
        count: contactedCount,
        sub: totalLeads > 0 ? `${Math.round((contactedCount / totalLeads) * 100)}% reached` : '0% reached'
      },
      {
        label: 'Qualified',
        count: qualifiedCount,
        sub: totalLeads > 0 ? `${Math.round((qualifiedCount / totalLeads) * 100)}% qualified` : '0% qualified'
      },
      {
        label: 'Proposals Out',
        count: proposalCount,
        sub: totalLeads > 0 ? `${Math.round((proposalCount / totalLeads) * 100)}% converted` : '0% converted'
      }
    ];
  }, [scopedLeads, isDashboardGlobal]);

  // Filtered deals for current tab ('Today', 'This Week', 'This Month')
  const filteredDeals = useMemo(() => {
    return scopedDeals.filter((d) => (d.period || 'Today') === dealFilter);
  }, [scopedDeals, dealFilter]);

  // Recent dynamic activity feed from scoped activities, leads, and deals
  const dynamicActivities = useMemo(() => {
    const items = [];
    const userName = (user.name || '').toLowerCase().trim();
    const userEmail = (user.email || '').toLowerCase().trim();
    const userId = (user.id || '').toLowerCase().trim();

    // 1. Pipeline Stage Change Activities
    const scopedActivities = isDashboardGlobal
      ? activities
      : activities.filter((act) => {
          const assigned = (act.assigned_to || '').toLowerCase().trim();
          return !assigned || assigned === userName || assigned === userEmail || (userId && assigned === userId);
        });

    scopedActivities.forEach((act) => {
      items.push({
        id: act.id,
        icon: GitBranch,
        sortTime: new Date(act.created_at || Date.now()).getTime(),
        text: (
          <>
            Stage changed: <strong>{act.lead_name}</strong> moved to <strong>{act.to_stage}</strong>
          </>
        ),
        time: formatRelativeTime(act.created_at)
      });
    });

    // 2. Deals Activities
    scopedDeals.slice(0, 3).forEach((d) => {
      items.push({
        id: `deal-${d.id}`,
        icon: Briefcase,
        sortTime: new Date(d.created_at || Date.now()).getTime() - 60000,
        text: (
          <>
            Deal in {d.stage}: <strong>{d.company}</strong> for {formatINR(d.value)}
          </>
        ),
        time: d.created_at ? formatRelativeTime(d.created_at) : 'Recently'
      });
    });

    // 3. Inbound Leads Assigned Activities
    scopedLeads.slice(0, 3).forEach((l) => {
      let sortTime = Date.now() - 120000;
      let formattedTime = 'Recently';
      if (l.created_at) {
        sortTime = new Date(l.created_at).getTime();
        formattedTime = formatRelativeTime(l.created_at);
      } else if (l.date) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(l.date)) {
          const [y, m, d] = l.date.split('-');
          formattedTime = `${d}/${m}/${y}`;
          sortTime = new Date(l.date).getTime();
        } else {
          formattedTime = l.date;
        }
      }

      items.push({
        id: `lead-${l.id}`,
        icon: UserCheck,
        sortTime,
        text: (
          <>
            Inbound lead assigned: <strong>{l.name}</strong>
          </>
        ),
        time: formattedTime
      });
    });

    // Sort newest first and limit to top 6
    return items.sort((a, b) => b.sortTime - a.sortTime).slice(0, 6);
  }, [scopedLeads, scopedDeals, activities, isDashboardGlobal, user]);

  // Create new deal in Supabase
  const handleCreateDeal = async (e) => {
    e.preventDefault();
    if (!dealCompany.trim() || isSubmittingDeal) return;

    setIsSubmittingDeal(true);
    const parsedValue = parseFloat(dealValue) || 0;

    const newDealPayload = {
      company: dealCompany.trim(),
      stage: dealStage,
      value: parsedValue,
      period: dealPeriod
    };

    const tempId = `temp-${Date.now()}`;
    setDeals((prev) => [{ id: tempId, ...newDealPayload }, ...prev]);
    setDealCompany('');
    setDealValue('');
    setIsDealModalOpen(false);

    try {
      const { data, error } = await supabase
        .from('deals')
        .insert([newDealPayload])
        .select()
        .single();

      if (data) {
        setDeals((prev) => prev.map((d) => (d.id === tempId ? data : d)));
      } else if (error) {
        console.warn('Supabase insert deal note:', error.message);
      }
    } catch (err) {
      console.warn('Error inserting deal:', err);
    } finally {
      setIsSubmittingDeal(false);
    }
  };

  const [tasks, setTasks] = useState([
    { id: 1, title: 'Send revised enterprise proposal to Reliance Retail', due: 'Today, 4:00 PM', completed: false },
    { id: 2, title: 'Contract review call with Tata Motors legal team', due: 'Today, 5:30 PM', completed: true },
    { id: 3, title: 'Follow up on inbound lead', due: 'Tomorrow, 10:00 AM', completed: false },
    { id: 4, title: 'Prepare sales pipeline forecast report', due: 'Oct 16, 2:00 PM', completed: false }
  ]);

  const toggleTask = (id) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  };

  // October 2026 starts on Thursday (index 4) and has 31 days
  const calendarDays = Array.from({ length: 31 }, (_, i) => i + 1);
  const leadingBlanks = [null, null, null, null]; // Sun, Mon, Tue, Wed are blank before Oct 1 (Thu)

  return (
    <div className="dashboard-root">
      {/* Top Header */}
      <header className="dashboard-header">
        <div className="header-left-cluster">
          <div
            className="header-brand-wrap"
            onClick={() => navigateTo('Dashboard')}
            title="Go to Dashboard"
          >
            <img src="/logo_cropped.png" alt="SimpleCRM Logo" className="header-brand-logo" />
            <span className="header-brand">simplecrm</span>
          </div>
          <nav className="header-breadcrumb" aria-label="Breadcrumb">
            <span style={{ cursor: 'pointer' }} onClick={() => navigateTo('Dashboard')}>CRM</span>
            <span className="breadcrumb-separator">/</span>
            {activeTab === 'Admin' ? (
              <>
                <span
                  className="breadcrumb-parent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigateTo('Admin', 'users')}
                >
                  Admin
                </span>
                <span className="breadcrumb-separator">/</span>
                <span className="breadcrumb-current">
                  {adminSubTab === 'integrations'
                    ? 'Integrations'
                    : adminSubTab === 'users'
                    ? 'Users'
                    : adminSubTab.charAt(0).toUpperCase() + adminSubTab.slice(1)}
                </span>
              </>
            ) : (
              <span className="breadcrumb-current">
                {activeTab === 'Todos' ? "To-Do's" : activeTab === 'LaterOn' ? 'LaterOn' : activeTab}
              </span>
            )}
          </nav>
        </div>

        <div className="header-right-cluster">
          <button
            type="button"
            className="header-icon-btn"
            aria-label="Notifications"
            onClick={() => {
              setIsNotifDrawerOpen((prev) => !prev);
              if (!isNotifDrawerOpen) {
                markAllNotificationsRead();
              }
            }}
            title="Notifications & Alerts"
          >
            <Bell size={18} strokeWidth={1.5} />
            {notifications.filter((n) => !n.read).length > 0 && (
              <span className="header-icon-badge">
                {notifications.filter((n) => !n.read).length}
              </span>
            )}
          </button>
          
          <div className="header-user-menu-wrapper" ref={userMenuRef}>
            <button
              type="button"
              className="header-user-name-btn"
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              aria-haspopup="true"
            >
              <span className="user-display-name">{user.name}</span>
              <ChevronDown size={14} strokeWidth={1.75} className={`user-chevron ${showUserMenu ? 'open' : ''}`} />
            </button>

            {showUserMenu && (
              <div className="header-user-dropdown" role="menu">
                <div className="dropdown-user-email">{user.email}</div>
                <div className="dropdown-divider" />
                <button
                  type="button"
                  className="dropdown-signout-btn"
                  onClick={() => {
                    setShowUserMenu(false);
                    onLogout();
                  }}
                  role="menuitem"
                >
                  <LogOut size={14} strokeWidth={1.75} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main 3-Column Workspace */}
      <div className="dashboard-workspace">
        {/* Left Sidebar */}
        <aside
          className={`dashboard-sidebar-left ${activeTab === 'Admin' ? 'collapsed' : ''}`}
          aria-label="Main Navigation"
        >
          <div>
            <div className="nav-section">
              <ul className="nav-list">
                {[
                  canViewDashboard && { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
                  canViewAnalytics && { name: 'Analytics', label: 'Analytics', icon: BarChart3 },
                  canViewLeads && { name: 'Leads', label: 'Leads', icon: UserCheck },
                  canViewMessages && { name: 'Messages', label: 'Messages', icon: MessageSquare },
                  { name: 'Todos', label: "To-Do's", icon: StickyNote }
                ]
                  .filter(Boolean)
                  .map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.name}>
                      <button
                        type="button"
                        className={`nav-item-btn ${activeTab === item.name ? 'active' : ''}`}
                        onClick={() => navigateTo(item.name)}
                        title={item.label || item.name}
                      >
                        <Icon size={20} strokeWidth={1.75} />
                        <span>{item.label || item.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="sidebar-bottom-group">
            {/* Tools / Ecosystem Section */}
            <div className="nav-section" style={{ marginBottom: 8 }}>
              <div className="nav-section-title">Tools</div>
              <ul className="nav-list">
                {[
                  { name: 'LaterOn', label: 'LaterOn', icon: CalendarClock }
                ].map((tool) => {
                  const ToolIcon = tool.icon;
                  return (
                    <li key={tool.name}>
                      <button
                        type="button"
                        className={`nav-item-btn ${activeTab === tool.name ? 'active' : ''}`}
                        onClick={() => navigateTo(tool.name)}
                        title={tool.name}
                      >
                        <ToolIcon size={20} strokeWidth={1.75} />
                        <span>{tool.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {hasAdminAccess && (
              <div className="sidebar-bottom-item">
                <button
                  type="button"
                  className={`nav-item-btn ${activeTab === 'Admin' ? 'active' : ''}`}
                  onClick={() => navigateTo('Admin', adminSubTab || 'users')}
                  title="Admin Settings"
                >
                  <Settings size={20} strokeWidth={1.75} />
                  <span>Admin</span>
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Center Main Section */}
        <main
          className={`dashboard-main-section ${activeTab !== 'Dashboard' && activeTab !== 'Analytics' ? 'full-width' : ''}`}
          aria-label="Dashboard Content Area"
        >
          {activeTab !== 'LaterOn' && (
            <div key={activeTab} className="tab-pane-animated">
            {activeTab === 'Dashboard' && (
              <div className="dashboard-columns-container">
              {/* Left Column (Pipeline Overview, Recent Deals, Tasks Overview) */}
              <div className="dashboard-column">
                {/* Card 1: Pipeline Overview (Dynamic) */}
                <section className="dashboard-card" aria-label="Pipeline Overview">
                  <div className="card-header-row">
                    <div className="card-title-group">
                      <IndianRupee size={18} strokeWidth={1.5} />
                      <h2 className="card-title">Pipeline Overview</h2>
                    </div>
                    <button type="button" className="card-action-link">Quarter Q4</button>
                  </div>

                  <div className="metric-tiles-row">
                    <div className="metric-tile">
                      <div className="metric-tile-val">
                        {isLoadingData ? (
                          <Skeleton width="75px" height="22px" />
                        ) : (
                          <span className="fade-in-value">{pipelineMetrics.totalValFormatted}</span>
                        )}
                      </div>
                      <div className="metric-tile-lbl">Total Value</div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-tile-val">
                        {isLoadingData ? (
                          <Skeleton width="38px" height="22px" />
                        ) : (
                          <span className="fade-in-value">{pipelineMetrics.activeDealsCount}</span>
                        )}
                      </div>
                      <div className="metric-tile-lbl">Active Deals</div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-tile-val">
                        {isLoadingData ? (
                          <Skeleton width="48px" height="22px" />
                        ) : (
                          <span className="fade-in-value">{pipelineMetrics.winRateFormatted}</span>
                        )}
                      </div>
                      <div className="metric-tile-lbl">Win Rate</div>
                    </div>
                  </div>

                  <div className="card-buttons-row">
                    <button
                      type="button"
                      className="card-btn-primary"
                      onClick={() => setIsDealModalOpen(true)}
                    >
                      <Plus size={15} strokeWidth={1.5} />
                      <span>New Deal</span>
                    </button>
                    <button
                      type="button"
                      className="card-btn-secondary"
                      onClick={() => navigateTo('Leads')}
                    >
                      <span>View Pipeline</span>
                    </button>
                  </div>
                </section>

                {/* Card 2: Recent Deals (Dynamic) */}
                {canViewDashboardDeals && (
                  <section className="dashboard-card" aria-label="Recent Deals">
                    <div className="card-header-row">
                      <div className="card-title-group">
                        <Briefcase size={18} strokeWidth={1.5} />
                        <h2 className="card-title">Recent Deals</h2>
                      </div>
                      <span className="card-action-link" style={{ cursor: 'default' }}>
                        {isDashboardGlobal ? 'Company wide' : 'Assigned to me'}
                      </span>
                    </div>

                    <div className="filter-tabs-row" role="tablist">
                      {['Today', 'This Week', 'This Month'].map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          role="tab"
                          className={`filter-tab-btn ${dealFilter === tab ? 'active' : ''}`}
                          onClick={() => setDealFilter(tab)}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    <div className="deals-list">
                      {isLoadingData ? (
                        [1, 2, 3].map((i) => (
                          <div key={i} className="deal-row-skeleton">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <Skeleton width="130px" height="15px" />
                              <Skeleton width="75px" height="11px" />
                            </div>
                            <Skeleton width="68px" height="20px" borderRadius="10px" />
                          </div>
                        ))
                      ) : filteredDeals.length > 0 ? (
                        filteredDeals.map((deal) => (
                          <div key={deal.id || deal.company} className="deal-row fade-in-row">
                            <div>
                              <div className="deal-company">{deal.company}</div>
                              <div className="deal-stage">{deal.stage}</div>
                            </div>
                            <div className="deal-value">{formatINR(deal.value)}</div>
                          </div>
                        ))
                      ) : (
                        <div className="deals-empty-state">
                          No deals recorded for {dealFilter.toLowerCase()}
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Card 3: Tasks Overview */}
                <section className="dashboard-card tasks-card" aria-label="Tasks Overview">
                  <div className="card-header-row">
                    <div className="card-title-group">
                      <CalendarCheck size={18} strokeWidth={1.5} />
                      <h2 className="card-title">Tasks Overview</h2>
                    </div>
                    <button type="button" className="card-action-link">View All</button>
                  </div>

                  <div className="metric-tiles-row" style={{ marginBottom: '14px' }}>
                    <div className="metric-tile">
                      <div className="metric-tile-val">{tasks.length}</div>
                      <div className="metric-tile-lbl">Total Tasks</div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-tile-val">{tasks.filter((t) => !t.completed).length}</div>
                      <div className="metric-tile-lbl">In Progress</div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-tile-val">{tasks.filter((t) => t.completed).length}</div>
                      <div className="metric-tile-lbl">Completed</div>
                    </div>
                  </div>

                  <div className="task-list">
                    {tasks.map((task) => (
                      <div key={task.id} className="task-item">
                        <div className="task-left">
                          <button
                            type="button"
                            className={`task-checkbox-mock ${task.completed ? 'checked' : ''}`}
                            onClick={() => toggleTask(task.id)}
                            aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                          >
                            {task.completed && <Check size={12} strokeWidth={2.5} />}
                          </button>
                          <span className={`task-text ${task.completed ? 'completed' : ''}`}>
                            {task.title}
                          </span>
                        </div>
                        <span className="task-due">{task.due}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Right Column (Lead Conversion, Calendar) */}
              <div className="dashboard-column">
                {/* Card 1: Lead Conversion (Dynamic from Supabase leads) */}
                <section className="dashboard-card" aria-label="Lead Conversion">
                  <div className="card-header-row">
                    <div className="card-title-group">
                      <UserCheck size={18} strokeWidth={1.5} />
                      <h2 className="card-title">Lead Conversion</h2>
                    </div>
                    <button type="button" className="card-action-link">
                      {isDashboardGlobal ? 'Company wide' : 'Assigned to me'}
                    </button>
                  </div>

                  <div className="conversion-tiles-grid">
                    {conversionMetrics.map((item) => (
                      <div key={item.label} className="conversion-tile">
                        <span className="conversion-tile-lbl">{item.label}</span>
                        <span className="conversion-tile-val">
                          {isLoadingData ? (
                            <Skeleton width="32px" height="20px" />
                          ) : (
                            <span className="fade-in-value">{item.count}</span>
                          )}
                        </span>
                        <span className="conversion-tile-sub">{item.sub}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Card 2: Calendar */}
                <section className="dashboard-card calendar-card" aria-label="Calendar">
                  <div className="calendar-header-nav">
                    <div className="card-title-group">
                      <Calendar size={18} strokeWidth={1.5} />
                      <h2 className="card-title">Calendar</h2>
                    </div>
                    <div className="calendar-navigator">
                      <button type="button" className="cal-nav-btn" aria-label="Previous Month">
                        <ChevronLeft size={14} strokeWidth={1.75} />
                      </button>
                      <span className="cal-nav-month">October 2026</span>
                      <button type="button" className="cal-nav-btn" aria-label="Next Month">
                        <ChevronRight size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>

                  <div className="calendar-grid">
                    {['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].map((day) => (
                      <div key={day} className="calendar-weekday">{day}</div>
                    ))}
                    {leadingBlanks.map((_, i) => (
                      <div key={`blank-${i}`} className="calendar-day-cell empty" />
                    ))}
                    {calendarDays.map((day) => {
                      const dayOfWeek = (3 + day) % 7;
                      const isWeeklyOff = dayOfWeek === 0 || dayOfWeek === 6;
                      const isToday = day === 13;
                      return (
                        <div
                          key={day}
                          className={`calendar-day-cell ${isToday ? 'today' : ''} ${isWeeklyOff ? 'weekly-off' : ''}`}
                        >
                          {day}
                        </div>
                      );
                    })}
                  </div>

                  <div className="calendar-divider" />

                  <div className="calendar-legend-row">
                    <div className="legend-item">
                      <span className="legend-indicator-holiday" />
                      <span>Holiday</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-indicator-weekly-off" />
                      <span>Weekly Off</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-indicator-today" />
                      <span>Today</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            )}

            {activeTab === 'Analytics' && (
              <AnalyticsView
                leads={analyticsLeads}
                deals={analyticsDeals}
                users={usersList}
                pipelines={pipelinesList}
                isLoading={isLoadingData}
                isGlobal={isAnalyticsGlobal}
                currentUser={user}
              />
            )}

          {activeTab === 'Leads' && (
            <LeadsView
              currentUser={user}
              onNavigate={navigateTo}
              onScheduleLaterOn={handleScheduleWithLaterOn}
            />
          )}
          {activeTab === 'Messages' && (
            <MessagesView
              currentUser={user}
              onNavigateToLead={(leadId) => {
                navigateTo('Leads');
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent('crm-open-lead-detail', {
                      detail: { leadId }
                    })
                  );
                }, 80);
              }}
            />
          )}
          {activeTab === 'Todos' && <TodosView currentUser={user} />}
          {activeTab === 'Admin' && (
            <div className="settings-workspace-layout">
              {/* Secondary Settings Sub-navigation inside Settings Main Section */}
              <div className={`settings-subnav-pane ${adminSubTab === 'stages' && isPipelineConfiguring ? 'settings-subnav-collapsed' : ''}`}>
                <ul className="settings-subnav-list">
                  {[
                    ...(canManageUsers || user.role === 'admin' ? [{ id: 'users', label: 'Users', icon: Users }] : []),
                    ...(user.role === 'admin' ? [{ id: 'import', label: 'Import Leads', icon: UploadCloud }] : []),
                    ...(canManageMeta || user.role === 'admin' ? [{ id: 'integrations', label: 'Integrations', icon: Plug }] : []),
                    ...(canViewPipelines ? [{ id: 'stages', label: 'Pipeline', icon: GitFork }] : []),
                    ...(user.role === 'admin' ? [{ id: 'backups', label: 'Backups', icon: Database }] : [])
                  ].map((sub) => {
                    const SubIcon = sub.icon;
                    return (
                      <li key={sub.id}>
                        <button
                          type="button"
                          className={`settings-subnav-btn ${adminSubTab === sub.id ? 'active' : ''}`}
                          onClick={() => navigateTo('Admin', sub.id)}
                        >
                          <SubIcon size={20} strokeWidth={1.75} />
                          <span>{sub.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Settings Content Pane */}
              <div key={adminSubTab} className="settings-content-pane tab-pane-animated">
                {adminSubTab === 'users' && (canManageUsers || user.role === 'admin') && (
                  <AdminUsersView currentUser={user} onLogout={onLogout} />
                )}
                {adminSubTab === 'import' && user.role === 'admin' && (
                  <CsvImportView currentUser={user} onNavigate={navigateTo} />
                )}
                {adminSubTab === 'integrations' && (canManageMeta || user.role === 'admin') && (
                  <MetaIntegrationView currentUser={user} />
                )}
                {adminSubTab === 'stages' && (
                  <PipelineSettingsView
                    currentUser={user}
                    onConfigureStateChange={setIsPipelineConfiguring}
                  />
                )}
                {adminSubTab === 'backups' && user.role === 'admin' && <BackupsView currentUser={user} />}
              </div>
            </div>
          )}

          {activeTab !== 'Dashboard' && activeTab !== 'Analytics' && activeTab !== 'Leads' && activeTab !== 'Messages' && activeTab !== 'Todos' && activeTab !== 'LaterOn' && activeTab !== 'Admin' && (
            <div className="tab-placeholder-view">
              <h2 className="placeholder-title">{activeTab}</h2>
              <p className="placeholder-desc">This section is currently under development.</p>
            </div>
          )}
          </div>
          )}

          {/* Persistent LaterOn Tab: Keeps iframe alive in DOM, never reloads on tab switches */}
          {hasVisitedLaterOn && (
            <div
              className="tab-pane-animated"
              style={{
                display: activeTab === 'LaterOn' ? 'flex' : 'none',
                width: '100%',
                height: '100%',
                flexDirection: 'column'
              }}
            >
              <LaterOnView prefillData={laterOnPrefill} />
            </div>
          )}
        </main>

        {/* Right Sidebar - Activity Feed (Dynamic) */}
        {activeTab === 'Dashboard' && canViewDashboardActivity && (
          <aside className="dashboard-sidebar-right" aria-label="Recent CRM Activity Feed">
            <div className="right-sidebar-title-row">
              <Activity size={18} strokeWidth={1.5} />
              <h2 className="right-sidebar-title">Recent Activity</h2>
            </div>

            <div className="activity-feed-list">
              {isLoadingData ? (
                [1, 2, 3].map((i) => (
                  <div key={i} className="activity-item-skeleton">
                    <Skeleton width="28px" height="28px" circle />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <Skeleton width="85%" height="13px" />
                      <Skeleton width="45%" height="10px" />
                    </div>
                  </div>
                ))
              ) : dynamicActivities.length > 0 ? (
                dynamicActivities.map((act) => {
                  const Icon = act.icon;
                  return (
                    <div key={act.id} className="activity-item fade-in-item">
                      <div className="activity-icon-wrap">
                        <Icon size={14} strokeWidth={1.5} />
                      </div>
                      <div className="activity-content">
                        <p className="activity-text">{act.text}</p>
                        <span className="activity-timestamp">{act.time}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="activity-empty-state">
                  No recent activity recorded
                </div>
              )}
            </div>

            <div className="right-quick-actions">
              <button
                type="button"
                className="quick-action-btn"
                onClick={() => setIsDealModalOpen(true)}
              >
                <Plus size={14} strokeWidth={1.5} />
                <span>Quick Add Deal</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Quick Add Deal Modal */}
      {isDealModalOpen && (
        <div className="lead-modal-backdrop" onClick={() => setIsDealModalOpen(false)}>
          <div
            className="lead-modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-modal-header">
              <h2 className="lead-modal-title">Create New Deal</h2>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setIsDealModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleCreateDeal}>
              <div className="lead-modal-body">
                <div className="lead-field-group">
                  <label className="lead-field-label">Company Name</label>
                  <input
                    type="text"
                    className="lead-field-input"
                    placeholder="e.g. Tata Motors"
                    value={dealCompany}
                    onChange={(e) => setDealCompany(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Deal Value (₹ in INR)</label>
                  <input
                    type="number"
                    className="lead-field-input"
                    placeholder="e.g. 4500000"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    required
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Stage</label>
                  <select
                    className="lead-field-input"
                    value={dealStage}
                    onChange={(e) => setDealStage(e.target.value)}
                  >
                    <option value="Discovery">Discovery</option>
                    <option value="Contacted">Contacted</option>
                    <option value="Qualified">Qualified</option>
                    <option value="Proposal Sent">Proposal Sent</option>
                    <option value="Negotiation">Negotiation</option>
                    <option value="Closed Won">Closed Won</option>
                    <option value="Closed Lost">Closed Lost</option>
                  </select>
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Period</label>
                  <select
                    className="lead-field-input"
                    value={dealPeriod}
                    onChange={(e) => setDealPeriod(e.target.value)}
                  >
                    <option value="Today">Today</option>
                    <option value="This Week">This Week</option>
                    <option value="This Month">This Month</option>
                  </select>
                </div>
              </div>

              <div className="lead-modal-footer">
                <button
                  type="button"
                  className="lead-modal-cancel-btn"
                  onClick={() => setIsDealModalOpen(false)}
                  disabled={isSubmittingDeal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lead-modal-submit-btn"
                  disabled={isSubmittingDeal}
                >
                  {isSubmittingDeal ? 'Creating...' : 'Create Deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slide-in Notifications Drawer */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        notifications={notifications}
        onClearAll={() => {
          clearAllNotifications();
          setNotifications([]);
        }}
        onViewLead={(leadId, lead) => {
          navigateTo('Leads');
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('crm-open-lead-detail', {
                detail: { leadId, lead }
              })
            );
          }, 80);
        }}
      />

      {/* 3D Floating AI Assistant Widget */}
      <AiAssistantWidget
        leads={leads}
        deals={deals}
        pipelinesList={pipelinesList}
        usersList={usersList}
        currentUser={user}
        activities={activities}
        onNavigate={navigateTo}
      />
    </div>
  );
}
