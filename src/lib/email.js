import { supabase } from './supabase';
import { Capacitor } from '@capacitor/core';

const EMAIL_SETTINGS_STORAGE_KEY = 'crm_email_settings';
const EMAIL_TEMPLATES_STORAGE_KEY = 'crm_email_templates';
const EMAIL_LOGS_STORAGE_KEY = 'crm_email_logs';

export const DEFAULT_EMAIL_TEMPLATES = [
  {
    id: 'tmpl-welcome-intro',
    name: 'Welcome Introduction',
    subject: 'Thank you for connecting with us, {{name}}',
    body_html: '<p>Hi {{name}},</p><p>Thank you for reaching out to us. We have received your inquiry and our team is reviewing your requirements.</p><p>Feel free to reply directly to this email if you have any questions in the meantime.</p><p>Best regards,<br/>The Team</p>'
  },
  {
    id: 'tmpl-proposal-followup',
    name: 'Proposal Follow-up',
    subject: 'Following up on your proposal - {{company}}',
    body_html: '<p>Hi {{name}},</p><p>I wanted to follow up on the proposal we shared with you recently.</p><p>Let us know if you would like to schedule a quick call to walk through the details or discuss any customizations.</p><p>Looking forward to hearing from you,<br/>The Team</p>'
  }
];

export const DEFAULT_EMAIL_SETTINGS = {
  provider: 'resend',
  api_key: '',
  from_name: 'SimpleCRM',
  from_email: 'onboarding@resend.dev',
  reply_to: '',
  is_connected: false
};

/**
 * Convert email HTML paragraphs into natural, human-readable plain text
 */
