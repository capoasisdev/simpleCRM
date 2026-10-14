import { useState, useRef, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  UserCheck,
  Briefcase,
  Building2,
  Users,
  Calendar,
  CalendarCheck,
  GitFork,
  BarChart3,
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
  ShieldCheck,
  IndianRupee,
  X,
  Plug,
  GitBranch,
  UploadCloud
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission } from '../lib/permissions';
import LeadsView from './LeadsView';
import AdminUsersView from './AdminUsersView';
import MetaIntegrationView from './MetaIntegrationView';
import LeadRoutingView from './LeadRoutingView';
import PipelineSettingsView from './PipelineSettingsView';
import CsvImportView from './CsvImportView';
import Skeleton from './common/Skeleton';
import '../styles/dashboard.css';

export default function DashboardView({ currentUser, onLogout }) {
  const user = currentUser || {
    name: 'Pranav Patil',
    email: 'pranav.p@capoasis.com',
    role: 'admin'
  };

  const isAdmin = user.role === 'admin' || hasPermission(user, 'admin', 'manage_users');
  const canViewDashboard = hasPermission(user, 'dashboard', 'view');
  const canViewLeads = hasPermission(user, 'leads', 'view');
  const canViewPipelines = hasPermission(user, 'pipeline', 'view');
  const canManageUsers = hasPermission(user, 'admin', 'manage_users');
  const canManageRouting = hasPermission(user, 'admin', 'manage_routing');
  const canManageMeta = hasPermission(user, 'admin', 'manage_meta');
  const hasAdminAccess = user.role === 'admin' || canManageUsers || canManageRouting || canManageMeta;

  // URL Routing Helpers
  const TAB_ROUTES = {
    dashboard: 'Dashboard',
    leads: 'Leads',
    deals: 'Deals',
    accounts: 'Accounts',
    contacts: 'Contacts',
    pipelines: 'Pipelines',
    activities: 'Activities',
    reports: 'Reports',
    admin: 'Admin'
  };

  const getRouteForTab = (tab, adminSub = 'users') => {
    if (tab === 'Admin') {
      return adminSub === 'users' ? '/admin' : `/admin/${adminSub}`;
    }
    return `/${tab.toLowerCase()}`;
  };

  const parseLocation = () => {
    const path = window.location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (path === '' || path === '/' || path === '/dashboard') {
      return { tab: 'Dashboard', adminSub: 'users' };
    }
    if (path.startsWith('/admin')) {
      const parts = path.split('/').filter(Boolean);
      const sub = parts[1] || 'users';
      return { tab: 'Admin', adminSub: sub };
    }
    const clean = path.replace(/^\//, '');
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
    return requested || (canViewDashboard ? 'Dashboard' : canViewLeads ? 'Leads' : 'Admin');
  })();

  const [activeTab, setActiveTab] = useState(validInitialTab);
  const [adminSubTab, setAdminSubTab] = useState(initialLoc.adminSub || (canManageUsers ? 'users' : 'routing'));

  const navigateTo = (tabName, subTab = 'users') => {
    setActiveTab(tabName);
    if (tabName === 'Admin') {
      setAdminSubTab(subTab);
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
      setAdminSubTab(current.adminSub);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [dealFilter, setDealFilter] = useState('Today');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  // Dynamic Supabase data states
  const [leads, setLeads] = useState([]);
  const [deals, setDeals] = useState([]);
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

  // Fetch live leads & deals from Supabase + subscribe to realtime
  useEffect(() => {
    let isMounted = true;

    const fetchDashboardData = async () => {
      try {
        const [leadsRes, dealsRes] = await Promise.all([
          supabase.from('leads').select('*').order('created_at', { ascending: false }),
          supabase.from('deals').select('*').order('created_at', { ascending: false })
        ]);

        if (isMounted) {
          if (leadsRes.data) setLeads(leadsRes.data);
          if (dealsRes.data) setDeals(dealsRes.data);
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
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

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

  // Pipeline metrics computed dynamically
  const pipelineMetrics = useMemo(() => {
    const totalVal = deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const activeCount = deals.filter((d) => d.stage !== 'Closed Lost').length;
    const closedWonCount = deals.filter((d) => d.stage === 'Closed Won').length;
    const winRate = deals.length > 0 ? Math.round((closedWonCount / deals.length) * 100) : 0;

    return {
      totalValFormatted: formatINR(totalVal),
      activeDealsCount: activeCount,
      winRateFormatted: `${winRate}%`
    };
  }, [deals]);

  // Lead conversion metrics computed dynamically from leads
  const conversionMetrics = useMemo(() => {
    const totalLeads = leads.length;
    const contactedCount = leads.filter((l) => l.stage === 'contacted').length;
    const qualifiedCount = leads.filter((l) => l.stage === 'qualified').length;
    const proposalCount = leads.filter((l) => l.stage === 'proposal').length;

    return [
      {
        label: 'Inbound Leads',
        count: totalLeads,
        sub: totalLeads > 0 ? '100% total pool' : '0 leads'
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
  }, [leads]);

  // Filtered deals for current tab ('Today', 'This Week', 'This Month')
  const filteredDeals = useMemo(() => {
    return deals.filter((d) => (d.period || 'Today') === dealFilter);
  }, [deals, dealFilter]);

  // Recent dynamic activity feed from leads and deals
  const dynamicActivities = useMemo(() => {
    const items = [];
    deals.slice(0, 3).forEach((d) => {
      items.push({
        id: `deal-${d.id}`,
        icon: Briefcase,
        text: (
          <>
            Deal in {d.stage}: <strong>{d.company}</strong> for {formatINR(d.value)}
          </>
        ),
        time: 'Recently'
      });
    });

    leads.slice(0, 3).forEach((l) => {
      let formattedTime = 'Recently';
      if (l.date) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(l.date)) {
          const [y, m, d] = l.date.split('-');
          formattedTime = `${d}/${m}/${y}`;
        } else {
          formattedTime = l.date;
        }
      }

      items.push({
        id: `lead-${l.id}`,
        icon: UserCheck,
        text: (
          <>
            Inbound lead assigned: <strong>{l.name}</strong>
          </>
        ),
        time: formattedTime
      });
    });

    return items.slice(0, 5);
  }, [leads, deals]);

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
          <span className="header-brand">simplecrm</span>
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
                    : adminSubTab === 'routing'
                    ? 'Lead Routing'
                    : adminSubTab === 'users'
                    ? 'Users'
                    : adminSubTab.charAt(0).toUpperCase() + adminSubTab.slice(1)}
                </span>
              </>
            ) : (
              <span className="breadcrumb-current">{activeTab}</span>
            )}
          </nav>
        </div>

        <div className="header-right-cluster">
          <button type="button" className="header-icon-btn" aria-label="Notifications">
            <Bell size={18} strokeWidth={1.5} />
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
              <div className="nav-section-title">Main</div>
              <ul className="nav-list">
                {[
                  canViewDashboard && { name: 'Dashboard', icon: LayoutDashboard },
                  canViewLeads && { name: 'Leads', icon: UserCheck },
                  { name: 'Deals', icon: Briefcase }
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
                        title={item.name}
                      >
                        <Icon size={20} strokeWidth={1.75} />
                        <span>{item.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Work</div>
              <ul className="nav-list">
                {[
                  { name: 'Accounts', icon: Building2 },
                  { name: 'Contacts', icon: Users },
                  ...(canViewPipelines ? [{ name: 'Pipelines', icon: GitFork }] : []),
                  { name: 'Activities', icon: Calendar }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.name}>
                      <button
                        type="button"
                        className={`nav-item-btn ${activeTab === item.name ? 'active' : ''}`}
                        onClick={() => navigateTo(item.name)}
                        title={item.name}
                      >
                        <Icon size={20} strokeWidth={1.75} />
                        <span>{item.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Analytics</div>
              <ul className="nav-list">
                {[
                  { name: 'Reports', icon: BarChart3 }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.name}>
                      <button
                        type="button"
                        className={`nav-item-btn ${activeTab === item.name ? 'active' : ''}`}
                        onClick={() => navigateTo(item.name)}
                        title={item.name}
                      >
                        <Icon size={20} strokeWidth={1.75} />
                        <span>{item.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
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
        </aside>

        {/* Center Main Section */}
        <main
          className={`dashboard-main-section ${activeTab !== 'Dashboard' ? 'full-width' : ''}`}
          aria-label="Dashboard Content Area"
        >
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
                <section className="dashboard-card" aria-label="Recent Deals">
                  <div className="card-header-row">
                    <div className="card-title-group">
                      <Briefcase size={18} strokeWidth={1.5} />
                      <h2 className="card-title">Recent Deals</h2>
                    </div>
                    <button type="button" className="card-action-link">Company wide</button>
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
                    <button type="button" className="card-action-link">This Month</button>
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

          {activeTab === 'Leads' && <LeadsView currentUser={user} onNavigate={navigateTo} />}
          {activeTab === 'Admin' && (
            <div className="settings-workspace-layout">
              {/* Secondary Settings Sub-navigation inside Settings Main Section */}
              <div className="settings-subnav-pane">
                <ul className="settings-subnav-list">
                  {[
                    ...(canManageUsers || user.role === 'admin' ? [{ id: 'users', label: 'Users', icon: Users }] : []),
                    ...(canManageRouting || user.role === 'admin' ? [{ id: 'routing', label: 'Lead Routing', icon: GitBranch }] : []),
                    ...(user.role === 'admin' ? [{ id: 'import', label: 'Import Leads', icon: UploadCloud }] : []),
                    ...(canManageMeta || user.role === 'admin' ? [{ id: 'integrations', label: 'Integrations', icon: Plug }] : []),
                    { id: 'company', label: 'Company', icon: Building2 },
                    ...(canViewPipelines ? [{ id: 'stages', label: 'Pipeline', icon: GitFork }] : []),
                    { id: 'security', label: 'Security', icon: ShieldCheck }
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
                {adminSubTab === 'routing' && (canManageRouting || user.role === 'admin') && <LeadRoutingView />}
                {adminSubTab === 'import' && user.role === 'admin' && (
                  <CsvImportView currentUser={user} onNavigate={navigateTo} />
                )}
                {adminSubTab === 'integrations' && (canManageMeta || user.role === 'admin') && (
                  <MetaIntegrationView currentUser={user} />
                )}
                {adminSubTab === 'stages' && <PipelineSettingsView currentUser={user} />}
                {(adminSubTab === 'company' || adminSubTab === 'security') && (
                  <div className="tab-placeholder-view">
                    <h2 className="placeholder-title">
                      {adminSubTab === 'company' ? 'Company' : 'Security'}
                    </h2>
                    <p className="placeholder-desc">This section is currently under development.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'Pipelines' && <PipelineSettingsView currentUser={user} />}
          {activeTab !== 'Dashboard' && activeTab !== 'Leads' && activeTab !== 'Admin' && activeTab !== 'Pipelines' && (
            <div className="tab-placeholder-view">
              <h2 className="placeholder-title">{activeTab}</h2>
              <p className="placeholder-desc">This section is currently under development.</p>
            </div>
          )}
          </div>
        </main>

        {/* Right Sidebar - Activity Feed (Dynamic) */}
        {activeTab === 'Dashboard' && (
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
    </div>
  );
}
