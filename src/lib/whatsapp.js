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
      .select('whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, whatsapp_template, whatsapp_auto_welcome')
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
 * Sends a dynamic WhatsApp template message via Meta WhatsApp Cloud API
 * 
 * @param {Object} params
 * @param {string} params.to - Recipient phone number
 * @param {string} [params.leadName] - Contact name to inject into {{1}}
 * @param {string} [params.templateName] - Template name (defaults to configured or 'salado_lead_welcome')
 * @param {Object} [params.overrideConfig] - Optional config override
 */
export async function sendWhatsAppMessage({ to, leadName, templateName, overrideConfig }) {
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

  return {
    success: true,
    messageId: data.messages?.[0]?.id,
    recipient: cleanPhone,
    template
  };
}
