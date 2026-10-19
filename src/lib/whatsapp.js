import { supabase } from './supabase.js';

/**
 * Normalizes phone number to international digits format (e.g., 919876543210)
 */
export function formatWhatsAppNumber(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  // If Indian 10 digits without country code, prefix 91
  if (digits.length === 10) {
    digits = '91' + digits;
  }
  return digits;
}

/**
 * Fetches the active WhatsApp configuration dynamically from Supabase meta_config
 */
export async function getWhatsAppConfig() {
  try {
    const { data, error } = await supabase
      .from('meta_config')
      .select('whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, whatsapp_template, whatsapp_auto_welcome, whatsapp_templates')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (err) {
    console.warn('Could not load WhatsApp configuration:', err);
    return null;
  }
}

/**
 * Validates WhatsApp Cloud API Phone Number ID & Token with Meta Graph API
 */
export async function testWhatsAppCredentials({ phoneId, token }) {
  if (!phoneId || !token) {
    throw new Error('Both Phone Number ID and Access Token are required.');
  }

  const cleanPhoneId = phoneId.trim();
  const cleanToken = token.trim();

  const res = await fetch(`https://graph.facebook.com/v21.0/${cleanPhoneId}?fields=verified_name,code_verification_status,display_phone_number,quality_rating`, {
    headers: {
      Authorization: `Bearer ${cleanToken}`
    }
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Validation failed (HTTP ${res.status})`);
  }

  return {
    success: true,
    phoneId: cleanPhoneId,
    displayName: data.verified_name || data.display_phone_number || 'WhatsApp Business Number',
    phoneNumber: data.display_phone_number || cleanPhoneId,
    qualityRating: data.quality_rating || 'UNKNOWN',
    status: data.code_verification_status || 'VERIFIED'
  };
}

/**
 * Fetches all approved message templates for a given WABA ID
 */
export async function fetchWhatsAppTemplates({ wabaId, token }) {
  if (!wabaId || !token) {
    throw new Error('Both WhatsApp Business Account (WABA) ID and Access Token are required.');
  }

  const cleanWabaId = wabaId.trim();
  const cleanToken = token.trim();

  const res = await fetch(`https://graph.facebook.com/v21.0/${cleanWabaId}/message_templates?fields=name,status,category,language,components&limit=100`, {
    headers: {
      Authorization: `Bearer ${cleanToken}`
    }
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Failed to fetch templates (HTTP ${res.status})`);
  }

  const templates = (data.data || []).map((t) => {
    const bodyComp = (t.components || []).find(c => c.type === 'BODY');
    return {
      id: t.id,
      name: t.name,
      status: t.status, // 'APPROVED', 'PENDING', 'REJECTED'
      category: t.category, // 'UTILITY', 'MARKETING', etc.
      language: t.language,
      bodyText: bodyComp?.text || '',
      exampleVars: bodyComp?.example?.body_text?.[0] || []
    };
  });

  return templates;
}

/**
 * Sends a dynamic WhatsApp template message via Meta WhatsApp Cloud API
 * 
 * @param {Object} params
 * @param {string} params.to - Recipient phone number
 * @param {string} [params.leadName] - Contact name to inject into {{1}}
 * @param {string} [params.templateName] - Template name (defaults to configured or 'salado_lead_welcome')
 * @param {Object} [params.overrideConfig] - Optional config override
 */
const MESSAGES_STORAGE_KEY = 'crm_whatsapp_messages';

/**
 * Get locally stored WhatsApp messages
 */
export function getStoredWhatsAppMessages() {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Error reading stored whatsapp messages:', err);
    return [];
  }
}

/**
 * Record a dispatched WhatsApp message into Supabase and local cache
 */
export async function recordWhatsAppMessage({
  leadId,
  leadName,
  phone,
  pipelineId,
  stageId,
  templateName,
  messageBody,
  isAutomated = true,
  status = 'sent'
}) {
  const newMsg = {
    id: `wamsg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    lead_id: leadId || null,
    lead_name: leadName || 'Contact',
    phone: formatWhatsAppNumber(phone),
    pipeline_id: pipelineId || null,
    stage_id: stageId || null,
    template_name: templateName,
    message_body: messageBody || `[Template: ${templateName}]`,
    direction: 'outbound',
    status,
    is_automated: Boolean(isAutomated),
    created_at: new Date().toISOString()
  };

  // 1. Save to localStorage immediately
  try {
    const current = getStoredWhatsAppMessages();
    const updated = [newMsg, ...current.filter(m => m.id !== newMsg.id)].slice(0, 500);
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Error caching whatsapp message:', err);
  }

  // 2. Dispatch cross-component event for instantaneous reactivity
  try {
    window.dispatchEvent(
      new CustomEvent('crm-whatsapp-message-sent', { detail: newMsg })
    );
  } catch (e) { }

  // 3. Persist to Supabase whatsapp_messages table
  try {
    const isUuid = leadId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId);
    const payload = {
      lead_id: isUuid ? leadId : null,
      lead_name: newMsg.lead_name,
      phone: newMsg.phone,
      pipeline_id: newMsg.pipeline_id,
      stage_id: newMsg.stage_id,
      template_name: newMsg.template_name,
      message_body: newMsg.message_body,
      direction: 'outbound',
      status: newMsg.status,
      is_automated: newMsg.is_automated
    };
    await supabase.from('whatsapp_messages').insert([payload]);
  } catch (err) {
    // Non-blocking: table might not exist in Supabase yet
  }

  return newMsg;
}

/**
 * Fetch all WhatsApp messages from Supabase merged with local cache
 */
export async function fetchWhatsAppMessages() {
  const local = getStoredWhatsAppMessages();
  try {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error && Array.isArray(data) && data.length > 0) {
      // Merge unique messages
      const idMap = new Map();
      data.forEach(m => idMap.set(m.id || `${m.phone}-${m.created_at}`, m));
      local.forEach(m => {
        const key = m.id || `${m.phone}-${m.created_at}`;
        if (!idMap.has(key)) idMap.set(key, m);
      });
      const merged = Array.from(idMap.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      try {
        localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(merged.slice(0, 500)));
      } catch (e) { }
      return merged;
    }
  } catch (err) {
    console.warn('Could not fetch remote whatsapp_messages:', err);
  }
  return local;
}

