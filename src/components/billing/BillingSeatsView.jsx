import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CreditCard,
  Users,
  Loader2,
  CheckCircle2,
  Receipt,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Star,
  MessageSquareHeart,
  AlertTriangle,
  X,
  UserCog,
  ArrowRight
} from 'lucide-react';
import { getActiveCompany, getActiveCompanyId, setActiveCompanyCache } from '../../lib/tenant';
import { supabase } from '../../lib/supabase';
import {
  fetchCompanyBillingSnapshot,
  fetchCompanyTrialFeedbackSummary,
  getBillingCycleDaysLeft,
  getTrialDaysRemaining,
  isWithinRenewalGrace,
  launchRazorpayCheckout
} from '../../lib/billing';
import Skeleton from '../common/Skeleton';
import '../../styles/billing.css';

const USERS_PER_PAGE = 5;
const EMPTY_SURVEY_SUMMARY = {
  responses: [],
  totalResponses: 0,
  avgRating: 0,
  wantsToContinueCount: 0,
  helpsSalesCount: 0,
  keepsOrganizedCount: 0
};
// Module-level stale-while-revalidate cache keyed by companyId so switching tabs doesn't re-skeletonize
const billingSnapshotCache = new Map();

function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) items.push('ellipsis-left');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < totalPages - 1) items.push('ellipsis-right');
  items.push(totalPages);
  return items;
}

