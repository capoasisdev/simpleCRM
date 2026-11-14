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

export const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Returns true when the workspace must enter expired/conversion mode.
 */
export function isCompanyAccessLocked(company) {
  if (!company || company.is_billing_exempt) return false;
  const status = String(company.subscription_status || '').toLowerCase();
  if (['expired', 'past_due', 'cancelled'].includes(status)) return true;
  if (status === 'active' && company.current_period_end) {
    const endMs = new Date(company.current_period_end).getTime();
    if (Number.isFinite(endMs) && endMs + PAST_DUE_GRACE_MS <= Date.now()) {
      return true;
    }
  }
  return isCompanyTrialExpired(company);
}

/**
 * Returns true when an active paid subscription has passed current_period_end
 * and is currently within the 3-day renewal grace window.
 */
export function isWithinRenewalGrace(company) {
  if (!company || company.is_billing_exempt) return false;
  const status = String(company.subscription_status || '').toLowerCase();
  if (status !== 'active' || !company.current_period_end) return false;
  const endMs = new Date(company.current_period_end).getTime();
  if (!Number.isFinite(endMs)) return false;
  const now = Date.now();
  return endMs <= now && endMs + PAST_DUE_GRACE_MS > now;
}

/**
 * Returns whole days remaining in the current paid billing cycle.
 */
export function getBillingCycleDaysLeft(company) {
  if (!company || company.is_billing_exempt || !company.current_period_end) return 0;
  const endMs = new Date(company.current_period_end).getTime();
  if (!Number.isFinite(endMs)) return 0;
  const diffMs = endMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
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
      .select('id, name, slug, subscription_status, trial_starts_at, trial_ends_at, seat_limit, price_per_seat_inr, is_billing_exempt, current_period_start, current_period_end, owner_email, owner_phone, razorpay_subscription_id')
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
      .in('status', ['paid', 'failed', 'refunded'])
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
 * Supports both standard Order signatures and recurring Subscription signatures.
 */
export async function verifyRazorpayPayment({
  razorpay_order_id,
  razorpay_subscription_id,
  razorpay_payment_id,
  razorpay_signature
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { success: false, error: 'Please sign in again to verify payment.' };
  }

  const { data, error } = await supabase.functions.invoke('razorpay-verify', {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      razorpay_order_id,
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature
    }
  });

  const result = await parseEdgeFunctionResult(data, error);
  if (result.success && result.company) {
    setActiveCompanyCache(result.company);
  }
  return result;
}

/**
 * Synchronizes the company's active team member count with Razorpay Subscription quantity.
 */
export async function syncSubscriptionSeats(companyId) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { success: false, error: 'No active session' };

    const { data, error } = await supabase.functions.invoke('razorpay-sync-subscription', {
      headers: { Authorization: `Bearer ${token}` },
      body: { companyId }
    });

    return parseEdgeFunctionResult(data, error);
  } catch (err) {
    console.warn('Silent subscription seats sync warning:', err);
    return { success: false, error: err?.message };
  }
}

/**
 * Launches the end-to-end Razorpay Checkout flow (server order/subscription -> modal -> server HMAC verify).
 * Uses Razorpay Subscriptions (Autopay) when available, falling back gracefully to standard Orders.
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

  const isSubscription = Boolean(orderRes.subscriptionId);

  const rzpConfig = {
    key: orderRes.keyId,
    name: 'simplecrm',
    description: description || `${orderRes.companyName} · Seat Subscription`,
    prefill: {
      name: billingName || orderRes.prefill?.name || '',
      email: orderRes.prefill?.email || ''
    },
    notes: {
      company_name: orderRes.companyName || '',
      transaction_type: transactionType,
      subscription_id: orderRes.subscriptionId || ''
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
        razorpay_order_id: response.razorpay_order_id || orderRes.orderId,
        razorpay_subscription_id: response.razorpay_subscription_id || orderRes.subscriptionId,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      });
      if (verifyRes.success) {
        if (onSuccess) onSuccess(verifyRes);
      } else if (onError) {
        onError(verifyRes);
      }
    }
  };

  if (isSubscription) {
    rzpConfig.subscription_id = orderRes.subscriptionId;
  } else {
    rzpConfig.order_id = orderRes.orderId;
    rzpConfig.amount = orderRes.amountPaise;
    rzpConfig.currency = orderRes.currency || 'INR';
  }

  const rzp = new window.Razorpay(rzpConfig);

  rzp.on('payment.failed', (failure) => {
    if (onError) {
      onError({
        success: false,
        error: failure?.error?.description || 'Payment failed inside Razorpay checkout.'
      });
    }
  });

  rzp.open();
  return { success: true, orderId: orderRes.orderId, subscriptionId: orderRes.subscriptionId };
}

/**
 * Fetches the current user's submitted post-trial feedback row, if any.
 */