/**
 * Sends a dynamic WhatsApp template message via Meta WhatsApp Cloud API and records it
 */
export async function sendWhatsAppMessage({
  to,
  leadName,
  templateName,
  overrideConfig,
  leadId,
  pipelineId,
  stageId,
  isAutomated = false
}) {
  const config = overrideConfig || (await getWhatsAppConfig());

  if (!config) {
    throw new Error('WhatsApp configuration not found in database.');
  }

  const phoneId = config.whatsapp_phone_number_id?.trim();
  const token = config.whatsapp_access_token?.trim();
  const template = templateName || config.whatsapp_template?.trim() || 'salado_lead_welcome';

  if (!phoneId) {
    throw new Error('WhatsApp Phone Number ID is missing. Please configure it in Settings → Integrations.');
  }
  if (!token) {
    throw new Error('WhatsApp Access Token is missing. Please configure it in Settings → Integrations.');
  }

  const cleanPhone = formatWhatsAppNumber(to);
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error(`Invalid recipient phone number: "${to}". Must include country code and valid digits.`);
  }

  // Determine message body preview text
  let renderedBody = '';
  if (config.whatsapp_templates && Array.isArray(config.whatsapp_templates)) {
    const tmplObj = config.whatsapp_templates.find(t => t.name === template);
    if (tmplObj?.bodyText) {
      renderedBody = tmplObj.bodyText.replace(/\{\{1\}\}/g, leadName || 'there');
    }
  }
  if (!renderedBody) {
    renderedBody = `Hello ${leadName || 'there'}, thank you for your interest in SaladO! 🥗 We're excited to have you connect with us.`;
  }

  // Construct template payload
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'template',
    template: {
      name: template,
      language: {
        code: 'en_US'
      }
    }
  };

  // If template has variables (like salado_lead_welcome has {{1}} for contact name)
  if (template !== 'hello_world') {
    payload.template.components = [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: leadName || 'there'
          }
        ]
      }
    ];
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `HTTP ${response.status} failed`;
    console.error('Meta WhatsApp API Error:', data.error);
    throw new Error(errorMsg);
  }

  // Record the sent message in the database & local state
  const loggedRecord = await recordWhatsAppMessage({
    leadId,
    leadName,
    phone: cleanPhone,
    pipelineId,
    stageId,
    templateName: template,
    messageBody: renderedBody,
    isAutomated: Boolean(isAutomated),
    status: 'sent'
  });

  return {
    success: true,
    messageId: data.messages?.[0]?.id,
    recipient: cleanPhone,
    template,
    loggedRecord
  };
}
