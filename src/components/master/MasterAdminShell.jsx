import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  CreditCard,
  History,
  Inbox,
  LifeBuoy,
  Loader2,
  LogOut,
  MessageSquareHeart,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  changeMasterPassword,
  createPlatformAdmin,
  fetchMasterOverview,
  provisionMasterEnrollment,
  togglePlatformAdmin,
} from '../../lib/masterAdmin';
import WorkspaceDetailModal, { getWorkspaceStatusInfo } from './WorkspaceDetailModal';
import CreateWorkspaceModal from './CreateWorkspaceModal';
import TicketDetailModal from './TicketDetailModal';
import '../../styles/dashboard.css';
import '../../styles/billing.css';
import '../../styles/admin.css';
import '../../styles/master.css';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SECTION_LABELS = {
  workspaces: 'Workspaces',
  signups: 'Signups',
  support: 'Support',
  transactions: 'Transactions',
  feedback: 'Feedback',
  audit: 'Audit Log',
  security: 'Security',
};

export default function MasterAdminShell({ session, onLogout }) {
  const token = session?.token || '';
  const admin = session?.admin || { id: '', name: 'Founder', email: '' };

  const [activeNav, setActiveNav] = useState('workspaces');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionBanner, setActionBanner] = useState(null);

  const [overview, setOverview] = useState({
    stats: {
      totalWorkspaces: 0,
      activePaidWorkspaces: 0,
      trialingWorkspaces: 0,
      attentionWorkspaces: 0,
      exemptWorkspaces: 0,
      totalActiveUsers: 0,
      totalLeadsCount: 0,
      monthlyRunRateInr: 0,
      totalCollectedInr: 0,
      openTicketsCount: 0,
      pendingEnrollmentsCount: 0,
      surveyResponsesCount: 0,
      avgSurveyRating: 0,
    },
    companies: [],
    recentTransactions: [],
    auditLogs: [],
    supportTickets: [],
    trialEnrollments: [],
    globalSurveys: [],
    platformAdmins: [],
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ticketFilter, setTicketFilter] = useState('open');
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState('');

  // Security forms state
  const [currPwd, setCurrPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [opName, setOpName] = useState('');
  const [opEmail, setOpEmail] = useState('');
  const [opPassword, setOpPassword] = useState('');
  const [securityFeedback, setSecurityFeedback] = useState({ type: '', text: '' });
  const [isSecuritySaving, setIsSecuritySaving] = useState(false);

  const loadData = async () => {
    if (!token) return;
    setIsLoading(true);
    setErrorMsg('');
    const res = await fetchMasterOverview(token);
    if (!res?.success) {
      if (res?.status === 401) {
        onLogout();
        return;
      }
      setErrorMsg(res?.error || 'Could not load platform overview.');
      setIsLoading(false);
      return;
    }

    setOverview((prev) => ({
      ...prev,
      stats: res.stats || prev.stats,
      companies: res.companies || [],
      recentTransactions: res.recentTransactions || [],
      auditLogs: res.auditLogs || [],
      supportTickets: res.supportTickets || [],
      trialEnrollments: res.trialEnrollments || [],
      globalSurveys: res.globalSurveys || [],
      platformAdmins: res.platformAdmins || [],
    }));
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [token]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (overview.companies || []).filter((c) => {
      const info = getWorkspaceStatusInfo(c);
      if (statusFilter === 'active' && info.tone !== 'active') return false;
      if (statusFilter === 'trial' && info.tone !== 'trialing') return false;
      if (statusFilter === 'expired' && info.tone !== 'expired') return false;
      if (statusFilter === 'exempt' && !c.is_billing_exempt) return false;
      if (!q) return true;
      return (
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.slug || '').toLowerCase().includes(q) ||
        String(c.owner_email || '').toLowerCase().includes(q)
      );
    });
  }, [overview.companies, searchQuery, statusFilter]);

  const filteredTickets = useMemo(() => {
    return (overview.supportTickets || []).filter((t) => {
      if (ticketFilter === 'all') return true;
      return String(t.status || 'open') === ticketFilter;
    });
  }, [overview.supportTickets, ticketFilter]);

  const handleEnrollmentAction = async (enrollment, mode) => {
    if (!enrollment?.id) return;
    setActionBanner(null);
    setBusyId(enrollment.id);
    const res = await provisionMasterEnrollment(token, enrollment.id, mode, {
      loginUrl: typeof window !== 'undefined' ? `${window.location.origin}/login` : null,
    });
    setBusyId('');

    if (!res?.success) {
      setErrorMsg(res?.error || 'Could not update signup.');
      return;
    }

    if (mode === 'provision' && res.company) {
      setActionBanner({
        title: `Provisioned workspace: ${res.company.name}`,
        detail: `${res.adminUser?.email}${res.tempPassword ? ` · Temp password: ${res.tempPassword}` : ''}`,
      });
    }
    await loadData();
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setSecurityFeedback({ type: '', text: '' });

    if (newPwd !== confirmPwd) {
      setSecurityFeedback({ type: 'error', text: 'New password confirmation does not match.' });
      return;
    }

    setIsSecuritySaving(true);
    const res = await changeMasterPassword(token, currPwd, newPwd);
    setIsSecuritySaving(false);

    if (!res?.success) {
      setSecurityFeedback({ type: 'error', text: res?.error || 'Could not update password.' });
      return;
    }

    setCurrPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setSecurityFeedback({ type: 'success', text: 'Master password updated cleanly.' });
    await loadData();
  };

  const handleAddOperator = async (e) => {
    e.preventDefault();
    setSecurityFeedback({ type: '', text: '' });

    setIsSecuritySaving(true);
    const res = await createPlatformAdmin(token, {
      name: opName.trim(),
      email: opEmail.trim().toLowerCase(),
      password: opPassword.trim(),
    });
    setIsSecuritySaving(false);

    if (!res?.success) {
      setSecurityFeedback({ type: 'error', text: res?.error || 'Could not add operator.' });
      return;
    }

    setOpName('');
    setOpEmail('');
    setOpPassword('');
    setSecurityFeedback({ type: 'success', text: `Added operator ${res.admin?.email}.` });
    await loadData();
  };

  const handleToggleOperator = async (op) => {
    setSecurityFeedback({ type: '', text: '' });
    setBusyId(op.id);
    const res = await togglePlatformAdmin(token, op.id, !op.is_active);
    setBusyId('');

    if (!res?.success) {
      setSecurityFeedback({ type: 'error', text: res?.error || 'Action failed.' });
      return;
    }
    await loadData();
  };

  const { stats } = overview;

  return (
    <div className="dashboard-root">
      {/* Header - exact CRM chrome (#f3f4f4), borderless */}
      <header className="dashboard-header">
        <div className="header-left-cluster">
          <div
            className="header-brand-wrap"
            onClick={() => setActiveNav('workspaces')}
            title="Master Workspaces"
          >
            <img src="/logo_cropped.png" alt="simplecrm Logo" className="header-brand-logo" />
            <span className="header-brand">simplecrm</span>
          </div>

          <nav className="header-breadcrumb" aria-label="Breadcrumb">
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveNav('workspaces')}>
              Master
            </span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">{SECTION_LABELS[activeNav]}</span>
          </nav>
        </div>

        <div className="header-right-cluster">
          <button
            type="button"
            className="header-icon-btn"
            onClick={loadData}
            disabled={isLoading}
            aria-label="Refresh platform data"
            title="Refresh"
          >
            <RefreshCw size={16} strokeWidth={1.6} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <div className="header-user-menu-wrapper" ref={userMenuRef}>
            <button
              type="button"
              className="header-user-name-btn"
              onClick={() => setShowUserMenu((prev) => !prev)}
              aria-expanded={showUserMenu}
              aria-haspopup="true"
            >
              <span className="user-display-name">{admin.name || 'Founder'}</span>
              <ChevronDown
                size={14}
                strokeWidth={1.75}
                className={`user-chevron ${showUserMenu ? 'open' : ''}`}
              />
            </button>

            {showUserMenu && (
              <div className="header-user-dropdown" role="menu">
                <div className="dropdown-user-email">{admin.email}</div>
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

      {/* Workspace Area - grayish sidebar + curved top-left ghostwhite main canvas */}
      <div className="dashboard-workspace">
        <aside className="dashboard-sidebar-left" aria-label="Master Navigation">
          <div className="nav-section">
            <div className="nav-section-title">Master</div>
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'workspaces' ? 'active' : ''}`}
                  onClick={() => setActiveNav('workspaces')}
                >
                  <Building2 size={18} strokeWidth={1.7} />
                  <span>Workspaces</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'signups' ? 'active' : ''}`}
                  onClick={() => setActiveNav('signups')}
                >
                  <Inbox size={18} strokeWidth={1.7} />
                  <span>Signups</span>
                  {stats.pendingEnrollmentsCount > 0 && (
                    <span className="master-nav-count">{stats.pendingEnrollmentsCount}</span>
                  )}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'support' ? 'active' : ''}`}
                  onClick={() => setActiveNav('support')}
                >
                  <LifeBuoy size={18} strokeWidth={1.7} />
                  <span>Support</span>
                  {stats.openTicketsCount > 0 && (
                    <span className="master-nav-count">{stats.openTicketsCount}</span>
                  )}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'transactions' ? 'active' : ''}`}
                  onClick={() => setActiveNav('transactions')}
                >
                  <CreditCard size={18} strokeWidth={1.7} />
                  <span>Transactions</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'feedback' ? 'active' : ''}`}
                  onClick={() => setActiveNav('feedback')}
                >
                  <MessageSquareHeart size={18} strokeWidth={1.7} />
                  <span>Feedback</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'audit' ? 'active' : ''}`}
                  onClick={() => setActiveNav('audit')}
                >
                  <History size={18} strokeWidth={1.7} />
                  <span>Audit Log</span>
                </button>
              </li>
            </ul>
          </div>

          <div className="sidebar-bottom-group">
            <div className="sidebar-bottom-item">
              <button
                type="button"
                className={`nav-item-btn ${activeNav === 'security' ? 'active' : ''}`}
                onClick={() => setActiveNav('security')}
              >
                <ShieldCheck size={18} strokeWidth={1.7} />
                <span>Security</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="dashboard-main-section">
          <div className="tab-pane-animated">
            <div className="master-view-inner">
              {errorMsg && (
                <div className="billing-alert-box error" role="alert">
                  <span>{errorMsg}</span>
                </div>
              )}

              {actionBanner && (
                <div className="master-temp-box">
                  <strong>{actionBanner.title}</strong>
                  <span>{actionBanner.detail}</span>
                </div>
              )}

              {isLoading && overview.companies.length === 0 ? (
                <div className="master-loading-box">
                  <Loader2 size={22} className="animate-spin" />
                  <span>Loading platform metrics...</span>
                </div>
              ) : activeNav === 'workspaces' ? (
                <>
                  <section className="billing-overview-card" aria-label="Platform Overview">
                    <div className="billing-card-header-row">
                      <div className="billing-card-title-group">
                        <Users size={18} strokeWidth={1.5} className="billing-card-icon" />
                        <h2 className="billing-card-title">Platform Overview</h2>
                      </div>
                      <button
                        type="button"
                        className="billing-header-cta-btn"
                        onClick={() => setIsCreateOpen(true)}
                      >
                        <Plus size={14} strokeWidth={2} />
                        <span>New Workspace</span>
                      </button>
                    </div>

                    <div className="billing-tiles-row master-tiles-row-4">
                      <div className="billing-tile">
                        <span className="billing-tile-val">{stats.totalWorkspaces}</span>
                        <span className="billing-tile-lbl">
                          Workspaces ({stats.activePaidWorkspaces} paid)
                        </span>
                      </div>
                      <div className="billing-tile">
                        <span className="billing-tile-val">{stats.trialingWorkspaces}</span>
                        <span className="billing-tile-lbl">
                          Active Trials ({stats.attentionWorkspaces} ended)
                        </span>
                      </div>
                      <div className="billing-tile">
                        <span className="billing-tile-val">
                          {stats.totalActiveUsers} · {stats.totalLeadsCount}
                        </span>
                        <span className="billing-tile-lbl">CRM Users · Total Leads</span>
                      </div>
                      <div className="billing-tile">
                        <span className="billing-tile-val">
                          ₹{Number(stats.monthlyRunRateInr || 0).toLocaleString('en-IN')}
                        </span>
                        <span className="billing-tile-lbl">Active MRR Estimate</span>
                      </div>
                    </div>
                  </section>

                  <section className="billing-overview-card" aria-label="All Workspaces">
                    <div className="billing-card-header-row">
                      <div className="billing-card-title-group">
                        <Building2 size={18} strokeWidth={1.5} className="billing-card-icon" />
                        <h2 className="billing-card-title">Workspaces</h2>
                      </div>

                      <div className="master-controls-bar">
                        <div className="admin-search-wrapper billing-search-wrapper" style={{ minWidth: '220px' }}>
                          <Search size={14} strokeWidth={1.75} className="admin-search-icon" />
                          <input
                            type="text"
                            className="admin-search-input"
                            placeholder="Search workspace or email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        </div>

                        <div className="master-filter-group" role="group" aria-label="Filter status">
                          {[
                            { id: 'all', label: 'All' },
                            { id: 'active', label: 'Active' },
                            { id: 'trial', label: 'Trial' },
                            { id: 'expired', label: 'Ended' },
                            { id: 'exempt', label: 'Exempt' },
                          ].map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className={`master-filter-btn ${statusFilter === f.id ? 'active' : ''}`}
                              onClick={() => setStatusFilter(f.id)}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {filteredCompanies.length === 0 ? (
                      <div className="billing-empty-state">
                        <h3>No matching workspaces</h3>
                        <p>Adjust your search or create a new client workspace.</p>
                      </div>
                    ) : (
                      <div className="billing-table-wrapper">
                        <table className="billing-bordered-table">
                          <thead>
                            <tr>
                              <th scope="col">Workspace</th>
                              <th scope="col" className="billing-col-num">Users</th>
                              <th scope="col" className="billing-col-num">Leads</th>
                              <th scope="col">Adoption</th>
                              <th scope="col">State</th>
                              <th scope="col">End Date</th>
                              <th scope="col" className="billing-col-num">Rate</th>
                              <th scope="col" style={{ textAlign: 'right' }}>Controls</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCompanies.map((comp) => {
                              const statusInfo = getWorkspaceStatusInfo(comp);
                              return (
                                <tr key={comp.id}>
                                  <td>
                                    <div className="master-workspace-cell">
                                      <span className="master-workspace-name">{comp.name}</span>
                                      <span className="master-workspace-sub">
                                        {comp.owner_email || comp.slug}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="billing-col-num">
                                    <strong>{comp.active_users_count || 0}</strong>
                                  </td>
                                  <td className="billing-col-num">{comp.leads_count || 0}</td>
                                  <td>
                                    <div className="master-adoption-row">
                                      <span className={`master-adoption-item ${comp.whatsapp_connected ? 'on' : ''}`}>
                                        <span className="master-adoption-dot" />
                                        WA
                                      </span>
                                      <span className={`master-adoption-item ${comp.meta_connected ? 'on' : ''}`}>
                                        <span className="master-adoption-dot" />
                                        Meta
                                      </span>
                                      <span className={`master-adoption-item ${comp.email_connected ? 'on' : ''}`}>
                                        <span className="master-adoption-dot" />
                                        Email
                                      </span>
                                      <span className={`master-adoption-item ${comp.forms_count > 0 ? 'on' : ''}`}>
                                        <span className="master-adoption-dot" />
                                        Forms
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    <span className="master-status-text">
                                      <span className={`master-status-dot ${statusInfo.tone}`} />
                                      <span>{statusInfo.label}</span>
                                    </span>
                                  </td>
                                  <td>
                                    {comp.current_period_end
                                      ? formatDate(comp.current_period_end)
                                      : formatDate(comp.trial_ends_at)}
                                  </td>
                                  <td className="billing-col-num">
                                    ₹{Number(comp.price_per_seat_inr || 999).toLocaleString('en-IN')}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      className="master-manage-btn"
                                      onClick={() => setSelectedCompany(comp)}
                                    >
                                      Manage
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              ) : activeNav === 'signups' ? (
                <section className="billing-overview-card" aria-label="Inbound Trial Signups">
                  <div className="billing-card-header-row">
                    <div className="billing-card-title-group">
                      <Inbox size={18} strokeWidth={1.5} className="billing-card-icon" />
                      <h2 className="billing-card-title">Trial Signups</h2>
                    </div>
                    <span className="billing-overview-badge">
                      {overview.trialEnrollments.length} total · {stats.pendingEnrollmentsCount} pending
                    </span>
                  </div>

                  {overview.trialEnrollments.length === 0 ? (
                    <div className="billing-empty-state">
                      <h3>No inbound trial requests yet</h3>
                      <p>Leads from the landing or pricing trial form appear here.</p>
                    </div>
                  ) : (
                    <div className="billing-table-wrapper">
                      <table className="billing-bordered-table">
                        <thead>
                          <tr>
                            <th scope="col">Applicant</th>
                            <th scope="col">Company</th>
                            <th scope="col">Phone</th>
                            <th scope="col">Status</th>
                            <th scope="col">Requested</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.trialEnrollments.map((en) => (
                            <tr key={en.id}>
                              <td>
                                <div className="master-workspace-cell">
                                  <span className="master-workspace-name">{en.full_name}</span>
                                  <span className="master-workspace-sub">{en.work_email}</span>
                                </div>
                              </td>
                              <td>{en.provisioned_company_name || en.company_name || '—'}</td>
                              <td>{en.phone || '—'}</td>
                              <td>
                                <span className="master-status-text">
                                  <span
                                    className={`master-status-dot ${
                                      en.status === 'provisioned' || en.status === 'converted'
                                        ? 'active'
                                        : en.status === 'churned'
                                        ? 'expired'
                                        : 'trialing'
                                    }`}
                                  />
                                  <span style={{ textTransform: 'capitalize' }}>{en.status}</span>
                                </span>
                              </td>
                              <td>{formatDateTime(en.created_at)}</td>
                              <td style={{ textAlign: 'right' }}>
                                {en.status === 'pending' ? (
                                  <div className="master-action-stack">
                                    <button
                                      type="button"
                                      className="master-manage-btn"
                                      disabled={busyId === en.id}
                                      onClick={() => handleEnrollmentAction(en, 'provision')}
                                    >
                                      Provision
                                    </button>
                                    <button
                                      type="button"
                                      className="master-manage-btn"
                                      disabled={busyId === en.id}
                                      onClick={() => handleEnrollmentAction(en, 'mark_churned')}
                                    >
                                      Dismiss
                                    </button>
                                  </div>
                                ) : (
                                  <span className="master-workspace-sub">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : activeNav === 'support' ? (
                <section className="billing-overview-card" aria-label="Support Tickets">
                  <div className="billing-card-header-row">
                    <div className="billing-card-title-group">
                      <LifeBuoy size={18} strokeWidth={1.5} className="billing-card-icon" />
                      <h2 className="billing-card-title">Support Inbox</h2>
                    </div>

                    <div className="master-filter-group" role="group" aria-label="Filter tickets">
                      {[
                        { id: 'all', label: 'All' },
                        { id: 'open', label: 'Open' },
                        { id: 'in_progress', label: 'In Progress' },
                        { id: 'resolved', label: 'Resolved' },
                      ].map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={`master-filter-btn ${ticketFilter === f.id ? 'active' : ''}`}
                          onClick={() => setTicketFilter(f.id)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredTickets.length === 0 ? (
                    <div className="billing-empty-state">
                      <h3>No tickets in this view</h3>
                      <p>Customer queries and suggestions submitted inside the CRM appear here.</p>
                    </div>
                  ) : (
                    <div className="billing-table-wrapper">
                      <table className="billing-bordered-table">
                        <thead>
                          <tr>
                            <th scope="col">Submitted</th>
                            <th scope="col">Workspace</th>
                            <th scope="col">Requester</th>
                            <th scope="col">Subject</th>
                            <th scope="col">Status</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTickets.map((t) => (
                            <tr key={t.id}>
                              <td>{formatDateTime(t.created_at)}</td>
                              <td><strong>{t.company_name}</strong></td>
                              <td>
                                <div className="master-workspace-cell">
                                  <span>{t.user_name || 'User'}</span>
                                  <span className="master-workspace-sub">{t.user_email}</span>
                                </div>
                              </td>
                              <td>
                                <div className="master-ticket-subject-row">
                                  <span>{t.subject || t.type || 'Support query'}</span>
                                  {Array.isArray(t.metadata?.attachments) &&
                                    t.metadata.attachments.length > 0 && (
                                      <span
                                        className="master-attach-indicator"
                                        title={`${t.metadata.attachments.length} attachment(s)`}
                                      >
                                        <Paperclip size={13} />
                                        {t.metadata.attachments.length}
                                      </span>
                                    )}
                                </div>
                              </td>
                              <td>
                                <span className="master-status-text">
                                  <span
                                    className={`master-status-dot ${
                                      t.status === 'resolved' || t.status === 'closed'
                                        ? 'active'
                                        : t.status === 'open'
                                        ? 'expired'
                                        : 'trialing'
                                    }`}
                                  />
                                  <span style={{ textTransform: 'capitalize' }}>
                                    {String(t.status || 'open').replace('_', ' ')}
                                  </span>
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  type="button"
                                  className="master-manage-btn"
                                  onClick={() => setSelectedTicket(t)}
                                >
                                  Inspect
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : activeNav === 'transactions' ? (
                <section className="billing-overview-card" aria-label="Global Transactions">
                  <div className="billing-card-header-row">
                    <div className="billing-card-title-group">
                      <CreditCard size={18} strokeWidth={1.5} className="billing-card-icon" />
                      <h2 className="billing-card-title">Billing Transactions</h2>
                    </div>
                    <span className="billing-overview-badge">
                      Total Collected: ₹{Number(stats.totalCollectedInr || 0).toLocaleString('en-IN')}
                    </span>
                  </div>

                  {overview.recentTransactions.length === 0 ? (
                    <div className="billing-empty-state">
                      <h3>No transactions yet</h3>
                    </div>
                  ) : (
                    <div className="billing-table-wrapper">
                      <table className="billing-bordered-table billing-tx-table">
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Workspace</th>
                            <th scope="col">Method / Type</th>
                            <th scope="col" className="billing-col-num">Users</th>
                            <th scope="col" className="billing-col-num">Amount</th>
                            <th scope="col">Status</th>
                            <th scope="col">Reference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.recentTransactions.map((tx) => (
                            <tr key={tx.id}>
                              <td>{formatDateTime(tx.created_at)}</td>
                              <td><strong>{tx.company_name}</strong></td>
                              <td>
                                {tx.metadata?.source === 'manual_offline'
                                  ? `Direct (${tx.metadata?.method || 'Offline'})`
                                  : tx.transaction_type}
                              </td>
                              <td className="billing-col-num">{tx.seats_delta}</td>
                              <td className="billing-col-num">
                                <strong>₹{Number(tx.amount_inr || 0).toLocaleString('en-IN')}</strong>
                              </td>
                              <td>
                                <span className={`billing-tx-status ${tx.status}`}>{tx.status}</span>
                              </td>
                              <td className="billing-tx-id-cell">
                                {tx.razorpay_payment_id || tx.razorpay_order_id || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : activeNav === 'feedback' ? (
                <section className="billing-overview-card" aria-label="Product Feedback Surveys">
                  <div className="billing-card-header-row">
                    <div className="billing-card-title-group">
                      <MessageSquareHeart size={18} strokeWidth={1.5} className="billing-card-icon" />
                      <h2 className="billing-card-title">Day-15 Member Feedback</h2>
                    </div>
                    <span className="billing-overview-badge">
                      {stats.surveyResponsesCount} responses
                      {stats.surveyResponsesCount > 0 ? ` · Avg ${stats.avgSurveyRating}/5★` : ''}
                    </span>
                  </div>

                  {overview.globalSurveys.length === 0 ? (
                    <div className="billing-empty-state">
                      <h3>No feedback submissions yet</h3>
                      <p>Day-15 member survey responses across all workspaces appear here.</p>
                    </div>
                  ) : (
                    <div className="billing-table-wrapper">
                      <table className="billing-bordered-table">
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Workspace</th>
                            <th scope="col">Member</th>
                            <th scope="col">Rating</th>
                            <th scope="col">Keep Using</th>
                            <th scope="col">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.globalSurveys.map((s) => (
                            <tr key={s.id}>
                              <td>{formatDate(s.created_at)}</td>
                              <td><strong>{s.company_name}</strong></td>
                              <td>
                                <div className="master-workspace-cell">
                                  <span>{s.user_name || 'Member'}</span>
                                  <span className="master-workspace-sub">{s.user_email}</span>
                                </div>
                              </td>
                              <td><strong>{s.rating}/5 ★</strong></td>
                              <td>{s.wants_to_continue ? 'Yes' : 'No'}</td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {Array.isArray(s.favorite_features) && s.favorite_features.length > 0 && (
                                    <div className="master-survey-pill-group" style={{ marginTop: 0 }}>
                                      {s.favorite_features.map((f) => (
                                        <span key={f} className="master-survey-pill feature">{f}</span>
                                      ))}
                                    </div>
                                  )}
                                  {Array.isArray(s.pain_points) && s.pain_points.length > 0 && (
                                    <div className="master-survey-pill-group" style={{ marginTop: 0 }}>
                                      {s.pain_points.map((p) => (
                                        <span key={p} className="master-survey-pill pain">{p}</span>
                                      ))}
                                    </div>
                                  )}
                                  {s.missing_features && (
                                    <span style={{ fontSize: 12, color: '#09090b' }}>
                                      <strong>Build Next:</strong> {s.missing_features}
                                    </span>
                                  )}
                                  {(s.feedback_notes || s.feedback_note) && (
                                    <span style={{ fontSize: 12, color: '#525252' }}>
                                      {s.feedback_notes || s.feedback_note}
                                    </span>
                                  )}
                                  {!s.missing_features && !s.feedback_notes && !s.feedback_note && !s.favorite_features?.length && !s.pain_points?.length && (
                                    <span>—</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : activeNav === 'audit' ? (
                <section className="billing-overview-card" aria-label="Founder Audit Log">
                  <div className="billing-card-header-row">
                    <div className="billing-card-title-group">
                      <History size={18} strokeWidth={1.5} className="billing-card-icon" />
                      <h2 className="billing-card-title">Audit Log</h2>
                    </div>
                  </div>

                  {overview.auditLogs.length === 0 ? (
                    <div className="billing-empty-state">
                      <h3>No override activity yet</h3>
                    </div>
                  ) : (
                    <div className="billing-table-wrapper">
                      <table className="billing-bordered-table">
                        <thead>
                          <tr>
                            <th scope="col">Time</th>
                            <th scope="col">Admin</th>
                            <th scope="col">Workspace</th>
                            <th scope="col">Action</th>
                            <th scope="col">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.auditLogs.map((log) => (
                            <tr key={log.id}>
                              <td>{formatDateTime(log.created_at)}</td>
                              <td>{log.admin_email}</td>
                              <td><strong>{log.company_name}</strong></td>
                              <td>{log.action}</td>
                              <td className="billing-tx-id-cell">
                                {JSON.stringify(log.details || {})}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : (
                <>
                  {securityFeedback.text && (
                    <div
                      className={`billing-alert-box ${
                        securityFeedback.type === 'error' ? 'error' : 'success'
                      }`}
                    >
                      <span>{securityFeedback.text}</span>
                    </div>
                  )}

                  <section className="billing-overview-card" aria-label="Change Master Password">
                    <div className="billing-card-header-row">
                      <div className="billing-card-title-group">
                        <ShieldCheck size={18} strokeWidth={1.5} className="billing-card-icon" />
                        <h2 className="billing-card-title">Master Password</h2>
                      </div>
                    </div>

                    <form onSubmit={handleChangePassword} className="master-section-block">
                      <div className="master-form-grid">
                        <div className="master-field">
                          <label htmlFor="sec-curr-pwd" className="master-field-label">
                            Current Password
                          </label>
                          <input
                            id="sec-curr-pwd"
                            type="password"
                            className="master-inline-input"
                            value={currPwd}
                            onChange={(e) => setCurrPwd(e.target.value)}
                            required
                          />
                        </div>
                        <div className="master-field">
                          <label htmlFor="sec-new-pwd" className="master-field-label">
                            New Password
                          </label>
                          <input
                            id="sec-new-pwd"
                            type="password"
                            className="master-inline-input"
                            value={newPwd}
                            onChange={(e) => setNewPwd(e.target.value)}
                            required
                          />
                        </div>
                        <div className="master-field">
                          <label htmlFor="sec-confirm-pwd" className="master-field-label">
                            Confirm New Password
                          </label>
                          <input
                            id="sec-confirm-pwd"
                            type="password"
                            className="master-inline-input"
                            value={confirmPwd}
                            onChange={(e) => setConfirmPwd(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="master-price-row">
                        <button
                          type="submit"
                          className="billing-header-cta-btn"
                          disabled={isSecuritySaving}
                        >
                          Update Password
                        </button>
                      </div>
                    </form>
                  </section>

                  <section className="billing-overview-card" aria-label="Platform Operators">
                    <div className="billing-card-header-row">
                      <div className="billing-card-title-group">
                        <Users size={18} strokeWidth={1.5} className="billing-card-icon" />
                        <h2 className="billing-card-title">Master Operators</h2>
                      </div>
                    </div>

                    <div className="billing-table-wrapper">
                      <table className="billing-bordered-table">
                        <thead>
                          <tr>
                            <th scope="col">Name</th>
                            <th scope="col">Email</th>
                            <th scope="col">Status</th>
                            <th scope="col">Last Login</th>
                            <th scope="col" style={{ textAlign: 'right' }}>Access</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.platformAdmins.map((op) => (
                            <tr key={op.id}>
                              <td><strong>{op.name}</strong></td>
                              <td>{op.email}</td>
                              <td>
                                <span className="master-status-text">
                                  <span
                                    className={`master-status-dot ${
                                      op.is_active ? 'active' : 'expired'
                                    }`}
                                  />
                                  <span>{op.is_active ? 'Active' : 'Disabled'}</span>
                                </span>
                              </td>
                              <td>{formatDateTime(op.last_login_at)}</td>
                              <td style={{ textAlign: 'right' }}>
                                {op.email !== admin.email ? (
                                  <button
                                    type="button"
                                    className="master-manage-btn"
                                    disabled={busyId === op.id}
                                    onClick={() => handleToggleOperator(op)}
                                  >
                                    {op.is_active ? 'Disable' : 'Activate'}
                                  </button>
                                ) : (
                                  <span className="master-workspace-sub">Current</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="master-divider" />

                    <form onSubmit={handleAddOperator} className="master-section-block">
                      <span className="master-section-label">Add Operator</span>
                      <div className="master-price-row">
                        <input
                          type="text"
                          className="master-inline-input"
                          placeholder="Full name"
                          value={opName}
                          onChange={(e) => setOpName(e.target.value)}
                          required
                        />
                        <input
                          type="email"
                          className="master-inline-input"
                          placeholder="Email"
                          value={opEmail}
                          onChange={(e) => setOpEmail(e.target.value)}
                          required
                          style={{ minWidth: '210px' }}
                        />
                        <input
                          type="password"
                          className="master-inline-input"
                          placeholder="Initial password"
                          value={opPassword}
                          onChange={(e) => setOpPassword(e.target.value)}
                          required
                        />
                        <button
                          type="submit"
                          className="billing-header-cta-btn"
                          disabled={isSecuritySaving}
                        >
                          Add Operator
                        </button>
                      </div>
                    </form>
                  </section>
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {selectedCompany && (
        <WorkspaceDetailModal
          token={token}
          companySummary={selectedCompany}
          onClose={() => setSelectedCompany(null)}
          onUpdated={() => loadData()}
        />
      )}

      {selectedTicket && (
        <TicketDetailModal
          token={token}
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onUpdated={() => loadData()}
        />
      )}

      {isCreateOpen && (
        <CreateWorkspaceModal
          token={token}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => loadData()}
        />
      )}
    </div>
  );
}