export async function fetchMyTrialFeedback(companyId, userId, cycleKey = 'trial') {
  if (!companyId || !userId) return null;
  const { data, error } = await supabase
    .from('trial_feedback_surveys')
    .select('id, company_id, user_id, cycle_key, helps_sales, keeps_organized, experience_rating, wants_to_continue, created_at')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('cycle_key', cycleKey)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/**
 * Submits a team member's post-trial feedback response (1 per user per cycle).
 * Stores comprehensive product insights for Master Admin while keeping tenant admin view focused.
 */
export async function submitTrialFeedback({
  companyId,
  userId,
  helpsSales,
  keepsOrganized,
  experienceRating,
  wantsToContinue,
  favoriteFeatures = [],
  painPoints = [],
  missingFeatures = '',
  feedbackNotes = '',
  answers = {},
  cycleKey = 'trial'
}) {
  if (!companyId || !userId) {
    return { success: false, error: 'Missing user or workspace context.' };
  }

  const rating = Math.max(1, Math.min(5, Math.round(Number(experienceRating) || 5)));
  const { data, error } = await supabase
    .from('trial_feedback_surveys')
    .insert([{
      company_id: companyId,
      user_id: userId,
      cycle_key: cycleKey,
      helps_sales: helpsSales !== undefined && helpsSales !== null ? Boolean(helpsSales) : true,
      keeps_organized: keepsOrganized !== undefined && keepsOrganized !== null ? Boolean(keepsOrganized) : true,
      experience_rating: rating,
      wants_to_continue: Boolean(wantsToContinue),
      favorite_features: Array.isArray(favoriteFeatures) ? favoriteFeatures : [],
      pain_points: Array.isArray(painPoints) ? painPoints : [],
      missing_features: String(missingFeatures || '').trim(),
      feedback_notes: String(feedbackNotes || '').trim(),
      answers: answers && typeof answers === 'object' ? answers : {}
    }])
    .select()
    .single();

  if (error) {
    if (String(error.code) === '23505') {
      const existing = await fetchMyTrialFeedback(companyId, userId, cycleKey);
      return { success: true, alreadySubmitted: true, data: existing };
    }
    return { success: false, error: error.message || 'Could not submit feedback.' };
  }

  return { success: true, data };
}

/**
 * Fetches aggregated + per-member trial feedback survey results for Workspace Admins / Billing Managers.
 * Strictly shields buyers by only exposing continuation intent ("Keep using: Yes / No") and response counts.
 * Raw criticisms, missing feature wishlists, and pain points are strictly reserved for Master Admin.
 */
export async function fetchCompanyTrialFeedbackSummary(companyId, cycleKey = 'trial') {
  if (!companyId) {
    return {
      responses: [],
      totalResponses: 0,
      avgRating: 0,
      wantsToContinueCount: 0,
      helpsSalesCount: 0,
      keepsOrganizedCount: 0
    };
  }

  const [surveyRes, usersRes] = await Promise.all([
    supabase
      .from('trial_feedback_surveys')
      .select('id, user_id, helps_sales, keeps_organized, experience_rating, wants_to_continue, created_at')
      .eq('company_id', companyId)
      .eq('cycle_key', cycleKey)
      .order('created_at', { ascending: false }),
    supabase
      .from('crm_users')
      .select('id, name, email, role')
      .eq('company_id', companyId)
  ]);

  const rawRows = !surveyRes.error && Array.isArray(surveyRes.data) ? surveyRes.data : [];
  const membersMap = new Map(
    (!usersRes.error && Array.isArray(usersRes.data) ? usersRes.data : []).map((u) => [u.id, u])
  );

  const responses = rawRows.map((row) => {
    const member = membersMap.get(row.user_id);
    return {
      id: row.id,
      user_id: row.user_id,
      memberName: member?.name || 'Team Member',
      memberEmail: member?.email || '',
      memberRole: member?.role || 'member',
      experience_rating: row.experience_rating,
      wants_to_continue: row.wants_to_continue,
      created_at: row.created_at
    };
  });

  const totalResponses = responses.length;
  const ratingSum = responses.reduce((sum, r) => sum + Number(r.experience_rating || 0), 0);
  const avgRating = totalResponses > 0 ? Number((ratingSum / totalResponses).toFixed(1)) : 0;

  return {
    responses,
    totalResponses,
    avgRating,
    wantsToContinueCount: responses.filter((r) => r.wants_to_continue).length,
    helpsSalesCount: responses.filter((r) => r.helps_sales).length,
    keepsOrganizedCount: responses.filter((r) => r.keeps_organized).length
  };
}


