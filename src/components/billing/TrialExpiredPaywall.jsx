import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CreditCard,
  LogOut,
  Users,
  RefreshCw,
  Loader2,
  Lock,
  CheckCircle2
} from 'lucide-react';
import {
  fetchCompanyBillingSnapshot,
  isCompanyAccessLocked,
  launchRazorpayCheckout
} from '../../lib/billing';
import { setActiveCompanyCache } from '../../lib/tenant';
import '../../styles/billing.css';

export default function TrialExpiredPaywall({ currentUser, company, onActivated, onLogout }) {
  const [liveCompany, setLiveCompany] = useState(company);
  const [activeUsersCount, setActiveUsersCount] = useState(1);
  const [seatsRequested, setSeatsRequested] = useState(Math.max(1, Number(company?.seat_limit || 5)));
  const [billingName, setBillingName] = useState(company?.name || '');
  const [gstin, setGstin] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const isAdmin = currentUser?.role === 'admin';
  const companyId = liveCompany?.id || company?.id || currentUser?.company_id;
  const unitPriceInr = Math.max(1, Number(liveCompany?.price_per_seat_inr || 999));
  const minSeats = Math.max(1, activeUsersCount);
  const clampedSeats = Math.max(minSeats, Number(seatsRequested) || minSeats);
  const totalInr = clampedSeats * unitPriceInr;

  const refreshStatus = async () => {
    if (!companyId) return;
    setIsRefreshing(true);
    setErrorMessage('');
    try {
      const snap = await fetchCompanyBillingSnapshot(companyId);
      if (snap.company) {
        setLiveCompany(snap.company);
        setActiveUsersCount(snap.activeUsersCount || 1);
        setSeatsRequested((prev) =>
          Math.max(snap.activeUsersCount || 1, Number(prev) || Number(snap.company.seat_limit || 5))
        );
        if (!isCompanyAccessLocked(snap.company) && onActivated) {
          onActivated(snap.company);
        }
      }
    } catch {
      // ignore transient network errors
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, [companyId]);

  const handleCheckout = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsPaying(true);

    await launchRazorpayCheckout({
      transactionType: 'initial_activation',
      seatsRequested: clampedSeats,
      billingName: billingName.trim() || liveCompany?.name,
      gstin: gstin.trim(),
      description: `${liveCompany?.name || 'simplecrm'} · ${clampedSeats} Seats Monthly`,
      onSuccess: (res) => {
        setIsPaying(false);
        const updated = res.company;
        if (updated) {
          setLiveCompany(updated);
          setActiveCompanyCache(updated);
          setSuccessMessage('Subscription activated! Unlocking your workspace...');
          setTimeout(() => {
            if (onActivated) onActivated(updated);
          }, 700);
        }
      },
      onError: (err) => {
        setIsPaying(false);
        setErrorMessage(err?.error || 'Could not complete checkout. Please try again.');
      },
      onDismiss: () => {
        setIsPaying(false);
      }
    });
  };

  const statusLabel =
    liveCompany?.subscription_status === 'past_due'
      ? 'Payment Past Due'
      : liveCompany?.subscription_status === 'cancelled'
      ? 'Plan Cancelled'
      : 'Trial Ended';

  return (
    <div className="billing-paywall-shell">
      <div className="billing-paywall-card" role="main" aria-label="Workspace Subscription Activation">
        <div className="billing-paywall-header">
          <div>
            <div className="billing-paywall-brand">simplecrm</div>
            <h1 className="billing-paywall-title">
              {isAdmin ? 'Activate your workspace plan' : 'Workspace trial has ended'}
            </h1>
            <p className="billing-paywall-subtitle">
              {liveCompany?.name ? `${liveCompany.name} · ` : ''}
              {isAdmin
                ? 'Choose your active sales team seats below to continue seamlessly with all CRM leads, pipelines, and automations intact.'
                : 'Your team workspace trial has expired. Please contact your workspace administrator to activate billing.'}
            </p>
          </div>
          <span className="billing-status-pill expired">
            <ShieldAlert size={13} />
            <span>{statusLabel}</span>
          </span>
        </div>

        <div className="billing-paywall-body">
          {successMessage && (
            <div className="billing-info-banner" style={{ borderColor: '#a7f3d0', background: '#ecfdf5', color: '#065f46', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="billing-alert-banner" role="alert">
              {errorMessage}
            </div>
          )}

          {isAdmin ? (
            <>
              <div className="billing-summary-box">
                <div className="billing-stepper-row">
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#09090b' }}>
                      Team Seats Required
                    </div>
                    <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
                      Minimum {minSeats} seat{minSeats > 1 ? 's' : ''} (currently active members)
                    </div>
                  </div>
                  <div className="billing-stepper-controls">
                    <button
                      type="button"
                      className="billing-stepper-btn"
                      onClick={() => setSeatsRequested(Math.max(minSeats, clampedSeats - 1))}
                      disabled={clampedSeats <= minSeats || isPaying}
                      aria-label="Decrease seats"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={minSeats}
                      max={500}
                      value={clampedSeats}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setSeatsRequested(Number.isFinite(val) ? Math.max(minSeats, Math.min(500, val)) : minSeats);
                      }}
                      className="billing-stepper-input"
                      aria-label="Number of seats"
                    />
                    <button
                      type="button"
                      className="billing-stepper-btn"
                      onClick={() => setSeatsRequested(Math.min(500, clampedSeats + 1))}
                      disabled={clampedSeats >= 500 || isPaying}
                      aria-label="Increase seats"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="billing-summary-row">
                  <span>Active Users in Workspace</span>
                  <strong>{activeUsersCount} user{activeUsersCount !== 1 ? 's' : ''}</strong>
                </div>
                <div className="billing-summary-row">
                  <span>Rate per Seat / Month</span>
                  <strong>₹{unitPriceInr.toLocaleString('en-IN')}</strong>
                </div>
                <div className="billing-summary-row billing-summary-total">
                  <span>Monthly Subscription Total</span>
                  <strong>₹{totalInr.toLocaleString('en-IN')} / mo</strong>
                </div>
              </div>

              <div className="billing-field-row">
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#3f3f46', marginBottom: 4 }}>
                    Company / Billing Name (Optional)
                  </label>
                  <input
                    type="text"
                    className="billing-input"
                    value={billingName}
                    onChange={(e) => setBillingName(e.target.value)}
                    placeholder="Acme Pvt Ltd"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#3f3f46', marginBottom: 4 }}>
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    className="billing-input"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="27ABCDE1234F1Z5"
                  />
                </div>
              </div>

              <button
                type="button"
                className="billing-primary-btn"
                onClick={handleCheckout}
                disabled={isPaying}
              >
                {isPaying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Preparing Razorpay Checkout...</span>
                  </>
                ) : (
                  <>
                    <CreditCard size={16} />
                    <span>Pay ₹{totalInr.toLocaleString('en-IN')} with Razorpay</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="billing-summary-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#09090b', fontWeight: 600, fontSize: 14 }}>
                <Lock size={16} />
                <span>Admin Action Required</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#52525b', lineHeight: 1.5 }}>
                All your CRM leads, deals, and conversation history remain safely preserved. Ask your workspace administrator
                {liveCompany?.owner_email ? ` (${liveCompany.owner_email})` : ''} to complete plan activation.
              </p>
              <div className="billing-summary-row">
                <span>Signed in as</span>
                <strong>{currentUser?.email}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="billing-paywall-footer">
          <button
            type="button"
            className="billing-secondary-btn"
            onClick={refreshStatus}
            disabled={isRefreshing}
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? 'Checking...' : 'Check Status'}</span>
          </button>

          <button
            type="button"
            className="billing-secondary-btn"
            onClick={onLogout}
          >
            <LogOut size={13} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

