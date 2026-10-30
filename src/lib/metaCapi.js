/**
 * Meta Conversions API (CAPI) Client & Event Dispatcher
 * Multi-Tenant SaaS helper for sending CRM conversion milestones back to Meta.
 */

import { supabase } from './supabase';

const API_VERSION = 'v20.0';

/**
 * Standard Meta Lead & Conversion Events
 */
export const META_CAPI_EVENTS = [
  { id: 'QualifiedLead', label: 'Qualified Lead', description: 'Lead marked as qualified / high intent (Crucial for Conversion Leads)', category: 'Quality' },
  { id: 'Schedule', label: 'Schedule (Meeting / Demo)', description: 'Lead booked an appointment, call, or demo', category: 'Mid-Funnel' },
  { id: 'Contact', label: 'Contacted', description: 'Sales rep successfully reached out and connected', category: 'Engagement' },
  { id: 'Purchase', label: 'Purchase / Deal Won', description: 'Lead converted into paying deal / closed won', category: 'Conversion' },
  { id: 'CompleteRegistration', label: 'Complete Registration', description: 'Customer completed onboarding, signup, or profile', category: 'Conversion' },
  { id: 'SubmitApplication', label: 'Submit Application', description: 'Lead submitted proposal, quote, or loan application', category: 'Mid-Funnel' },
  { id: 'FindLocation', label: 'Site / Store Visit', description: 'Lead visited physical store, branch, or property', category: 'Offline' },
  { id: 'Other', label: 'Custom Event', description: 'Define custom event name for your specific sales funnel', category: 'Custom' }
];

/**
 * SHA-256 Hash using browser Web Crypto API
 */