export default function BillingSeatsView({
  currentUser,
  isConversionMode = false,
  onNavigateToUsers,
  onCompanyUpdated
}) {
  const activeCompanyId = getActiveCompanyId() || currentUser?.company_id;
  const cachedSnapshot = activeCompanyId ? billingSnapshotCache.get(activeCompanyId) : null;

  const [company, setCompany] = useState(() => cachedSnapshot?.company || getActiveCompany());
  const [activeUsersCount, setActiveUsersCount] = useState(() => cachedSnapshot?.activeUsersCount ?? 0);
  const [transactions, setTransactions] = useState(() => cachedSnapshot?.transactions || []);
  const [teamMembers, setTeamMembers] = useState(() => cachedSnapshot?.teamMembers || []);
  const [memberQuery, setMemberQuery] = useState('');
  const [rosterPage, setRosterPage] = useState(1);
  const [surveySummary, setSurveySummary] = useState(
    () => cachedSnapshot?.surveySummary || EMPTY_SURVEY_SUMMARY
  );
  const [isSurveyModalOpen, setIsSurveyModalOpen] = useState(false);

  const continuePercent = surveySummary.totalResponses > 0
    ? Math.round((surveySummary.wantsToContinueCount / surveySummary.totalResponses) * 100)
    : 100;

  const [isLoading, setIsLoading] = useState(() => !cachedSnapshot);
  const [isPaying, setIsPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showManageMenu, setShowManageMenu] = useState(false);
  const manageMenuRef = useRef(null);

  useEffect(() => {
    if (!showManageMenu) return;
    const handleClickOutside = (e) => {
      if (manageMenuRef.current && !manageMenuRef.current.contains(e.target)) {
        setShowManageMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showManageMenu]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return teamMembers;
    return teamMembers.filter(
      (m) =>
        String(m.name || '').toLowerCase().includes(q) ||
        String(m.email || '').toLowerCase().includes(q) ||
        String(m.role || '').toLowerCase().includes(q)
    );
  }, [teamMembers, memberQuery]);

  const loadSnapshot = async ({ silent = false } = {}) => {
    if (!activeCompanyId) {
      setIsLoading(false);
      return;
    }
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const cycleKey = company?.current_period_end ? 'renewal' : 'trial';
      const [snap, membersRes, summary] = await Promise.all([
        fetchCompanyBillingSnapshot(activeCompanyId),
        supabase
          .from('crm_users')
          .select('id, name, email, role, created_at')
          .eq('company_id', activeCompanyId)
          .order('created_at', { ascending: true }),
        fetchCompanyTrialFeedbackSummary(activeCompanyId, cycleKey)
      ]);

      const nextCompany = snap.company || company;
      const nextMembers = Array.isArray(membersRes.data) ? membersRes.data : teamMembers;
      const nextSummary = summary || surveySummary;

      if (snap.company) {
        setCompany(snap.company);
        setActiveCompanyCache(snap.company);
        if (onCompanyUpdated) onCompanyUpdated(snap.company);
      }
      setActiveUsersCount(snap.activeUsersCount);
      setTransactions(snap.transactions);
      if (Array.isArray(membersRes.data)) {
        setTeamMembers(membersRes.data);
      }
      if (summary) {
        setSurveySummary(summary);
      }

      billingSnapshotCache.set(activeCompanyId, {
        company: nextCompany,
        activeUsersCount: snap.activeUsersCount,
        transactions: snap.transactions,
        teamMembers: nextMembers,
        surveySummary: nextSummary
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const cached = activeCompanyId ? billingSnapshotCache.get(activeCompanyId) : null;
    if (cached) {
      setCompany(cached.company || getActiveCompany());
      setActiveUsersCount(cached.activeUsersCount ?? 0);
      setTransactions(cached.transactions || []);
      setTeamMembers(cached.teamMembers || []);
      setSurveySummary(cached.surveySummary || EMPTY_SURVEY_SUMMARY);
      setIsLoading(false);
      loadSnapshot({ silent: true });
    } else {
      loadSnapshot({ silent: false });
    }
  }, [activeCompanyId]);

  const isExempt = Boolean(company?.is_billing_exempt);
  const billableUsersCount = Math.max(1, activeUsersCount || teamMembers.length || 1);
  const unitPriceInr = Math.max(1, Number(company?.price_per_seat_inr || 999));
  const monthlyTotalInr = billableUsersCount * unitPriceInr;
  const trialDaysLeft = getTrialDaysRemaining(company);
  const cycleDaysLeft = getBillingCycleDaysLeft(company);
  const inRenewalGrace = isWithinRenewalGrace(company);
  const status = String(company?.subscription_status || 'trialing').toLowerCase();
  const isTrialStatus = status === 'trialing' || status === 'pilot_extended';
  const hasPaidBefore = Boolean(company?.current_period_end) || status === 'active' || status === 'past_due';
  const hasAutopay = Boolean(company?.razorpay_subscription_id);
  const isAutopayHealthy = hasAutopay && status === 'active' && !inRenewalGrace;

  const formattedPeriodEnd = company?.current_period_end
    ? new Date(company.current_period_end).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
    : null;

  const showPrimaryPayCta =
    !isExempt &&
    !isAutopayHealthy &&
    (!hasPaidBefore || isConversionMode || inRenewalGrace || status === 'past_due' || status === 'expired' || status === 'cancelled');

  const handleActivateOrRenew = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsPaying(true);

    const transactionType = hasPaidBefore ? 'renewal' : 'initial_activation';
    await launchRazorpayCheckout({
      transactionType,
      seatsRequested: billableUsersCount,
      description: `${company?.name || 'simplecrm'} · ${billableUsersCount} Active User${billableUsersCount > 1 ? 's' : ''} Monthly`,
      onSuccess: async (res) => {
        setIsPaying(false);
        if (res.company) {
          setCompany(res.company);
          setActiveCompanyCache(res.company);
          if (onCompanyUpdated) onCompanyUpdated(res.company);
        }
        setSuccessMsg(
          hasPaidBefore
            ? `Autopay updated for ${billableUsersCount} active user${billableUsersCount > 1 ? 's' : ''}!`
            : `Autopay activated for ${billableUsersCount} active user${billableUsersCount > 1 ? 's' : ''}!`
        );
        await loadSnapshot({ silent: true });
      },
      onError: (err) => {
        setIsPaying(false);
        setErrorMsg(err?.error || 'Could not process Razorpay checkout.');
      },
      onDismiss: () => {
        setIsPaying(false);
      }
    });
  };

  const renderPlanStatus = () => {
    if (isExempt) {
      return (
        <span className="billing-plan-status active">
          <span className="billing-plan-status-dot" aria-hidden="true" />
          <span>Enterprise Exempt</span>
        </span>
      );
    }
    if (inRenewalGrace) {
      return (
        <span className="billing-plan-status expired">
          <span className="billing-plan-status-dot" aria-hidden="true" />
          <span>Renewal Grace</span>
        </span>
      );
    }
    if (status === 'active') {
      return (
        <span className="billing-plan-status active">
          <span className="billing-plan-status-dot" aria-hidden="true" />
          <span>{hasAutopay ? 'Autopay Active' : 'Active Monthly'}</span>
        </span>
      );
    }
    if (isTrialStatus && !isConversionMode) {
      return (
        <span className="billing-plan-status trialing">
          <span className="billing-plan-status-dot" aria-hidden="true" />
          <span>
            {status === 'pilot_extended' ? 'Extended Pilot' : '14-Day Trial'} · {trialDaysLeft}d left
          </span>
        </span>
      );
    }
    return (
      <span className="billing-plan-status expired">
        <span className="billing-plan-status-dot" aria-hidden="true" />
        <span>{hasPaidBefore ? 'Renewal Required' : 'Trial Ended'}</span>
      </span>
    );
  };

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / USERS_PER_PAGE));
  const safePage = Math.min(rosterPage, totalPages);
  const pageStart = (safePage - 1) * USERS_PER_PAGE;
  const visibleMembers = filteredMembers.slice(pageStart, pageStart + USERS_PER_PAGE);
  const paginationItems = getPaginationItems(safePage, totalPages);

  return (
    <div className="admin-view-container billing-view-container">
      <div className="admin-view-inner">
        <header className="admin-master-header">
          <div className="admin-master-title-group">
            <h1 className="admin-master-title">Billing</h1>
          </div>

          <div className="admin-actions-group">
            {isLoading ? (
              <Skeleton width="112px" height="36px" borderRadius="8px" />
            ) : (
              renderPlanStatus()
            )}
          </div>
        </header>

        {isLoading && isConversionMode ? (
          <div className="billing-story-note loading" aria-busy="true" aria-label="Loading billing note">
            <Skeleton width="480px" height="18px" borderRadius="4px" />
          </div>
        ) : !isLoading && (isConversionMode || inRenewalGrace) && surveySummary.totalResponses === 0 ? (
          <div className="billing-story-note" role="region" aria-label="Workspace billing notice">
            {inRenewalGrace ? (
              <p className="billing-story-text">
                Monthly renewal is due — 3-day grace active.{' '}
                <span className="billing-story-subtext">Renew below to keep your workspace uninterrupted before grace ends.</span>
              </p>
            ) : (
              <p className="billing-story-text">
                {hasPaidBefore ? 'Monthly subscription expired.' : 'Your 14-day free trial has ended.'}{' '}
                <span className="billing-story-subtext">Review active team members below to activate your plan.</span>
              </p>
            )}
          </div>
        ) : null}

        {successMsg && (
          <div className="billing-alert-box success" role="status" aria-live="polite">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="billing-alert-box error" role="alert">
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Workspace Plan Overview Card */}
        {isLoading ? (
          <div className="billing-overview-card" aria-busy="true" aria-label="Loading workspace plan">
            <div className="billing-card-header-row">
              <div className="billing-card-title-group">
                <Skeleton width="18px" height="18px" borderRadius="4px" />
                <Skeleton width="132px" height="18px" borderRadius="4px" />
              </div>
              <Skeleton width="126px" height="24px" borderRadius="8px" />
            </div>
            <div className="billing-tiles-row">
              {[1, 2, 3].map((i) => (
                <div key={i} className="billing-tile">
                  <Skeleton width="76px" height="26px" borderRadius="6px" />
                  <Skeleton width="108px" height="12px" borderRadius="4px" />
                </div>
              ))}
            </div>
            <div className="billing-plan-actions-row">
              {showPrimaryPayCta && <Skeleton width="100%" height="42px" borderRadius="8px" style={{ flex: 1 }} />}
              {typeof onNavigateToUsers === 'function' && (
                <Skeleton width="132px" height="42px" borderRadius="8px" />
              )}
            </div>
          </div>
        ) : (
          <section className="billing-overview-card fade-in-card billing-plan-overview-card" aria-labelledby="billing-plan-heading">
            <div className="billing-card-header-row">
              <div className="billing-card-title-group">
                <Users size={18} strokeWidth={1.5} className="billing-card-icon" aria-hidden="true" />
                <h2 id="billing-plan-heading" className="billing-card-title">Workspace Plan</h2>
              </div>
              <span className="billing-overview-badge">
                {formattedPeriodEnd
                  ? hasAutopay
                    ? `Autopay Renews ${formattedPeriodEnd}`
                    : `Renews ${formattedPeriodEnd}`
                  : isTrialStatus && !isConversionMode && trialDaysLeft > 0
                    ? 'Unlimited trial users'
                    : 'Monthly per-user plan'}
              </span>
            </div>

            <div className="billing-tiles-row">
              <div className="billing-tile">
                <span className="billing-tile-val">{activeUsersCount}</span>
                <span className="billing-tile-lbl">Active Users</span>
              </div>

              <div className="billing-tile">
                <span className="billing-tile-val">
                  ₹{unitPriceInr.toLocaleString('en-IN')}
                </span>
                <span className="billing-tile-lbl">Rate per User / mo</span>
              </div>

              <div className="billing-tile">
                <span className="billing-tile-val">
                  {isExempt ? 'Exempt' : `₹${monthlyTotalInr.toLocaleString('en-IN')}`}
                </span>
                <span className="billing-tile-lbl">
                  {hasAutopay ? 'Next Autopay Debit / mo' : hasPaidBefore ? 'Next Renewal Estimate / mo' : 'Plan Total / mo'}
                </span>
              </div>
            </div>

            {(showPrimaryPayCta || isExempt || isAutopayHealthy || typeof onNavigateToUsers === 'function') && (
              <div className={`billing-plan-actions-row ${!showPrimaryPayCta && !isExempt ? 'end' : ''}`}>
                {isExempt && (
                  <p className="billing-plan-footnote">
                    Internal billing-exempt workspace. Team size scales automatically without checkout.
                  </p>
                )}

                {!isExempt && isAutopayHealthy && (
                  <p className="billing-plan-footnote">
                    Autopay active via e-mandate · Next debit of ₹{monthlyTotalInr.toLocaleString('en-IN')} on {formattedPeriodEnd}.
                  </p>
                )}

                {showPrimaryPayCta && (
                  <button
                    type="button"
                    className="billing-plan-cta-btn"
                    onClick={handleActivateOrRenew}
                    disabled={isPaying}
                  >
                    {isPaying ? (
                      <>
                        <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <CreditCard size={15} strokeWidth={1.9} aria-hidden="true" />
                        <span>
                          {hasPaidBefore
                            ? hasAutopay
                              ? `Reactivate Autopay · ₹${monthlyTotalInr.toLocaleString('en-IN')}`
                              : `Renew Plan · ₹${monthlyTotalInr.toLocaleString('en-IN')}`
                            : `Set up Autopay · ₹${monthlyTotalInr.toLocaleString('en-IN')}`}
                        </span>
                      </>
                    )}
                  </button>
                )}

                <div className="billing-manage-menu-container" ref={manageMenuRef}>
                  <button
                    type="button"
                    className="billing-secondary-btn billing-plan-manage-btn"
                    onClick={() => setShowManageMenu((prev) => !prev)}
                    aria-expanded={showManageMenu}
                    aria-haspopup="true"
                  >
                    <UserCog size={14} aria-hidden="true" />
                    <span>Manage</span>
                    <ChevronDown size={13} className={`billing-manage-chevron ${showManageMenu ? 'open' : ''}`} aria-hidden="true" />
                  </button>

                  {showManageMenu && (
                    <div className="billing-manage-dropdown" role="menu">
                      <button
                        type="button"
                        className="billing-dropdown-item"
                        onClick={() => {
                          setShowManageMenu(false);
                          handleActivateOrRenew();
                        }}
                        role="menuitem"
                      >
                        <CreditCard size={14} aria-hidden="true" />
                        <span>Change Payment Method</span>
                      </button>

                      {typeof onNavigateToUsers === 'function' && (
                        <button
                          type="button"
                          className="billing-dropdown-item"
                          onClick={() => {
                            setShowManageMenu(false);
                            onNavigateToUsers();
                          }}
                          role="menuitem"
                        >
                          <Users size={14} aria-hidden="true" />
                          <span>Manage Users</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {!hasPaidBefore && surveySummary.totalResponses > 0 && (
              <div className="billing-plan-feedback-footer">
                <p className="billing-story-text">
                  Meanwhile, we asked your team with a quick survey and{' '}
                  <strong>{continuePercent}% of them want to continue using simplecrm</strong>.
                </p>
                <button
                  type="button"
                  className="billing-story-link"
                  onClick={() => setIsSurveyModalOpen(true)}
                >
                  View details
                </button>
              </div>
            )}
          </section>
        )}

        {/* Active Team Roster Card & Bordered Table */}
        {isLoading ? (
          <div className="billing-overview-card" aria-busy="true" aria-label="Loading active team roster">
            <div className="billing-card-header-row">
              <div className="billing-card-title-group">
                <Skeleton width="18px" height="18px" borderRadius="4px" />
                <Skeleton width="146px" height="18px" borderRadius="4px" />
                <Skeleton width="86px" height="24px" borderRadius="8px" />
              </div>
              <Skeleton width="196px" height="34px" borderRadius="8px" />
            </div>
            <div className="billing-table-wrapper">
              <table className="billing-bordered-table billing-roster-table">
                <thead>
                  <tr>
                    <th scope="col" className="billing-col-index">#</th>
                    <th scope="col">Member</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="billing-col-action">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4].map((row) => (
                    <tr key={row}>
                      <td className="billing-col-index">
                        <Skeleton width="14px" height="13px" borderRadius="4px" />
                      </td>
                      <td>
                        <div className="billing-member-cell" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <Skeleton width="128px" height="14px" borderRadius="4px" />
                          <Skeleton width="176px" height="11px" borderRadius="4px" />
                        </div>
                      </td>
                      <td>
                        <Skeleton width="52px" height="14px" borderRadius="4px" />
                      </td>
                      <td className="billing-col-action">
                        <Skeleton width="76px" height="13px" borderRadius="4px" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : teamMembers.length > 0 && (
          <section className="billing-overview-card fade-in-card" aria-labelledby="billing-roster-heading">
            <div className="billing-card-header-row">
              <div className="billing-card-title-group">
                <Users size={18} strokeWidth={1.5} className="billing-card-icon" aria-hidden="true" />
                <h2 id="billing-roster-heading" className="billing-card-title">Active Team Roster</h2>
                <span className="billing-overview-badge">
                  {teamMembers.length} active {teamMembers.length === 1 ? 'user' : 'users'}
                </span>
              </div>

              {teamMembers.length > 4 && (
                <search className="billing-search-region">
                  <div className="admin-search-wrapper billing-search-wrapper">
                    <label htmlFor="billing-roster-search" className="visually-hidden">
                      Search active team members
                    </label>
                    <Search size={15} strokeWidth={1.75} className="admin-search-icon" aria-hidden="true" />
                    <input
                      id="billing-roster-search"
                      type="search"
                      value={memberQuery}
                      onChange={(e) => {
                        setMemberQuery(e.target.value);
                        setRosterPage(1);
                      }}
                      placeholder="Search users..."
                      className="admin-search-input"
                    />
                  </div>
                </search>
              )}
            </div>

            {filteredMembers.length === 0 ? (
              <div className="billing-empty-inline">
                No workspace members match &ldquo;{memberQuery}&rdquo;.
              </div>
            ) : (
              <>
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="billing-roster-heading"
                  className="billing-table-wrapper"
                >
                  <table className="billing-bordered-table billing-roster-table">
                    <caption className="visually-hidden">
                      Active team members billed on workspace plan for {company?.name || 'workspace'}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="billing-col-index">#</th>
                        <th scope="col">Member</th>
                        <th scope="col">Role</th>
                        <th scope="col" className="billing-col-action">Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMembers.map((member, idx) => (
                        <tr key={member.id}>
                          <td className="billing-col-index">{pageStart + idx + 1}</td>

                          <td>
                            <div className="billing-member-cell">
                              <span className="billing-member-name">{member.name}</span>
                              <span className="billing-member-email">{member.email}</span>
                            </div>
                          </td>

                          <td>
                            <span className={`billing-role-text ${member.role === 'admin' ? 'is-admin' : ''}`}>
                              {member.role === 'admin' ? 'Admin' : 'Member'}
                            </span>
                          </td>

                          <td className="billing-col-action">
                            <span className="billing-added-date">
                              {member.created_at
                                ? new Date(member.created_at).toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric'
                                })
                                : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="billing-pagination-bar">
                    <span className="billing-pagination-meta">
                      Showing {pageStart + 1}–{pageStart + visibleMembers.length} of {filteredMembers.length} users
                    </span>

                    <nav className="billing-pagination-controls" aria-label="Team roster pagination">
                      <button
                        type="button"
                        className="billing-page-btn"
                        onClick={() => setRosterPage(Math.max(1, safePage - 1))}
                        disabled={safePage <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={14} aria-hidden="true" />
                      </button>

                      {paginationItems.map((item) =>
                        typeof item === 'number' ? (
                          <button
                            key={item}
                            type="button"
                            className={`billing-page-btn ${item === safePage ? 'active' : ''}`}
                            onClick={() => setRosterPage(item)}
                            aria-current={item === safePage ? 'page' : undefined}
                          >
                            {item}
                          </button>
                        ) : (
                          <span key={item} className="billing-page-ellipsis" aria-hidden="true">
                            …
                          </span>
                        )
                      )}

                      <button
                        type="button"
                        className="billing-page-btn"
                        onClick={() => setRosterPage(Math.min(totalPages, safePage + 1))}
                        disabled={safePage >= totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </nav>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Payment History Card & Bordered Table */}
        {isLoading ? (
          <div className="billing-overview-card" aria-busy="true" aria-label="Loading payment history">
            <div className="billing-card-header-row">
              <div className="billing-card-title-group">
                <Skeleton width="18px" height="18px" borderRadius="4px" />
                <Skeleton width="188px" height="18px" borderRadius="4px" />
              </div>
              <Skeleton width="92px" height="24px" borderRadius="8px" />
            </div>
            <div className="billing-table-wrapper">
              <table className="billing-bordered-table billing-tx-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="billing-col-num">Users</th>
                    <th scope="col" className="billing-col-num">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Order / Payment ID</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3].map((row) => (
                    <tr key={row}>
                      <td><Skeleton width="76px" height="13px" borderRadius="4px" /></td>
                      <td><Skeleton width="108px" height="13px" borderRadius="4px" /></td>
                      <td className="billing-col-num"><Skeleton width="22px" height="13px" borderRadius="4px" /></td>
                      <td className="billing-col-num"><Skeleton width="62px" height="14px" borderRadius="4px" /></td>
                      <td><Skeleton width="46px" height="20px" borderRadius="6px" /></td>
                      <td><Skeleton width="138px" height="13px" borderRadius="4px" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <section className="billing-overview-card fade-in-card" aria-labelledby="billing-ledger-heading">
            <div className="billing-card-header-row">
              <div className="billing-card-title-group">
                <Receipt size={18} strokeWidth={1.5} className="billing-card-icon" aria-hidden="true" />
                <h2 id="billing-ledger-heading" className="billing-card-title">Payment &amp; Billing History</h2>
              </div>
              <span className="billing-overview-badge">
                {transactions.length} {transactions.length === 1 ? 'payment' : 'payments'}
              </span>
            </div>

            {transactions.length === 0 ? (
              <div className="billing-empty-state">
                <Receipt size={28} strokeWidth={1.5} className="billing-card-icon" aria-hidden="true" />
                <h3>No Razorpay transactions yet</h3>
                <p>Completed plan activations and monthly renewals will appear here.</p>
              </div>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="billing-ledger-heading"
                className="billing-table-wrapper"
              >
                <table className="billing-bordered-table billing-tx-table">
                  <caption className="visually-hidden">
                    Payment and renewal history for {company?.name || 'workspace'}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="billing-col-num">Users</th>
                      <th scope="col" className="billing-col-num">Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col">Order / Payment ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{new Date(tx.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td style={{ textTransform: 'capitalize' }}>
                          {tx.transaction_type === 'initial_activation'
                            ? 'Plan Activation'
                            : tx.transaction_type === 'seat_addon'
                              ? 'User Add-On'
                              : 'Monthly Renewal'}
                        </td>
                        <td className="billing-col-num">{tx.seats_delta}</td>
                        <td className="billing-col-num">
                          <strong>₹{Number(tx.amount_inr || 0).toLocaleString('en-IN')}</strong>
                        </td>
                        <td>
                          <span className={`billing-tx-status ${tx.status}`}>
                            {tx.status}
                          </span>
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
        )}

        {/* Team Feedback Details Modal */}
        {isSurveyModalOpen &&
          createPortal(
            <div
              className="billing-modal-backdrop"
              role="presentation"
              onClick={() => setIsSurveyModalOpen(false)}
            >
              <div
                className="billing-modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="billing-survey-modal-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="billing-modal-header">
                  <div>
                    <h3 id="billing-survey-modal-title" className="billing-modal-title">
                      Team Feedback Details
                    </h3>
                    <p className="billing-modal-subtitle">
                      {surveySummary.totalResponses} response{surveySummary.totalResponses === 1 ? '' : 's'} · 100% want to continue · Average rating {surveySummary.avgRating} / 5★
                    </p>
                  </div>
                  <button
                    type="button"
                    className="billing-modal-close-btn"
                    onClick={() => setIsSurveyModalOpen(false)}
                    aria-label="Close details"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="billing-modal-body">
                  <div className="billing-table-wrapper">
                    <table className="billing-bordered-table billing-survey-table">
                      <thead>
                        <tr>
                          <th scope="col">Member</th>
                          <th scope="col">Rating</th>
                          <th scope="col">Keep Using</th>
                        </tr>
                      </thead>
                      <tbody>
                        {surveySummary.responses.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="billing-member-cell">
                                <span className="billing-member-name">{item.memberName}</span>
                                <span className="billing-member-email">{item.memberEmail}</span>
                              </div>
                            </td>
                            <td>
                              <span className="billing-survey-row-rating">
                                <Star size={13} fill="currentColor" aria-hidden="true" />
                                <span>{item.experience_rating}/5</span>
                              </span>
                            </td>
                            <td>
                              <span className={`billing-survey-flag ${item.wants_to_continue ? 'yes' : 'no'}`}>
                                {item.wants_to_continue ? 'Yes' : 'No'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}
