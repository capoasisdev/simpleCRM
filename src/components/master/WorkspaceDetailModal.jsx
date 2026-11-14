import { useEffect, useState } from 'react';
import { X, Loader2, ExternalLink, KeyRound } from 'lucide-react';
import {
  fetchMasterCompanyDetail,
  impersonateCrmUser,
  recordMasterOfflinePayment,
  resetCrmUserPassword,
  storeSupportHandoff,
  updateMasterCompanyBilling,
} from '../../lib/masterAdmin';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getWorkspaceStatusInfo(company) {
  if (!company) return { label: '—', tone: 'trialing' };
  if (company.is_billing_exempt) {
    return { label: 'Enterprise Exempt', tone: 'exempt' };
  }
  const status = String(company.subscription_status || 'trialing').toLowerCase();
  const now = Date.now();
  const trialEndMs = company.trial_ends_at ? new Date(company.trial_ends_at).getTime() : 0;
  const periodEndMs = company.current_period_end
    ? new Date(company.current_period_end).getTime()
    : 0;

  if (status === 'active') {
    if (periodEndMs && periodEndMs + 3 * 24 * 60 * 60 * 1000 <= now) {
      return { label: 'Renewal Overdue', tone: 'expired' };
    }
    if (periodEndMs && periodEndMs <= now) {
      return { label: 'Renewal Grace (3d)', tone: 'trialing' };
    }
    return { label: 'Active Monthly', tone: 'active' };
  }
  if (status === 'trialing' || status === 'pilot_extended') {
    if (trialEndMs && trialEndMs <= now) {
      return { label: 'Trial Ended (Day 15+)', tone: 'expired' };
    }
    const days = trialEndMs
      ? Math.max(1, Math.ceil((trialEndMs - now) / (24 * 60 * 60 * 1000)))
      : 14;
    return {
      label: `${status === 'pilot_extended' ? 'Extended Pilot' : 'Trial'} · ${days}d left`,
      tone: 'trialing',
    };
  }
  if (status === 'past_due') return { label: 'Past Due', tone: 'expired' };
  return { label: 'Expired', tone: 'expired' };
}

export { getWorkspaceStatusInfo };