export async function sha256(str) {
  if (!str || typeof str !== 'string') return null;
  const clean = str.trim();
  if (!clean) return null;
  try {
    const utf8 = new TextEncoder().encode(clean);
    const hashBuffer = await crypto.subtle.digest('SHA-256', utf8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.error('[Meta CAPI] SHA-256 hashing error:', err);
    return null;
  }
}

/**
 * Normalization helpers according to Meta Conversions API specifications
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  // Meta phone format: only numbers, with country code, no +, no spaces, no dashes
  let clean = phone.replace(/[^\d]/g, '');
  // Default to India country code 91 if 10 digits provided
  if (clean.length === 10) {
    clean = '91' + clean;
  }
  return clean;
}

export function splitFullName(fullName) {
  if (!fullName || typeof fullName !== 'string') return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  return {
    firstName: firstName.toLowerCase(),
    lastName: lastName.toLowerCase()
  };
}

export function normalizeCity(city) {
  if (!city || typeof city !== 'string') return '';
  return city.trim().toLowerCase().replace(/[0-9\s,\.]/g, '');
}

/**
 * Fetch Meta Datasets and Pixels available under the connected Ad Account
 */
export async function fetchAdAccountDatasets(adAccountId, accessToken) {
  if (!adAccountId || !accessToken) return [];

  const cleanActId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const datasets = [];

  try {
    // 1. Fetch Offline Conversion Datasets
    const dsUrl = `https://graph.facebook.com/${API_VERSION}/${cleanActId}/offline_conversion_data_sets?fields=id,name,description&access_token=${accessToken}`;
    const dsRes = await fetch(dsUrl);
    const dsData = await dsRes.json();
    if (Array.isArray(dsData?.data)) {
      dsData.data.forEach(d => {
        datasets.push({
          id: d.id,
          name: d.name || `Dataset ${d.id}`,
          type: 'Dataset',
          description: d.description || 'Offline / CRM Dataset'
        });
      });
    }

    // 2. Fetch Ads Pixels (Datasets & Pixels are unified in modern Meta Graph API)
    const pxUrl = `https://graph.facebook.com/${API_VERSION}/${cleanActId}/adspixels?fields=id,name&access_token=${accessToken}`;
    const pxRes = await fetch(pxUrl);
    const pxData = await pxRes.json();
    if (Array.isArray(pxData?.data)) {
      pxData.data.forEach(p => {
        if (!datasets.some(d => d.id === p.id)) {
          datasets.push({
            id: p.id,
            name: p.name || `Pixel ${p.id}`,
            type: 'Pixel / Web Dataset',
            description: 'Meta Pixel ID'
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Meta CAPI] Could not fetch Datasets from Graph API:', err);
  }

  return datasets;
}

/**
 * Build Meta Conversions API compliant payload
 */
export async function buildCapiEventPayload({
  lead,
  eventName,
  stageName = '',
  pipelineName = '',
  dealValue = null,
  currency = 'INR',
  testEventCode = null,
  sourceUrl = window.location?.origin || ''
}) {
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `crm_${lead.id || 'test'}_${eventName}_${Date.now()}`;

  const { firstName, lastName } = splitFullName(lead.name);
  const normEmail = normalizeEmail(lead.email);
  const normPhone = normalizePhone(lead.phone);
  const normCity = normalizeCity(lead.city);

  const [hashedEmail, hashedPhone, hashedFn, hashedLn, hashedCity] = await Promise.all([
    normEmail ? sha256(normEmail) : null,
    normPhone ? sha256(normPhone) : null,
    firstName ? sha256(firstName) : null,
    lastName ? sha256(lastName) : null,
    normCity ? sha256(normCity) : null
  ]);

  const userData = {};

  // CRITICAL: Meta's exact leadgen_id for direct Lead Ads attribution (DO NOT HASH)
  if (lead.leadgen_id) {
    userData.lead_id = String(lead.leadgen_id).trim();
  }

  if (hashedEmail) userData.em = [hashedEmail];
  if (hashedPhone) userData.ph = [hashedPhone];
  if (hashedFn) userData.fn = [hashedFn];
  if (hashedLn) userData.ln = [hashedLn];
  if (hashedCity) userData.ct = [hashedCity];

  // Fallback IP and User Agent if available
  if (typeof navigator !== 'undefined') {
    userData.client_user_agent = navigator.userAgent;
  }

  const customData = {
    lead_status: stageName || lead.stage || '',
    pipeline: pipelineName || '',
    crm_source: 'simple_crm'
  };

  if (dealValue !== null && dealValue !== undefined && !isNaN(dealValue)) {
    customData.value = Number(dealValue);
    customData.currency = currency || 'INR';
  }

  const singleEvent = {
    event_name: eventName,
    event_time: eventTime,
    action_source: 'system_generated',
    event_id: eventId,
    event_source_url: sourceUrl,
    user_data: userData,
    custom_data: customData
  };

  const payload = {
    data: [singleEvent]
  };

  if (testEventCode && testEventCode.trim()) {
    payload.test_event_code = testEventCode.trim();
  }

  return { payload, eventId, eventTime };
}

/**
 * Dispatch Meta CAPI Event & Record in meta_capi_logs
 */
export async function sendMetaCapiEvent({
  lead,
  eventName,
  stageId,
  stageName,
  pipelineId,
  pipelineName,
  dealValue = null,
  currency = 'INR',
  createdBy = 'automation',
  forceSend = false
}) {
  if (!lead || !eventName) {
    return { success: false, reason: 'Missing lead or eventName' };
  }

  // 1. Fetch Meta Config (supporting SaaS multi-tenancy)
  let config = null;
  try {
    const { data, error } = await supabase
      .from('meta_config')
      .select('dataset_id, capi_enabled, test_event_code, access_token, capi_access_token')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      console.warn('[Meta CAPI] No meta_config found');
      return { success: false, reason: 'Meta configuration not found' };
    }
    config = data;
  } catch (err) {
    return { success: false, reason: err.message };
  }

  if (!config.capi_enabled) {
    console.log('[Meta CAPI] Conversions API is disabled in settings. Skipping.');
    return { success: false, reason: 'CAPI is disabled' };
  }

  const datasetId = (config.dataset_id || '').trim();
  const accessToken = (config.capi_access_token || config.access_token || '').trim();

  if (!datasetId) {
    console.warn('[Meta CAPI] Dataset ID / Pixel ID is not configured in Meta Integration.');
    return { success: false, reason: 'Missing dataset_id' };
  }

  if (!accessToken) {
    console.warn('[Meta CAPI] Access Token is missing.');
    return { success: false, reason: 'Missing access_token' };
  }

  // 2. Deduplication check: prevent firing duplicate event for same lead and stage
  if (!forceSend && lead.id && stageId) {
    try {
      const { data: existingLog } = await supabase
        .from('meta_capi_logs')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('stage_id', stageId)
        .eq('event_name', eventName)
        .eq('status', 'sent')
        .limit(1)
        .maybeSingle();

      if (existingLog) {
        console.log(`[Meta CAPI] Event "${eventName}" already sent for lead ${lead.id} at stage ${stageId}. Skipping.`);
        return { success: true, skipped: true, reason: 'Duplicate event already dispatched' };
      }
    } catch (dedupErr) {
      console.warn('[Meta CAPI] Deduplication check failed, proceeding cautiously:', dedupErr);
    }
  }

  // 3. Construct Payload
  const { payload, eventId } = await buildCapiEventPayload({
    lead,
    eventName,
    stageName,
    pipelineName,
    dealValue,
    currency,
    testEventCode: config.test_event_code
  });

  // 4. Send to Meta Graph API
  const url = `https://graph.facebook.com/${API_VERSION}/${datasetId}/events?access_token=${accessToken}`;
  let responseData = null;
  let status = 'failed';
  let errorMessage = null;
  let metaTraceId = null;
  let eventsReceived = 0;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    responseData = await res.json();

    if (res.ok && !responseData.error) {
      status = 'sent';
      eventsReceived = responseData.events_received || 1;
      metaTraceId = responseData.fbtrace_id || null;
      console.log(`[Meta CAPI] Successfully sent "${eventName}" for ${lead.name} (Trace ID: ${metaTraceId})`);
    } else {
      status = 'failed';
      errorMessage = responseData.error?.message || `HTTP ${res.status} Error`;
      metaTraceId = responseData.error?.fbtrace_id || responseData.fbtrace_id || null;
      console.error('[Meta CAPI] Graph API Error:', responseData.error);
    }
  } catch (netErr) {
    status = 'failed';
    errorMessage = netErr.message || 'Network error while contacting Meta Graph API';
    console.error('[Meta CAPI] Network dispatch exception:', netErr);
  }

  // 5. Audit Log in Supabase
  try {
    await supabase.from('meta_capi_logs').insert({
      lead_id: lead.id || null,
      lead_name: lead.name || '',
      leadgen_id: lead.leadgen_id || null,
      pipeline_id: pipelineId || null,
      stage_id: stageId || null,
      event_name: eventName,
      event_id: eventId,
      dataset_id: datasetId,
      status: status,
      meta_trace_id: metaTraceId,
      events_received: eventsReceived,
      error_message: errorMessage,
      request_payload: payload,
      response_payload: responseData,
      is_test: Boolean(config.test_event_code && config.test_event_code.trim()),
      created_by: createdBy
    });
  } catch (logErr) {
    console.warn('[Meta CAPI] Could not record meta_capi_logs entry:', logErr);
  }

  return {
    success: status === 'sent',
    eventId,
    metaTraceId,
    error: errorMessage,
    data: responseData
  };
}

/**
 * Dispatch a Test Event to verify Meta CAPI setup
 */
export async function sendMetaCapiTestEvent({
  datasetId,
  accessToken,
  testEventCode,
  eventName = 'QualifiedLead'
}) {
  if (!datasetId || !accessToken) {
    throw new Error('Dataset ID and Access Token are required.');
  }

  const sampleLead = {
    id: 'test_lead_001',
    name: 'SimpleCRM Test Customer',
    email: 'test.conversion@example.com',
    phone: '+919876543210',
    city: 'Mumbai',
    stage: 'Qualified',
    leadgen_id: '999999999999999' // Sample leadgen_id
  };

  const { payload, eventId } = await buildCapiEventPayload({
    lead: sampleLead,
    eventName,
    stageName: 'Test Stage',
    pipelineName: 'Test Pipeline',
    dealValue: 1000,
    currency: 'INR',
    testEventCode: testEventCode || null
  });

  const url = `https://graph.facebook.com/${API_VERSION}/${datasetId}/events?access_token=${accessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `HTTP ${res.status} Error`);
  }

  // Also log the test event in meta_capi_logs
  try {
    await supabase.from('meta_capi_logs').insert({
      lead_id: null,
      lead_name: sampleLead.name,
      leadgen_id: sampleLead.leadgen_id,
      event_name: eventName,
      event_id: eventId,
      dataset_id: datasetId,
      status: 'sent',
      meta_trace_id: data.fbtrace_id || null,
      events_received: data.events_received || 1,
      error_message: null,
      request_payload: payload,
      response_payload: data,
      is_test: true,
      created_by: 'manual_test'
    });
  } catch (e) {
    // ignore test log err
  }

  return data;
}

/**
 * Fetch recent CAPI sync logs
 */
export async function fetchMetaCapiLogs(limit = 50) {
  const { data, error } = await supabase
    .from('meta_capi_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Meta CAPI] Error fetching logs:', error);
    return [];
  }
  return data || [];
}
