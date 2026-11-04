/**
 * leadVerification.js
 * High-performance Data Quality & Deliverability Verification Engine for Cold Leads.
 *
 * Capabilities:
 * 1. Zero-dependency DNS-over-HTTPS (DoH) MX Record Validation (Cloudflare & Google DNS)
 * 2. Enterprise Mail Provider Identification (Google Workspace, Microsoft 365, Zoho, etc.)
 * 3. Deep Contact Extraction from Web/Snippet text (real emails & real office phone numbers)
 * 4. 0–100 Contact Quality Scoring & Deliverability Classification
 */

// In-memory cache for MX lookups to keep queries ultra-fast and avoid duplicate network calls
const mxCache = new Map();

/**
 * Normalizes raw domain or URL to pure hostname
 */
export function normalizeDomain(raw) {
  if (!raw) return '';
  let str = String(raw).trim().toLowerCase();
  str = str.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  str = str.split('/')[0].split(':')[0].split('?')[0].split('#')[0];
  return str.trim();
}

/**
 * Identifies the enterprise mail provider from MX hostnames
 */
export function identifyMailProvider(mxRecords = []) {
  if (!Array.isArray(mxRecords) || mxRecords.length === 0) {
    return 'None';
  }

  const combined = mxRecords.join(' ').toLowerCase();

  if (combined.includes('google.com') || combined.includes('googlemail.com') || combined.includes('aspmx')) {
    return 'Google Workspace';
  }
  if (combined.includes('outlook.com') || combined.includes('protection.outlook') || combined.includes('microsoft')) {
    return 'Microsoft 365';
  }
  if (combined.includes('zoho.com') || combined.includes('zoho.in')) {
    return 'Zoho Mail';
  }
  if (combined.includes('protonmail') || combined.includes('proton.ch')) {
    return 'Proton Mail';
  }
  if (combined.includes('mimecast')) {
    return 'Mimecast Gateway';
  }
  if (combined.includes('pphosted.com') || combined.includes('proofpoint')) {
    return 'Proofpoint Gateway';
  }
  if (combined.includes('barracuda')) {
    return 'Barracuda Networks';
  }
  if (combined.includes('secureserver.net')) {
    return 'GoDaddy Email';
  }
  if (combined.includes('mail.icloud.com') || combined.includes('apple.com')) {
    return 'Apple iCloud';
  }

  // Extract cleanest host name for custom mail servers
  const firstHost = mxRecords[0]?.replace(/^\d+\s+/, '').replace(/\.$/, '') || 'Custom Mail Server';
  return `Custom MX (${firstHost.split('.').slice(-2).join('.')})`;
}

/**
 * Resolves MX records for a domain via Cloudflare DNS-over-HTTPS with Google DNS fallback
 * Returns: { isValid: boolean, provider: string, mxHost: string, records: string[] }
 */
