import { supabase } from './supabase.js';
import { setActiveCompanyCache } from './tenant.js';

let razorpayScriptPromise = null;

/**
 * Unwraps Supabase Edge Function JSON responses cleanly, even on 4xx/5xx HTTP status codes.
 */
export async function parseEdgeFunctionResult(data, error) {
  if (!error) {
    return data || { success: true };
  }
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const errBody = await error.context.json().catch(() => null);
      if (errBody && typeof errBody === 'object') {
        return { success: false, ...errBody };
      }
    }
  } catch {
    // ignore response body parse errors
  }
  return {
    success: false,
    error: error?.message || 'Service request failed. Please try again.'
  };
}

/**
 * Returns true when a non-exempt company's trialing or extended-pilot window has elapsed.
 */
export function isCompanyTrialExpired(company) {
  if (!company || company.is_billing_exempt) return false;
  const status = String(company.subscription_status || '').toLowerCase();
  if (status !== 'trialing' && status !== 'pilot_extended') return false;
  if (!company.trial_ends_at) return false;
  const endsMs = new Date(company.trial_ends_at).getTime();
  return Number.isFinite(endsMs) && endsMs <= Date.now();
}

/**
 * Returns true when the workspace must be gated at the Day-15 / Plan Expired Razorpay paywall.
 */
export function isCompanyAccessLocked(company) {
  if (!company || company.is_billing_exempt) return false;
  const status = String(company.subscription_status || '').toLowerCase();
  if (['expired', 'past_due', 'cancelled'].includes(status)) return true;
  return isCompanyTrialExpired(company);
}

/**
 * Returns whole days remaining in trial (0 once expired or inactive).
 */
export function getTrialDaysRemaining(company) {
  if (!company || company.is_billing_exempt || !company.trial_ends_at) return 0;
  const endsMs = new Date(company.trial_ends_at).getTime();
  if (!Number.isFinite(endsMs)) return 0;
  const diffMs = endsMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Dynamically loads Razorpay's hosted checkout script once when needed.
 */
export function loadRazorpayCheckoutScript() {
  if (typeof window !== 'undefined' && window.Razorpay) {
    return Promise.resolve(true);
  }
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      razorpayScriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

/**
 * Fetches live company metadata, active member seat count, and recent billing ledger rows.
 */
export async function fetchCompanyBillingSnapshot(companyId) {
  if (!companyId) return { company: null, activeUsersCount: 0, transactions: [] };

  const [companyRes, countRes, txRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone')
      .eq('id', companyId)
      .maybeSingle(),
    supabase
      .from('crm_users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    supabase
      .from('billing_transactions')
      .select('id, transaction_type, seats_delta, amount_inr, unit_price_inr, currency, razorpay_order_id, razorpay_payment_id, status, metadata, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  const company = !companyRes.error && companyRes.data ? companyRes.data : null;
  if (company) {
    setActiveCompanyCache(company);
  }

  return {
    company,
    activeUsersCount: Number(countRes.count || 0),
    transactions: !txRes.error && Array.isArray(txRes.data) ? txRes.data : []
  };
}

/**
 * Creates a server-computed Razorpay Order via Edge Function.
 */
export async function createRazorpayOrder({ transactionType, seatsRequested, billingName, gstin }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { success: false, error: 'Please sign in again to continue billing.' };
  }

  const { data, error } = await supabase.functions.invoke('razorpay-create-order', {
    headers: { Authorization: `Bearer ${token}` },
    body: { transactionType, seatsRequested, billingName, gstin }
  });

  return parseEdgeFunctionResult(data, error);
}

/**
 * Verifies a completed Razorpay Checkout signature on the server and unlocks/updates company state.
 */
export async function verifyRazorpayPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { success: false, error: 'Please sign in again to verify payment.' };
  }

  const { data, error } = await supabase.functions.invoke('razorpay-verify', {
    headers: { Authorization: `Bearer ${token}` },
    body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
  });

  const result = await parseEdgeFunctionResult(data, error);
  if (result.success && result.company) {
    setActiveCompanyCache(result.company);
  }
  return result;
}

/**
 * Launches the end-to-end Razorpay Checkout flow (server order -> modal -> server HMAC verify).
 */
export async function launchRazorpayCheckout({
  transactionType,
  seatsRequested,
  billingName,
  gstin,
  description,
  onSuccess,
  onError,
  onDismiss
}) {
  const orderRes = await createRazorpayOrder({
    transactionType,
    seatsRequested,
    billingName,
    gstin
  });

  if (!orderRes.success) {
    if (onError) onError(orderRes);
    return orderRes;
  }

  const loaded = await loadRazorpayCheckoutScript();
  if (!loaded || typeof window === 'undefined' || !window.Razorpay) {
    const errRes = {
      success: false,
      error: 'Could not load Razorpay checkout script. Please check your internet connection and retry.'
    };
    if (onError) onError(errRes);
    return errRes;
  }

  const rzp = new window.Razorpay({
    key: orderRes.keyId,
    amount: orderRes.amountPaise,
    currency: orderRes.currency || 'INR',
    name: 'simplecrm',
    description: description || `${orderRes.companyName} · Seat Subscription`,
    order_id: orderRes.orderId,
    prefill: {
      name: billingName || orderRes.prefill?.name || '',
      email: orderRes.prefill?.email || ''
    },
    notes: {
      company_name: orderRes.companyName || '',
      transaction_type: transactionType
    },
    theme: {
      color: '#18181b'
    },
    modal: {
      ondismiss: () => {
        if (onDismiss) onDismiss();
      }
    },
    handler: async (response) => {
      const verifyRes = await verifyRazorpayPayment({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      });
      if (verifyRes.success) {
        if (onSuccess) onSuccess(verifyRes);
      } else if (onError) {
        onError(verifyRes);
      }
    }
  });

  rzp.on('payment.failed', (failure) => {
    if (onError) {
      onError({
        success: false,
        error: failure?.error?.description || 'Payment failed inside Razorpay checkout.'
      });
    }
  });

  rzp.open();
  return { success: true, orderId: orderRes.orderId };
}

