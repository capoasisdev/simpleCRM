/**
 * coldDeduplication.js
 * Intelligent multi-vector deduplication engine for Discovery lead scraping & prospecting.
 * Prevents redundant prospects and stops outreach to active inbound sales deals / clients.
 */

/**
 * Normalizes phone number to digits only (and extracts last 10 digits for local/international format comparison)
 * Example: "+91 (987) 654-3210" -> "9876543210"
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Normalizes email address to trimmed lowercase
 */
export function normalizeEmail(rawEmail) {
  if (!rawEmail) return '';
  return String(rawEmail).trim().toLowerCase();
}

/**
 * Normalizes a website URL or company domain to root hostname
 * Example: "https://www.acme-corp.com/contact?ref=1" -> "acme-corp.com"
 */
export function normalizeDomain(rawDomain) {
  if (!rawDomain) return '';
  let str = String(rawDomain).trim().toLowerCase();
  if (!str.startsWith('http://') && !str.startsWith('https://')) {
    str = 'http://' + str;
  }
  try {
    const parsed = new URL(str);
    let hostname = parsed.hostname.replace(/^www\./, '');
    return hostname;
  } catch (e) {
    return str.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].split('?')[0];
  }
}

/**
 * Normalizes a LinkedIn profile or company URL to canonical path
 * Example: "https://www.linkedin.com/in/john-doe-123/" -> "in/john-doe-123"
 */
export function normalizeLinkedIn(rawLinkedIn) {
  if (!rawLinkedIn) return '';
  let str = String(rawLinkedIn).trim().toLowerCase();
  str = str.replace(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/?/i, '');
  str = str.replace(/\/+$/, '');
  return str;
}

/**
 * Default deduplication rules for a pipeline
 */
export const DEFAULT_DEDUPE_RULES = {
  check_cold_leads: true,
  check_sales_leads: true,
  match_email: true,
  match_phone: true,
  match_domain: true,
  match_linkedin: true,
  on_duplicate: 'skip' // 'skip' | 'enrich'
};

/**
 * Builds an in-memory index from an array of existing leads for fast O(1) deduplication checking
 */
export function buildLeadsDedupeIndex(leads = [], currentPipelineId = null) {
  const index = {
    byEmail: new Map(),
    byPhone: new Map(),
    byDomain: new Map(),
    byLinkedIn: new Map()
  };

  for (const lead of leads) {
    // 1. Email index
    const email = normalizeEmail(lead.email);
    if (email) {
      if (!index.byEmail.has(email)) index.byEmail.set(email, []);
      index.byEmail.get(email).push(lead);
    }

    // 2. Phone index
    const phone = normalizePhone(lead.phone);
    if (phone && phone.length >= 7) {
      if (!index.byPhone.has(phone)) index.byPhone.set(phone, []);
      index.byPhone.get(phone).push(lead);
    }

    // 3. Domain index (from lead.website or custom_fields.website / company_website)
    const rawWebsite = lead.website || lead.custom_fields?.website || lead.custom_fields?.company_website;
    const domain = normalizeDomain(rawWebsite);
    if (domain) {
      if (!index.byDomain.has(domain)) index.byDomain.set(domain, []);
      index.byDomain.get(domain).push(lead);
    }

    // 4. LinkedIn index (from lead.linkedin or custom_fields.linkedin / linkedin_url)
    const rawLinkedIn = lead.linkedin || lead.custom_fields?.linkedin || lead.custom_fields?.linkedin_url;
    const linkedIn = normalizeLinkedIn(rawLinkedIn);
    if (linkedIn) {
      if (!index.byLinkedIn.has(linkedIn)) index.byLinkedIn.set(linkedIn, []);
      index.byLinkedIn.get(linkedIn).push(lead);
    }
  }

  return index;
}

/**
 * Evaluates whether a candidate scraped lead is a duplicate based on configured pipeline rules
 */
