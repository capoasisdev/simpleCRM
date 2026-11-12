import { useState, useEffect } from 'react';
import {
  CreditCard,
  Users,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  Clock,
  PlusCircle
} from 'lucide-react';
import { getActiveCompany, getActiveCompanyId, setActiveCompanyCache } from '../../lib/tenant';
import {
  fetchCompanyBillingSnapshot,
  getTrialDaysRemaining,
  launchRazorpayCheckout
} from '../../lib/billing';
import Skeleton from '../common/Skeleton';
import '../../styles/billing.css';

export default function BillingSeatsView({ currentUser, onCompanyUpdated }) {
  const activeCompanyId = getActiveCompanyId() || currentUser?.company_id;
  const [company, setCompany] = useState(() => getActiveCompany());
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [seatsToAdd, setSeatsToAdd] = useState(1);
  const [isPaying, setIsPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadSnapshot = async () => {
    if (!activeCompanyId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const snap = await fetchCompanyBillingSnapshot(activeCompanyId);
      if (snap.company) {
        setCompany(snap.company);
        setActiveCompanyCache(snap.company);
        if (onCompanyUpdated) onCompanyUpdated(snap.company);
      }
      setActiveUsersCount(snap.activeUsersCount);
      setTransactions(snap.transactions);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, [activeCompanyId]);

  const isExempt = Boolean(company?.is_billing_exempt);
  const seatLimit = Math.max(1, Number(company?.seat_limit || 5));
  const unitPriceInr = Math.max(1, Number(company?.price_per_seat_inr || 999));
  const utilizationPct = Math.min(100, Math.round((activeUsersCount / seatLimit) * 100));
  const atLimit = activeUsersCount >= seatLimit;
  const daysLeft = getTrialDaysRemaining(company);

  const safeAddedSeats = Math.max(1, Math.min(200, Math.round(Number(seatsToAdd) || 1)));
  const addonAmountInr = safeAddedSeats * unitPriceInr;

  const handleBuySeats = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsPaying(true);

    await launchRazorpayCheckout({
      transactionType: 'seat_addon',
      seatsRequested: safeAddedSeats,
      description: `${company?.name || 'simplecrm'} · Add ${safeAddedSeats} Seat${safeAddedSeats > 1 ? 's' : ''}`,
      onSuccess: async (res) => {
        setIsPaying(false);
        if (res.company) {
          setCompany(res.company);
          setActiveCompanyCache(res.company);
          if (onCompanyUpdated) onCompanyUpdated(res.company);
        }
        setSuccessMsg(`Added ${safeAddedSeats} new seat${safeAddedSeats > 1 ? 's' : ''} to your workspace.`);
        await loadSnapshot();
      },
      onError: (err) => {
        setIsPaying(false);
        setErrorMsg(err?.error || 'Could not process Razorpay seat purchase.');
      },
      onDismiss: () => {
        setIsPaying(false);
      }
    });
  };

  const handleActivateNow = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsPaying(true);

    const seatsToActivate = Math.max(activeUsersCount, seatLimit);
    await launchRazorpayCheckout({
      transactionType: 'initial_activation',
      seatsRequested: seatsToActivate,
      description: `${company?.name || 'simplecrm'} · Activate ${seatsToActivate} Seats Monthly`,
      onSuccess: async (res) => {
        setIsPaying(false);
        if (res.company) {
          setCompany(res.company);
          setActiveCompanyCache(res.company);
          if (onCompanyUpdated) onCompanyUpdated(res.company);
        }
        setSuccessMsg('Workspace subscription is now active!');
        await loadSnapshot();
      },
      onError: (err) => {
        setIsPaying(false);
        setErrorMsg(err?.error || 'Could not initialize plan activation.');
      },
      onDismiss: () => {
        setIsPaying(false);
      }
    });
  };

  const renderPlanStatusPill = () => {
    if (isExempt) {
      return (
        <span className="billing-status-pill active">
          <ShieldCheck size={13} />
          <span>Enterprise Exempt · Active</span>
        </span>
      );
    }
    const status = String(company?.subscription_status || 'trialing');
    if (status === 'active') {
      return (
        <span className="billing-status-pill active">
          <CheckCircle2 size={13} />
          <span>Active Monthly</span>
        </span>
      );
    }
    if (status === 'trialing' || status === 'pilot_extended') {
      return (
        <span className="billing-status-pill trialing">
          <Clock size={13} />
          <span>
            {status === 'pilot_extended' ? 'Extended Pilot' : '14-Day Trial'} ({daysLeft}d left)
          </span>
        </span>
      );
    }
    return (
      <span className="billing-status-pill expired">
        <span>{status.replace('_', ' ').toUpperCase()}</span>
      </span>
    );
  };

  return (
    <div className="admin-view-container">
      <div className="admin-view-inner">
        <div className="admin-master-header">
          <div className="admin-master-title-group">
            <h1 className="admin-master-title">Seats &amp; Billing</h1>
            {!isLoading && renderPlanStatusPill()}
          </div>
        </div>

        {successMsg && (
          <div className="billing-info-banner" style={{ borderColor: '#a7f3d0', background: '#ecfdf5', color: '#065f46', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="billing-alert-banner" role="alert">
            {errorMsg}
          </div>
        )}

        {isLoading ? (
          <div className="billing-cards-grid">
            <div className="billing-panel-card">
              <Skeleton width="160px" height="18px" />
              <Skeleton width="100%" height="12px" />
              <Skeleton width="70%" height="14px" />
            </div>
            <div className="billing-panel-card">
              <Skeleton width="160px" height="18px" />
              <Skeleton width="100%" height="36px" />
              <Skeleton width="100%" height="42px" />
            </div>
          </div>
        ) : (
          <div className="billing-cards-grid">
            {/* Card 1: Seat Utilization & Plan Details */}
            <div className="billing-panel-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                  <Users size={17} />
                  <span>Workspace Seat Capacity</span>
                </div>
                <span className={`billing-seat-pill ${atLimit ? 'at-limit' : ''}`}>
                  {activeUsersCount} / {seatLimit} seats
                </span>
              </div>

              <div className="billing-meter-track" aria-label="Seat utilization">
                <div
                  className={`billing-meter-fill ${atLimit ? 'full' : ''}`}
                  style={{ width: `${utilizationPct}%` }}
                />
              </div>

              <div className="billing-summary-row">
                <span>Workspace</span>
                <strong>{company?.name || 'simplecrm'}</strong>
              </div>
              <div className="billing-summary-row">
                <span>Rate per Seat</span>
                <strong>{isExempt ? 'Exempt' : `₹${unitPriceInr.toLocaleString('en-IN')} / mo`}</strong>
              </div>
              {company?.trial_ends_at && !isExempt && company?.subscription_status !== 'active' && (
                <div className="billing-summary-row">
                  <span>Trial Expires</span>
                  <strong>{new Date(company.trial_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                </div>
              )}
              {company?.current_period_end && company?.subscription_status === 'active' && !isExempt && (
                <div className="billing-summary-row">
                  <span>Current Cycle Ends</span>
                  <strong>{new Date(company.current_period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                </div>
              )}

              {!isExempt && (company?.subscription_status === 'trialing' || company?.subscription_status === 'pilot_extended') && (
                <button
                  type="button"
                  className="billing-secondary-btn"
                  style={{ width: '100%', marginTop: 4 }}
                  onClick={handleActivateNow}
                  disabled={isPaying}
                >
                  <CreditCard size={14} />
                  <span>Activate Paid Subscription Now ({Math.max(activeUsersCount, seatLimit)} seats)</span>
                </button>
              )}
            </div>

            {/* Card 2: Buy More Seats */}
            <div className="billing-panel-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                <PlusCircle size={17} />
                <span>{isExempt ? 'Founder Managed Plan' : 'Buy More Seats'}</span>
              </div>

              {isExempt ? (
                <div className="billing-info-banner">
                  <strong>{company?.name || 'saladO'}</strong> is configured on a founder-managed exempt plan ({seatLimit} seats provisioned, no Razorpay billing required).
                </div>
              ) : (
                <>
                  <div className="billing-stepper-row">
                    <div className="billing-quick-chips">
                      {[1, 3, 5, 10].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`billing-quick-chip ${safeAddedSeats === preset ? 'active' : ''}`}
                          onClick={() => setSeatsToAdd(preset)}
                          disabled={isPaying}
                        >
                          +{preset}
                        </button>
                      ))}
                    </div>

                    <div className="billing-stepper-controls">
                      <button
                        type="button"
                        className="billing-stepper-btn"
                        onClick={() => setSeatsToAdd(Math.max(1, safeAddedSeats - 1))}
                        disabled={safeAddedSeats <= 1 || isPaying}
                        aria-label="Decrease added seats"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={safeAddedSeats}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          setSeatsToAdd(Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 1);
                        }}
                        className="billing-stepper-input"
                        aria-label="Seats to add"
                      />
                      <button
                        type="button"
                        className="billing-stepper-btn"
                        onClick={() => setSeatsToAdd(Math.min(200, safeAddedSeats + 1))}
                        disabled={safeAddedSeats >= 200 || isPaying}
                        aria-label="Increase added seats"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="billing-summary-row">
                    <span>New Seat Limit After Upgrade</span>
                    <strong>{seatLimit + safeAddedSeats} seats</strong>
                  </div>
                  <div className="billing-summary-row">
                    <span>Add-on Total ({safeAddedSeats} × ₹{unitPriceInr.toLocaleString('en-IN')})</span>
                    <strong>₹{addonAmountInr.toLocaleString('en-IN')} / mo</strong>
                  </div>

                  <button
                    type="button"
                    className="billing-primary-btn"
                    onClick={handleBuySeats}
                    disabled={isPaying}
                  >
                    {isPaying ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        <span>Opening Razorpay...</span>
                      </>
                    ) : (
                      <>
                        <CreditCard size={15} />
                        <span>Pay ₹{addonAmountInr.toLocaleString('en-IN')} via Razorpay</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Billing Ledger Table */}
        <div className="billing-panel-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Payment &amp; Seat History</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>Scoped to {company?.name || 'workspace'}</span>
          </div>
          {transactions.length === 0 ? (
            <div style={{ padding: '24px 20px', fontSize: 13, color: '#64748b' }}>
              No Razorpay transactions recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="billing-tx-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Seats</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Order / Payment ID</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>{new Date(tx.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td style={{ textTransform: 'capitalize' }}>{String(tx.transaction_type || '').replace('_', ' ')}</td>
                      <td>{tx.seats_delta > 0 ? `+${tx.seats_delta}` : tx.seats_delta}</td>
                      <td><strong>₹{Number(tx.amount_inr || 0).toLocaleString('en-IN')}</strong></td>
                      <td>
                        <span className={`billing-status-pill ${tx.status === 'paid' ? 'active' : tx.status === 'failed' ? 'expired' : ''}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>
                        {tx.razorpay_payment_id || tx.razorpay_order_id || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