export function htmlToPlainText(html = '') {
  if (!html) return '';
  return html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert human-readable multi-line text into clean, styled email HTML paragraphs
 */
export function plainTextToHtml(text = '') {
  if (!text) return '';
  // If user deliberately entered full block-level HTML structure, preserve it
  if (/^\s*<(?:!doctype|html|body|div|table|p)[\s>]/i.test(text)) {
    return text.trim();
  }
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs
    .map(p => {
      const clean = p.trim().replace(/\n/g, '<br/>');
      return clean ? `<p style="margin: 0 0 16px 0; line-height: 1.6; color: #334155;">${clean}</p>` : '';
    })
    .filter(Boolean)
    .join('');
}

/**
 * Get locally stored email config
 */
export function getStoredEmailConfig() {
  try {
    const raw = localStorage.getItem(EMAIL_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_EMAIL_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_EMAIL_SETTINGS, ...parsed };
  } catch (err) {
    return DEFAULT_EMAIL_SETTINGS;
  }
}

/**
 * Fetch email config from Supabase with local cache fallback
 */
export async function fetchEmailConfig() {
  const cached = getStoredEmailConfig();
  try {
    const { data, error } = await supabase
      .from('email_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const merged = {
        ...DEFAULT_EMAIL_SETTINGS,
        ...data,
        is_connected: Boolean(data.api_key && data.is_connected)
      };
      localStorage.setItem(EMAIL_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch (err) {
    console.warn('Note reading email_settings from Supabase:', err);
  }
  return cached;
}

/**
 * Save email config to Supabase and cache
 */
export async function saveEmailConfig(config) {
  const updated = {
    provider: 'resend',
    api_key: (config.api_key || '').trim(),
    from_name: (config.from_name || 'SimpleCRM').trim(),
    from_email: (config.from_email || 'onboarding@resend.dev').trim(),
    reply_to: (config.reply_to || '').trim(),
    is_connected: Boolean(config.is_connected),
    updated_at: new Date().toISOString()
  };

  localStorage.setItem(EMAIL_SETTINGS_STORAGE_KEY, JSON.stringify(updated));

  try {
    const { data: existing } = await supabase
      .from('email_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('email_settings')
        .update(updated)
        .eq('id', existing.id);
    } else {
      await supabase.from('email_settings').insert([updated]);
    }
  } catch (err) {
    console.warn('Note persisting email_settings to Supabase:', err);
  }

  return updated;
}

/**
 * Fetch email templates from Supabase with fallback
 */
export async function fetchEmailTemplates() {
  try {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      localStorage.setItem(EMAIL_TEMPLATES_STORAGE_KEY, JSON.stringify(data));
      return data;
    }
  } catch (err) {
    console.warn('Note fetching email_templates:', err);
  }

  try {
    const cached = localStorage.getItem(EMAIL_TEMPLATES_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { }

  return DEFAULT_EMAIL_TEMPLATES;
}

/**
 * Save or update an email template
 */
export async function saveEmailTemplate(template) {
  const isNew = !template.id || String(template.id).startsWith('tmpl-');
  const payload = {
    name: template.name,
    subject: template.subject,
    body_html: template.body_html
  };

  try {
    if (isNew) {
      const { data } = await supabase
        .from('email_templates')
        .insert([payload])
        .select()
        .single();
      return data || { ...payload, id: `tmpl-${Date.now()}` };
    } else {
      const { data } = await supabase
        .from('email_templates')
        .update(payload)
        .eq('id', template.id)
        .select()
        .single();
      return data || { ...payload, id: template.id };
    }
  } catch (err) {
    console.warn('Error saving email template to Supabase:', err);
    return { ...payload, id: template.id || `tmpl-${Date.now()}` };
  }
}

/**
 * Delete an email template
 */
export async function deleteEmailTemplate(id) {
  try {
    await supabase.from('email_templates').delete().eq('id', id);
  } catch (err) {
    console.warn('Error deleting email template:', err);
  }
}

export const RESEND_API_BASE = (typeof window !== 'undefined' && !Capacitor.isNativePlatform() && window.location.port === '5173')
  ? '/api/resend'
  : 'https://api.resend.com';

/**
 * Verify Resend API Key (supports both Full Access and Sending-Only keys)
 */
export async function verifyResendApiKey(apiKey) {
  if (!apiKey || !apiKey.trim().startsWith('re_')) {
    return { valid: false, error: 'API key must start with re_' };
  }
  try {
    const res = await fetch(`${RESEND_API_BASE}/domains`, {
      headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      return { valid: true, domains: data.data || [], isFullAccess: true };
    }
    if (data.name === 'restricted_api_key') {
      return { valid: true, domains: [], isFullAccess: false };
    }
    return { valid: false, error: data.message || 'Invalid Resend API Key' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Fetch domains from Resend API (requires Full Access API Key)
 */
export async function fetchResendDomains(apiKey) {
  const result = await verifyResendApiKey(apiKey);
  return result.domains || [];
}

/**
 * Generate beautifully styled HTML test email
 */
export function generateTestEmailHtml({ senderName, senderEmail, replyTo, testRecipient, dispatchedAt }) {
  const name = senderName || 'SimpleCRM';
  const email = senderEmail || 'onboarding@resend.dev';
  const time = dispatchedAt || new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resend Connection Verified</title>
</head>
<body style="margin: 0; padding: 36px 16px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);">
    <!-- Top Accent Gradient Stripe -->
    <tr>
      <td height="4" style="background: linear-gradient(90deg, #0284c7 0%, #38bdf8 50%, #10b981 100%); line-height: 4px; font-size: 4px;">&nbsp;</td>
    </tr>

    <!-- Main Card Body -->
    <tr>
      <td style="padding: 32px 32px 24px 32px;">
        <!-- Header Brand Row -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle">
              <span style="font-size: 13px; font-weight: 700; color: #0284c7; letter-spacing: 0.06em; text-transform: uppercase;">${name}</span>
            </td>
            <td valign="middle" align="right">
              <span style="display: inline-block; padding: 4px 10px; border-radius: 999px; background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 12px; font-weight: 600;">
                &#9679; Connection Active
              </span>
            </td>
          </tr>
        </table>

        <!-- Hero Title -->
        <h1 style="font-size: 22px; font-weight: 600; color: #0f172a; margin: 20px 0 8px 0; letter-spacing: -0.02em; line-height: 1.3;">
          Resend Email Integration Verified
        </h1>
        <p style="font-size: 14px; color: #475569; margin: 0 0 24px 0; line-height: 1.55;">
          Your Resend email service has been connected to your CRM. Automated emails can now be dispatched to leads as they advance through your pipeline stages.
        </p>

        <!-- Credentials Detail Box -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 13px;">
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #64748b; width: 34%;">Sender Name</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #0f172a; font-weight: 600;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #64748b;">From Address</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #0f172a; font-family: monospace, sans-serif; font-size: 12.5px;">${email}</td>
          </tr>
          ${replyTo ? `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #64748b;">Reply-To</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #0f172a; font-family: monospace, sans-serif; font-size: 12.5px;">${replyTo}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #64748b;">Test Recipient</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; color: #0f172a; font-weight: 500;">${testRecipient || ''}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; color: #64748b;">Dispatched At</td>
            <td style="padding: 12px 16px; color: #0f172a;">${time}</td>
          </tr>
        </table>

        <!-- Features Mini-list -->
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #f1f5f9;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 12.5px; color: #475569;">
            <tr>
              <td style="padding-bottom: 8px;">
                <strong style="color: #0f172a;">&#10003; Stage Automations:</strong> Automatic trigger upon stage movement.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom: 8px;">
                <strong style="color: #0f172a;">&#10003; Dynamic Merge Tags:</strong> Supports {{name}}, {{email}}, {{company}}, and custom fields.
              </td>
            </tr>
            <tr>
              <td>
                <strong style="color: #0f172a;">&#10003; High Deliverability:</strong> DKIM &amp; SPF verified domain sending.
              </td>
            </tr>
          </table>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 18px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
        Sent via <strong>${name}</strong> CRM Integration &bull; Powered by Resend
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Send test email via Resend to verify credentials
 */
export async function testResendCredentials({ apiKey, fromEmail, fromName, replyTo, testRecipient }) {
  if (!apiKey) {
    throw new Error('Please enter a Resend API Key');
  }
  if (!testRecipient) {
    throw new Error('Please enter a test recipient email address');
  }

  const senderName = fromName || 'SimpleCRM';
  const senderEmail = fromEmail || 'onboarding@resend.dev';

  const response = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${senderName} <${senderEmail}>`,
      to: [testRecipient.trim()],
      reply_to: replyTo ? replyTo.trim() : undefined,
      subject: `✓ Connection Verified - ${senderName}`,
      html: generateTestEmailHtml({
        senderName,
        senderEmail,
        replyTo,
        testRecipient
      })
    })
  });

  const resJson = await response.json();
  if (!response.ok) {
    throw new Error(resJson.message || `Resend Error (${response.status})`);
  }

  return resJson;
}

/**
 * Replace placeholders in template text
 */
export function renderEmailVariables(templateText, lead = {}) {
  if (!templateText) return '';
  const fullName = lead.name || 'Valued Customer';
  const firstName = fullName.split(' ')[0] || fullName;
  const company = lead.company || lead.organization || 'your organization';
  const phone = lead.phone || '';
  const stage = lead.stage || '';

  return templateText
    .replace(/\{\{name\}\}/gi, fullName)
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{company\}\}/gi, company)
    .replace(/\{\{phone\}\}/gi, phone)
    .replace(/\{\{stage\}\}/gi, stage);
}

/**
 * Send an email to a lead via Resend and log the result
 */
export async function sendEmailViaResend({
  to,
  leadId,
  leadName,
  leadCompany,
  lead,
  template,
  templateName,
  subject,
  html,
  pipelineId,
  stageId,
  isAutomated = true
}) {
  const config = await fetchEmailConfig();
  if (!config.api_key || !config.is_connected) {
    console.warn('Resend email is not configured or connected in Settings.');
    return { success: false, error: 'Email service is not connected' };
  }

  if (!to || !to.includes('@')) {
    console.warn('Cannot send email: Lead does not have a valid email address:', to);
    return { success: false, error: 'Missing or invalid recipient email' };
  }

  const resolvedTemplateName = templateName || template?.name || 'Custom Email';
  const rawSubject = subject || template?.subject || '';
  const rawHtml = html || template?.body_html || template?.body || '';

  const leadContext = {
    name: leadName || lead?.name || '',
    company: leadCompany || lead?.company || lead?.city || '',
    phone: lead?.phone || '',
    stage: lead?.stage || ''
  };

  const finalSubject = renderEmailVariables(rawSubject, leadContext);
  const finalHtml = renderEmailVariables(rawHtml, leadContext);
  const senderName = config.from_name || 'SimpleCRM';
  const senderEmail = config.from_email || 'onboarding@resend.dev';

  let status = 'sent';
  let errorMessage = null;

  try {
    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.api_key.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [to.trim()],
        reply_to: config.reply_to ? config.reply_to.trim() : undefined,
        subject: finalSubject,
        html: finalHtml
      })
    });

    const resJson = await res.json();
    if (!res.ok) {
      status = 'failed';
      errorMessage = resJson.message || `Resend Error (${res.status})`;
    }
  } catch (err) {
    status = 'failed';
    errorMessage = err.message || 'Network failure sending email';
  }

  // Record to email_logs
  const logEntry = {
    id: `email-log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    lead_id: leadId || null,
    lead_name: leadName || lead?.name || 'Lead',
    lead_email: to,
    pipeline_id: pipelineId || null,
    stage_id: stageId || null,
    template_name: resolvedTemplateName,
    subject: finalSubject,
    body: finalHtml,
    status,
    error_message: errorMessage,
    is_automated: Boolean(isAutomated),
    created_at: new Date().toISOString()
  };

  // Local storage cache
  try {
    const existing = JSON.parse(localStorage.getItem(EMAIL_LOGS_STORAGE_KEY) || '[]');
    const updated = [logEntry, ...existing].slice(0, 500);
    localStorage.setItem(EMAIL_LOGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) { }

  // Supabase persist
  try {
    const isUuid = leadId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId);
    await supabase.from('email_logs').insert([{
      lead_id: isUuid ? leadId : null,
      lead_name: logEntry.lead_name,
      lead_email: logEntry.lead_email,
      pipeline_id: logEntry.pipeline_id,
      stage_id: logEntry.stage_id,
      template_name: logEntry.template_name,
      subject: logEntry.subject,
      body: logEntry.body,
      status: logEntry.status,
      error_message: logEntry.error_message,
      is_automated: logEntry.is_automated
    }]);
  } catch (e) { }

  // Cross-component notification
  try {
    window.dispatchEvent(new CustomEvent('crm-email-sent', { detail: logEntry }));
  } catch (e) { }

  return {
    success: status === 'sent',
    log: logEntry,
    error: errorMessage
  };
}

/**
 * Fetch sent email logs from Supabase with local storage cache fallback
 */
export async function fetchEmailLogs() {
  try {
    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!error && Array.isArray(data)) {
      try {
        localStorage.setItem(EMAIL_LOGS_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
      return data;
    }
  } catch (err) {
    console.warn('Failed to fetch email logs from Supabase, falling back to local cache:', err);
  }

  try {
    const cached = localStorage.getItem(EMAIL_LOGS_STORAGE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    return [];
  }
}