export function evaluateCandidateDeduplication(candidate, index, rules = DEFAULT_DEDUPE_RULES, currentPipelineId = null) {
  const effectiveRules = { ...DEFAULT_DEDUPE_RULES, ...(rules || {}) };

  const candEmail = normalizeEmail(candidate.email);
  const candPhone = normalizePhone(candidate.phone);
  const candDomain = normalizeDomain(candidate.website || candidate.custom_fields?.website || candidate.custom_fields?.company_website);
  const candLinkedIn = normalizeLinkedIn(candidate.linkedin || candidate.custom_fields?.linkedin || candidate.custom_fields?.linkedin_url);

  const checkMatch = (matchedLeads, keyName, matchedValue) => {
    if (!matchedLeads || matchedLeads.length === 0) return null;

    for (const lead of matchedLeads) {
      const isCurrentColdPipeline = lead.pipeline_id === currentPipelineId;
      const isSalesPipeline = !lead.pipeline_type || lead.pipeline_type === 'sales';
      const isOtherColdPipeline = lead.pipeline_type === 'cold' && lead.pipeline_id !== currentPipelineId;

      // Scope checks
      if (isCurrentColdPipeline && effectiveRules.check_cold_leads) {
        return {
          isDuplicate: true,
          matchedLead: lead,
          matchKey: keyName,
          matchedValue,
          scope: 'current_cold_pipeline',
          reason: `Already exists in this cold pipeline (${keyName}: ${matchedValue})`
        };
      }

      if (isOtherColdPipeline && effectiveRules.check_cold_leads) {
        return {
          isDuplicate: true,
          matchedLead: lead,
          matchKey: keyName,
          matchedValue,
          scope: 'other_cold_pipeline',
          reason: `Already exists in another cold pipeline (${keyName}: ${matchedValue})`
        };
      }

      if (isSalesPipeline && effectiveRules.check_sales_leads) {
        return {
          isDuplicate: true,
          matchedLead: lead,
          matchKey: keyName,
          matchedValue,
          scope: 'sales_pipeline',
          reason: `Active inbound sales lead / customer exists (${keyName}: ${matchedValue})`
        };
      }
    }
    return null;
  };

  // 1. Check Email
  if (effectiveRules.match_email && candEmail) {
    const match = checkMatch(index.byEmail.get(candEmail), 'email', candEmail);
    if (match) return match;
  }

  // 2. Check Phone
  if (effectiveRules.match_phone && candPhone && candPhone.length >= 7) {
    const match = checkMatch(index.byPhone.get(candPhone), 'phone', candPhone);
    if (match) return match;
  }

  // 3. Check Domain / Website
  if (effectiveRules.match_domain && candDomain) {
    const match = checkMatch(index.byDomain.get(candDomain), 'website domain', candDomain);
    if (match) return match;
  }

  // 4. Check LinkedIn
  if (effectiveRules.match_linkedin && candLinkedIn) {
    const match = checkMatch(index.byLinkedIn.get(candLinkedIn), 'linkedin', candLinkedIn);
    if (match) return match;
  }

  return {
    isDuplicate: false,
    matchedLead: null,
    matchKey: null,
    reason: null
  };
}

/**
 * Builds enrichment updates if on_duplicate === 'enrich'
 * Returns updated fields object if new info was discovered, or null if nothing to enrich
 */
export function buildEnrichmentPatch(existingLead, candidate) {
  const patch = {};
  const customPatch = { ...(existingLead.custom_fields || {}) };
  let hasChanges = false;

  // Enrich phone if missing
  if (!existingLead.phone && candidate.phone) {
    patch.phone = candidate.phone;
    hasChanges = true;
  }

  // Enrich email if missing
  if (!existingLead.email && candidate.email) {
    patch.email = candidate.email;
    hasChanges = true;
  }

  // Enrich company if missing
  if (!existingLead.company && candidate.company) {
    patch.company = candidate.company;
    hasChanges = true;
  }

  // Enrich custom fields (website, linkedin, designation)
  const candFields = candidate.custom_fields || {};
  for (const [key, val] of Object.entries(candFields)) {
    if (val && !customPatch[key]) {
      customPatch[key] = val;
      hasChanges = true;
    }
  }

  if (hasChanges) {
    patch.custom_fields = customPatch;
    return patch;
  }

  return null;
}