export default function WorkspaceDetailModal({
  token,
  companySummary,
  onClose,
  onUpdated,
}) {
  const [activeTab, setActiveTab] = useState('controls');
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [priceInput, setPriceInput] = useState(
    String(companySummary?.price_per_seat_inr || 999)
  );
  const [offlineAmount, setOfflineAmount] = useState('');
  const [offlineMethod, setOfflineMethod] = useState('UPI');
  const [offlineRef, setOfflineRef] = useState('');
  const [offlineDays, setOfflineDays] = useState('30');

  const [resetResult, setResetResult] = useState(null);
  const [activeUserActionId, setActiveUserActionId] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const loadDetail = async () => {
    if (!companySummary?.id) return;
    setIsLoading(true);
    const res = await fetchMasterCompanyDetail(token, companySummary.id);
    if (res?.success && res.company) {
      setDetail(res);
      const unitPrice = Number(res.company.price_per_seat_inr || 999);
      const userCount = Math.max(1, (res.users || []).length || 1);
      setPriceInput(String(unitPrice));
      setOfflineAmount(String(unitPrice * userCount));
    } else {
      setFeedback({ type: 'error', text: res?.error || 'Could not load workspace.' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadDetail();
  }, [companySummary?.id]);

  const company = detail?.company || companySummary;
  const users = detail?.users || [];
  const transactions = detail?.transactions || [];
  const surveys = detail?.surveys || [];
  const adoption = detail?.adoption || null;
  const statusInfo = getWorkspaceStatusInfo(company);

  const applyPreset = async (preset, extra = {}) => {
    if (!company?.id) return;
    setFeedback({ type: '', text: '' });
    setIsApplying(true);
    const res = await updateMasterCompanyBilling(token, company.id, preset, extra);
    setIsApplying(false);

    if (!res?.success || !res.company) {
      setFeedback({ type: 'error', text: res?.error || 'Action failed.' });
      return;
    }

    setDetail((prev) => (prev ? { ...prev, company: res.company } : prev));
    setPriceInput(String(res.company.price_per_seat_inr || 999));
    setFeedback({ type: 'success', text: 'Workspace billing state updated.' });
    if (onUpdated) onUpdated(res.company);
  };

  const handleRecordOfflinePayment = async (e) => {
    e.preventDefault();
    if (!company?.id) return;
    setFeedback({ type: '', text: '' });
    const amount = Number(offlineAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ type: 'error', text: 'Enter a valid amount in ₹.' });
      return;
    }

    setIsApplying(true);
    const res = await recordMasterOfflinePayment(token, company.id, {
      amountInr: amount,
      usersCount: Math.max(1, users.length || 1),
      method: offlineMethod,
      reference: offlineRef.trim(),
      days: Math.max(1, Number(offlineDays || 30)),
    });
    setIsApplying(false);

    if (!res?.success) {
      setFeedback({ type: 'error', text: res?.error || 'Could not record payment.' });
      return;
    }

    setOfflineRef('');
    setFeedback({ type: 'success', text: 'Direct payment recorded and workspace activated.' });
    await loadDetail();
    if (onUpdated) onUpdated(res.company);
  };

  const handleResetUserPassword = async (crmUser) => {
    if (!company?.id || !crmUser?.id) return;
    setFeedback({ type: '', text: '' });
    setResetResult(null);
    setActiveUserActionId(crmUser.id);
    const res = await resetCrmUserPassword(token, company.id, crmUser.id);
    setActiveUserActionId('');

    if (!res?.success) {
      setFeedback({ type: 'error', text: res?.error || 'Could not reset password.' });
      return;
    }

    setResetResult({ email: res.email, tempPassword: res.tempPassword });
  };

  const handleOpenSupportSession = async (crmUser) => {
    if (!company?.id || !crmUser?.id) return;
    setFeedback({ type: '', text: '' });
    setActiveUserActionId(crmUser.id);
    const res = await impersonateCrmUser(token, company.id, crmUser.id);
    setActiveUserActionId('');

    if (!res?.success || !res?.session?.access_token) {
      setFeedback({ type: 'error', text: res?.error || 'Could not start support session.' });
      return;
    }

    storeSupportHandoff({
      user: res.user,
      company: res.company,
      session: res.session,
    });
    window.open('/dashboard?support=1', '_blank', 'noopener');
    setFeedback({
      type: 'success',
      text: `Opened CRM support session as ${crmUser.email} in a new tab.`,
    });
  };

  return (
    <div className="billing-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="billing-modal-card master-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="master-ws-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-modal-header">
          <div>
            <h3 id="master-ws-modal-title" className="billing-modal-title">
              {company?.name || 'Workspace'}
            </h3>
            <p className="billing-modal-subtitle">
              {company?.owner_email || company?.slug || '—'} · {statusInfo.label}
            </p>
          </div>
          <button
            type="button"
            className="billing-modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="master-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'controls'}
            className={`master-modal-tab ${activeTab === 'controls' ? 'active' : ''}`}
            onClick={() => setActiveTab('controls')}
          >
            Lifecycle &amp; Billing
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'users'}
            className={`master-modal-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users ({users.length || companySummary?.active_users_count || 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'payments'}
            className={`master-modal-tab ${activeTab === 'payments' ? 'active' : ''}`}
            onClick={() => setActiveTab('payments')}
          >
            Payments ({transactions.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'surveys'}
            className={`master-modal-tab ${activeTab === 'surveys' ? 'active' : ''}`}
            onClick={() => setActiveTab('surveys')}
          >
            Feedback Survey ({surveys.length})
          </button>
        </div>

        <div className="billing-modal-body">
          {feedback.text && (
            <div className={`billing-alert-box ${feedback.type === 'error' ? 'error' : 'success'}`}>
              <span>{feedback.text}</span>
            </div>
          )}

          {isLoading ? (
            <div className="master-loading-box">
              <Loader2 size={20} className="animate-spin" />
              <span>Loading workspace details...</span>
            </div>
          ) : activeTab === 'controls' ? (
            <>
              <div className="billing-tiles-row">
                <div className="billing-tile">
                  <span className="billing-tile-val">{users.length}</span>
                  <span className="billing-tile-lbl">Active Users</span>
                </div>
                <div className="billing-tile">
                  <span className="billing-tile-val">
                    ₹{Number(company?.price_per_seat_inr || 999).toLocaleString('en-IN')}
                  </span>
                  <span className="billing-tile-lbl">Rate / User / mo</span>
                </div>
                <div className="billing-tile">
                  <span className="billing-tile-val" style={{ fontSize: '18px' }}>
                    {company?.current_period_end
                      ? formatDate(company.current_period_end)
                      : formatDate(company?.trial_ends_at)}
                  </span>
                  <span className="billing-tile-lbl">
                    {company?.current_period_end ? 'Current Period End' : 'Trial Ends'}
                  </span>
                </div>
              </div>

              {adoption && (
                <div className="master-section-block">
                  <span className="master-section-label">Workspace Adoption</span>
                  <div className="master-adoption-row">
                    <span className={`master-adoption-item ${adoption.leadsCount > 0 ? 'on' : ''}`}>
                      <span className="master-adoption-dot" />
                      <span>{adoption.leadsCount} Leads</span>
                    </span>
                    <span className={`master-adoption-item ${adoption.formsCount > 0 ? 'on' : ''}`}>
                      <span className="master-adoption-dot" />
                      <span>{adoption.formsCount} Active Forms</span>
                    </span>
                    <span className={`master-adoption-item ${adoption.whatsappConnected ? 'on' : ''}`}>
                      <span className="master-adoption-dot" />
                      <span>
                        WhatsApp {adoption.whatsappConnected ? 'Connected' : 'Not Connected'}
                      </span>
                    </span>
                    <span className={`master-adoption-item ${adoption.metaConnected ? 'on' : ''}`}>
                      <span className="master-adoption-dot" />
                      <span>Meta {adoption.metaConnected ? 'Connected' : 'Not Connected'}</span>
                    </span>
                    <span className={`master-adoption-item ${adoption.emailConnected ? 'on' : ''}`}>
                      <span className="master-adoption-dot" />
                      <span>Email {adoption.emailConnected ? 'Connected' : 'Not Connected'}</span>
                    </span>
                    <span className={`master-adoption-item ${adoption.autopilotCount > 0 ? 'on' : ''}`}>
                      <span className="master-adoption-dot" />
                      <span>{adoption.autopilotCount} Autopilot</span>
                    </span>
                  </div>
                </div>
              )}

              <div className="master-divider" />

              <div className="master-section-block">
                <span className="master-section-label">1-Click Billing &amp; Trial Overrides</span>
                <div className="master-preset-grid">
                  <button
                    type="button"
                    className="master-preset-btn"
                    disabled={isApplying}
                    onClick={() => applyPreset('trial_14d', { days: 14 })}
                  >
                    Set 14-Day Trial
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn danger"
                    disabled={isApplying}
                    onClick={() => applyPreset('expire_trial')}
                  >
                    Expire Trial (Day 15)
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn"
                    disabled={isApplying}
                    onClick={() => applyPreset('extend_pilot', { days: 7 })}
                  >
                    Extend Pilot (+7 days)
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn"
                    disabled={isApplying}
                    onClick={() => applyPreset('extend_pilot', { days: 14 })}
                  >
                    Extend Pilot (+14 days)
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn"
                    disabled={isApplying}
                    onClick={() => applyPreset('active_30d', { days: 30 })}
                  >
                    Set Active Paid (+30d)
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn"
                    disabled={isApplying}
                    onClick={() => applyPreset('renewal_grace')}
                  >
                    Simulate 3-Day Grace
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn danger"
                    disabled={isApplying}
                    onClick={() => applyPreset('past_due')}
                  >
                    Mark Past Due
                  </button>
                  <button
                    type="button"
                    className="master-preset-btn"
                    disabled={isApplying}
                    onClick={() =>
                      applyPreset('toggle_exempt', {
                        isExempt: !Boolean(company?.is_billing_exempt),
                      })
                    }
                  >
                    {company?.is_billing_exempt
                      ? 'Disable Billing Exempt'
                      : 'Enable Billing Exempt'}
                  </button>
                </div>
              </div>

              <div className="master-section-block">
                <span className="master-section-label">Custom Rate per User (INR / mo)</span>
                <div className="master-price-row">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="master-inline-input"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    disabled={isApplying}
                    style={{ width: '160px' }}
                  />
                  <button
                    type="button"
                    className="billing-header-cta-btn"
                    disabled={isApplying}
                    onClick={() =>
                      applyPreset('set_price', { pricePerSeatInr: Number(priceInput) || 999 })
                    }
                  >
                    Save Rate
                  </button>
                </div>
              </div>

              <div className="master-divider" />

              <form onSubmit={handleRecordOfflinePayment} className="master-section-block">
                <span className="master-section-label">
                  Record Direct / Offline Payment &amp; Activate
                </span>
                <div className="master-price-row">
                  <input
                    type="number"
                    min="1"
                    className="master-inline-input"
                    placeholder="Amount ₹"
                    value={offlineAmount}
                    onChange={(e) => setOfflineAmount(e.target.value)}
                    disabled={isApplying}
                    style={{ width: '120px' }}
                  />
                  <select
                    className="master-select"
                    value={offlineMethod}
                    onChange={(e) => setOfflineMethod(e.target.value)}
                    disabled={isApplying}
                  >
                    <option value="UPI">UPI</option>
                    <option value="NEFT">NEFT / IMPS</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                  </select>
                  <input
                    type="text"
                    className="master-inline-input"
                    placeholder="UTR / Reference note"
                    value={offlineRef}
                    onChange={(e) => setOfflineRef(e.target.value)}
                    disabled={isApplying}
                    style={{ flex: 1, minWidth: '150px' }}
                  />
                  <input
                    type="number"
                    min="1"
                    max="365"
                    className="master-inline-input"
                    placeholder="Days"
                    value={offlineDays}
                    onChange={(e) => setOfflineDays(e.target.value)}
                    disabled={isApplying}
                    style={{ width: '80px' }}
                    title="Cycle duration in days"
                  />
                  <button
                    type="submit"
                    className="billing-header-cta-btn"
                    disabled={isApplying}
                  >
                    Record Paid
                  </button>
                </div>
              </form>
            </>
          ) : activeTab === 'users' ? (
            <>
              {resetResult && (
                <div className="master-temp-box">
                  <strong>Temporary password set for {resetResult.email}</strong>
                  <span>Password: {resetResult.tempPassword} (user will be prompted to change it on login)</span>
                </div>
              )}

              {users.length === 0 ? (
                <div className="billing-empty-state">
                  <h3>No users yet</h3>
                </div>
              ) : (
                <div className="billing-table-wrapper">
                  <table className="billing-bordered-table">
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Email</th>
                        <th scope="col">Role</th>
                        <th scope="col">Joined</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Support Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const busy = activeUserActionId === u.id;
                        return (
                          <tr key={u.id}>
                            <td><strong>{u.name}</strong></td>
                            <td>{u.email}</td>
                            <td>
                              <span className={`billing-role-text ${u.role === 'admin' ? 'is-admin' : ''}`}>
                                {u.role === 'admin' ? 'Admin' : 'Member'}
                              </span>
                            </td>
                            <td>{formatDate(u.created_at)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div className="master-action-stack">
                                <button
                                  type="button"
                                  className="master-manage-btn"
                                  disabled={busy}
                                  onClick={() => handleResetUserPassword(u)}
                                  title="Generate temporary password"
                                >
                                  <KeyRound size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: '-1px' }} />
                                  Reset Pwd
                                </button>
                                <button
                                  type="button"
                                  className="master-manage-btn"
                                  disabled={busy}
                                  onClick={() => handleOpenSupportSession(u)}
                                  title="Open CRM workspace as this user in a new tab"
                                >
                                  <ExternalLink size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: '-1px' }} />
                                  Open CRM
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
            </>
          ) : activeTab === 'payments' ? (
            transactions.length === 0 ? (
              <div className="billing-empty-state">
                <h3>No billing transactions</h3>
              </div>
            ) : (
              <div className="billing-table-wrapper">
                <table className="billing-bordered-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="billing-col-num">Users</th>
                      <th scope="col" className="billing-col-num">Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{formatDate(tx.created_at)}</td>
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
            )
          ) : activeTab === 'surveys' ? (
            <div className="master-surveys-wrap">
              {surveys.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                  <button
                    type="button"
                    className="master-preset-btn danger"
                    style={{ fontSize: '12px', padding: '5px 12px' }}
                    disabled={isApplying}
                    onClick={async () => {
                      await applyPreset('reset_feedback');
                      await loadDetail();
                    }}
                  >
                    Reset Survey Responses
                  </button>
                </div>
              )}
              {surveys.length === 0 ? (
                <div className="billing-empty-state">
                  <h3>No survey responses submitted</h3>
                </div>
              ) : (
                <div className="master-survey-list">
                  {surveys.map((item) => (
                    <div key={item.id} className="master-survey-item">
                      <div className="master-survey-item-top">
                        <div>
                          <strong>{item.user_name || 'Team Member'}</strong>
                          <span className="master-survey-email"> · {item.user_email}</span>
                        </div>
                        <span className="master-survey-rating">{item.rating}/5 ★</span>
                      </div>
                      <div className="master-survey-answers">
                        <span>Wants to continue: <strong>{item.wants_to_continue ? 'Yes' : 'No'}</strong></span>
                      </div>

                      {Array.isArray(item.favorite_features) && item.favorite_features.length > 0 && (
                        <div className="master-survey-pill-group">
                          <span style={{ fontSize: 11, color: '#737373' }}>Used:</span>
                          {item.favorite_features.map((feat) => (
                            <span key={feat} className="master-survey-pill feature">{feat}</span>
                          ))}
                        </div>
                      )}

                      {Array.isArray(item.pain_points) && item.pain_points.length > 0 && (
                        <div className="master-survey-pill-group">
                          <span style={{ fontSize: 11, color: '#737373' }}>Friction:</span>
                          {item.pain_points.map((pain) => (
                            <span key={pain} className="master-survey-pill pain">{pain}</span>
                          ))}
                        </div>
                      )}

                      {item.missing_features && (
                        <div className="master-survey-quote">
                          <strong>Build Next:</strong> “{item.missing_features}”
                        </div>
                      )}

                      {(item.feedback_notes || item.feedback_note) && (
                        <div className="master-survey-quote">
                          <strong>Feedback / Bugs:</strong> “{item.feedback_notes || item.feedback_note}”
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