export async function verifyDomainMX(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain || !domain.includes('.')) {
    return { isValid: false, provider: 'None', mxHost: null, records: [], error: 'Invalid domain format' };
  }

  // Check cache first
  if (mxCache.has(domain)) {
    return mxCache.get(domain);
  }

  // Consumer mail providers with known 100% active MX
  const CONSUMER_DOMAINS = {
    'gmail.com': 'Google Consumer',
    'googlemail.com': 'Google Consumer',
    'outlook.com': 'Microsoft Outlook',
    'hotmail.com': 'Microsoft Outlook',
    'live.com': 'Microsoft Outlook',
    'yahoo.com': 'Yahoo Mail',
    'yahoo.co.in': 'Yahoo Mail',
    'icloud.com': 'Apple iCloud'
  };

  if (CONSUMER_DOMAINS[domain]) {
    const res = {
      isValid: true,
      provider: CONSUMER_DOMAINS[domain],
      mxHost: `smtp.${domain}`,
      records: [`10 smtp.${domain}`]
    };
    mxCache.set(domain, res);
    return res;
  }

  let records = [];

  // 1. Primary: Cloudflare DoH
  try {
    const cfUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
    const cfRes = await fetch(cfUrl, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(4000)
    });

    if (cfRes.ok) {
      const data = await cfRes.json();
      if (Array.isArray(data.Answer) && data.Answer.length > 0) {
        records = data.Answer
          .filter((a) => a.type === 15 && a.data)
          .map((a) => a.data.trim());
      }
    }
  } catch (err) {
    // Fallback to Google DNS
  }

  // 2. Secondary Fallback: Google Public DNS DoH
  if (records.length === 0) {
    try {
      const gUrl = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`;
      const gRes = await fetch(gUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (gRes.ok) {
        const data = await gRes.json();
        if (Array.isArray(data.Answer) && data.Answer.length > 0) {
          records = data.Answer
            .filter((a) => a.type === 15 && a.data)
            .map((a) => a.data.trim());
        }
      }
    } catch (gErr) {
      // Both queries timed out or failed
    }
  }

  const isValid = records.length > 0;
  const provider = identifyMailProvider(records);
  const primaryHost = records[0] ? records[0].replace(/^\d+\s+/, '').replace(/\.$/, '') : null;

  const result = {
    isValid,
    provider: isValid ? provider : 'None',
    mxHost: primaryHost,
    records,
    error: isValid ? null : 'No active MX records found on domain'
  };

  mxCache.set(domain, result);
  return result;
}

/**
 * Deep text search to extract authentic emails from raw web snippets or crawler output
 */
export function extractRealEmailsFromText(text = '', targetDomain = '') {
  if (!text) return [];
  const cleanDomain = normalizeDomain(targetDomain);

  // Email regex compliant with RFC 5322 subset
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const matches = text.match(emailRegex) || [];

  const DISQUALIFIED_PARTS = [
    'example.com', 'domain.com', 'email.com', 'sample.com', 'yoursite.com',
    'sentry.io', 'wixpress.com', 'wordpress.org', 'schema.org',
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'
  ];

  const unique = new Set();
  const found = [];

  for (const raw of matches) {
    const em = raw.toLowerCase().trim();
    if (DISQUALIFIED_PARTS.some((p) => em.includes(p))) continue;
    if (em.length < 6 || em.length > 60) continue;

    if (!unique.has(em)) {
      unique.add(em);
      const isDomainMatch = cleanDomain && em.endsWith(`@${cleanDomain}`);
      found.push({
        email: em,
        isDomainMatch: Boolean(isDomainMatch),
        isRoleAccount: /^(info|contact|sales|hello|support|admin|careers|help)@/i.test(em)
      });
    }
  }

  // Prioritize domain-matching corporate emails first, then direct contacts, then role accounts
  return found.sort((a, b) => {
    if (a.isDomainMatch && !b.isDomainMatch) return -1;
    if (!a.isDomainMatch && b.isDomainMatch) return 1;
    if (!a.isRoleAccount && b.isRoleAccount) return -1;
    if (a.isRoleAccount && !b.isRoleAccount) return 1;
    return 0;
  });
}

/**
 * Deep text search to extract authentic phone numbers (landlines, toll-free, mobile)
 */
export function extractRealPhonesFromText(text = '', country = 'India') {
  if (!text) return [];

  const found = [];
  const seen = new Set();

  // 1. Toll-Free Numbers (India 1800, US 800/888/877/866)
  const tollFreeRegex = /\b(1800[-.\s]?\d{3}[-.\s]?\d{3,4}|1[-.\s]?8(?:00|88|77|66)[-.\s]?\d{3}[-.\s]?\d{4})\b/g;
  const tollMatches = text.match(tollFreeRegex) || [];
  for (const raw of tollMatches) {
    const clean = raw.trim();
    if (!seen.has(clean)) {
      seen.add(clean);
      found.push({ phone: clean, type: 'toll_free', label: 'Toll-Free' });
    }
  }

  // 2. India Metro Landlines / Office lines (080, 022, 011, 040, 020, 044, 0124, 0120)
  const landlineRegex = /(?:\+91[-.\s]?)?(?:\(?0?(?:80|22|11|40|20|44|124|120|79)\)?[-.\s]?)\d{3,4}[-.\s]?\d{4}\b/g;
  const landlineMatches = text.match(landlineRegex) || [];
  for (const raw of landlineMatches) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 12 && !seen.has(raw)) {
      seen.add(raw);
      found.push({ phone: raw.trim(), type: 'office_landline', label: 'Office Switchboard' });
    }
  }

  // 3. Mobile / Direct standard telephone numbers (+91, +971, +44, +1)
  const generalPhoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
  const generalMatches = text.match(generalPhoneRegex) || [];
  for (const raw of generalMatches) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13 && !/^(19|20)\d{2}/.test(digits)) {
      const clean = raw.trim();
      if (!seen.has(clean)) {
        seen.add(clean);
        found.push({ phone: clean, type: 'direct_phone', label: 'Direct Line' });
      }
    }
  }

  return found;
}

/**
 * Calculates a comprehensive 0–100 Contact Quality Score based on verification signals
 */
export function calculateContactQualityScore({
  hasValidMx = false,
  isDirectEmail = false,
  hasRealPhone = false,
  hasDecisionMaker = false,
  hasWebsite = false,
  mailProvider = ''
}) {
  let score = 0;

  // 1. MX & Deliverability (40 pts)
  if (hasValidMx) {
    score += 30;
    if (mailProvider.includes('Google') || mailProvider.includes('Microsoft') || mailProvider.includes('Zoho')) {
      score += 10; // Enterprise mail tier bonus
    } else {
      score += 5;
    }
  }

  // 2. Email Authenticity (25 pts)
  if (isDirectEmail) {
    score += 25; // Directly scraped contact or verified executive
  } else if (hasValidMx) {
    score += 15; // Pattern derived on verified domain
  }

  // 3. Phone Authenticity (20 pts)
  if (hasRealPhone) {
    score += 20; // Extracted office line or real phone
  } else {
    score += 5; // Standard fallback phone
  }

  // 4. Decision Maker & Web Signals (15 pts)
  if (hasDecisionMaker) score += 10;
  if (hasWebsite) score += 5;

  score = Math.min(100, Math.max(0, score));

  let tier = 'C';
  let badgeColor = '#94a3b8'; // Slate
  if (score >= 85) {
    tier = 'A+';
    badgeColor = '#10b981'; // Emerald
  } else if (score >= 70) {
    tier = 'A';
    badgeColor = '#3b82f6'; // Blue
  } else if (score >= 55) {
    tier = 'B';
    badgeColor = '#f59e0b'; // Amber
  }

  return { score, tier, badgeColor };
}

/**
 * Orchestrates full verification and quality enrichment for a discovered candidate
 */
export async function verifyAndEnrichCandidate(candidate) {
  const domain = normalizeDomain(candidate.domain || (candidate.website ? new URL(candidate.website).hostname : ''));
  const mxCheck = await verifyDomainMX(domain);

  const isDirectEmail = Boolean(candidate.isRealScrapedEmail);
  const hasRealPhone = Boolean(candidate.isRealScrapedPhone);
  const hasDecisionMaker = Boolean(candidate.name && candidate.name !== 'Executive Prospect' && candidate.name !== 'Target Enterprise');
  const hasWebsite = Boolean(domain && domain.includes('.'));

  const quality = calculateContactQualityScore({
    hasValidMx: mxCheck.isValid,
    isDirectEmail,
    hasRealPhone,
    hasDecisionMaker,
    hasWebsite,
    mailProvider: mxCheck.provider
  });

  let deliverabilityStatus = 'invalid_mx';
  if (mxCheck.isValid) {
    deliverabilityStatus = isDirectEmail ? 'verified_direct' : 'deliverable_pattern';
  }

  return {
    ...candidate,
    domain,
    isDeliverable: mxCheck.isValid,
    verification: {
      status: deliverabilityStatus,
      isDeliverable: mxCheck.isValid,
      mailProvider: mxCheck.provider,
      mxHost: mxCheck.mxHost,
      qualityScore: quality.score,
      qualityTier: quality.tier,
      badgeColor: quality.badgeColor,
      verifiedAt: new Date().toISOString()
    }
  };
}

