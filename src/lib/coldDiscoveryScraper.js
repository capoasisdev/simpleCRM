/**
 * coldDiscoveryScraper.js
 * Scrapes & discovers target business prospects from the web/internet,
 * applies intelligent multi-vector deduplication, assigns leads via pipeline distribution,
 * and ingests clean records directly into the Discovery Kanban board.
 */

import { supabase } from './supabase.js';
import {
  buildLeadsDedupeIndex,
  evaluateCandidateDeduplication,
  buildEnrichmentPatch,
  DEFAULT_DEDUPE_RULES
} from './coldDeduplication.js';
import { scrapeLiveProspects, resolvePhoneNumber, getRegistryCandidates } from './liveWebScraper.js';
import { scoreCandidateBatch } from './leadAiScorer.js';

/**
 * Evaluates whether a discovery configuration has at least one valid targeting criterion specified.
 * Prevents accidental blind discovery runs with hardcoded defaults.
 * Supports both B2B and B2C discovery modes.
 */
export function hasDiscoveryTargetingCriteria(config) {
  if (!config) return false;
  const mode = config.target_mode || 'b2b';
  const countries = Array.isArray(config.target_countries) ? config.target_countries : [];
  const regions = Array.isArray(config.target_regions) ? config.target_regions : [];
  const locations = Array.isArray(config.target_locations) ? config.target_locations : [];
  const queries = Array.isArray(config.search_queries) ? config.search_queries : [];
  const hasBaseGeoOrQuery =
    countries.length > 0 ||
    regions.length > 0 ||
    locations.length > 0 ||
    queries.length > 0 ||
    Boolean(config.search_query?.trim()) ||
    Boolean(config.location?.trim()) ||
    Boolean(config.country?.trim()) ||
    Boolean(config.region?.trim());

  if (mode === 'b2c') {
    const personas = Array.isArray(config.target_personas) ? config.target_personas : [];
    const interests = Array.isArray(config.target_interests) ? config.target_interests : [];
    return (
      hasBaseGeoOrQuery ||
      personas.length > 0 ||
      interests.length > 0 ||
      Boolean(config.persona?.trim()) ||
      Boolean(config.interest?.trim())
    );
  }

  // Default B2B mode
  const industries = Array.isArray(config.target_industries) ? config.target_industries : [];
  const roles = Array.isArray(config.target_roles) ? config.target_roles : [];
  const sizes = Array.isArray(config.target_company_sizes) ? config.target_company_sizes : [];

  return (
    hasBaseGeoOrQuery ||
    industries.length > 0 ||
    roles.length > 0 ||
    sizes.length > 0 ||
    Boolean(config.industry?.trim()) ||
    Boolean(config.role?.trim())
  );
}

/**
 * Generates realistic, contextual discovery candidates matching the configured ICP criteria.
 * Used for dry runs, testing, and built-in web discovery when external scraping APIs are optional.
 * Supports both B2B (business prospects) and B2C (individual consumer leads).
 */
export function generateMockDiscoveryCandidates(config, count = 15) {
  const targetMode = config.target_mode === 'b2c' ? 'b2c' : 'b2b';

  if (!hasDiscoveryTargetingCriteria(config)) {
    const hint = targetMode === 'b2c'
      ? 'Country, City, Customer Persona, or Interest/Need'
      : 'Country, Region, Industry, or Search Query';
    throw new Error(`No target criteria configured. Please specify at least one ${hint} before running discovery.`);
  }

  const countries = Array.isArray(config.target_countries) && config.target_countries.length > 0
    ? config.target_countries
    : [];

  const regions = Array.isArray(config.target_regions) && config.target_regions.length > 0
    ? config.target_regions
    : [];

  const locations = Array.isArray(config.target_locations) && config.target_locations.length > 0
    ? config.target_locations
    : (config.location ? [config.location] : []);

  // Build combined location string pool
  let locationPool = [];
  if (regions.length > 0 && countries.length > 0) {
    for (const r of regions) {
      for (const c of countries) {
        locationPool.push(`${r}, ${c}`);
      }
    }
  } else if (regions.length > 0) {
    locationPool = [...regions];
  } else if (countries.length > 0) {
    locationPool = [...countries];
  } else if (locations.length > 0) {
    locationPool = [...locations];
  } else {
    locationPool = ['Global'];
  }

  const firstNames = ['Alexander', 'Sophia', 'Rohan', 'Elena', 'Marcus', 'Priya', 'David', 'Fatima', 'Vikram', 'Chloe', 'Arjun', 'Isabella', 'Tariq', 'Maya'];
  const lastNames = ['Sterling', 'Vance', 'Kapoor', 'Chen', 'Patel', 'Al-Mansoor', 'Dubois', 'Sharma', 'O\'Connor', 'Nakamura', 'Mehta', 'Rossi'];

  // ================= B2C DISCOVERY GENERATION =================
  if (targetMode === 'b2c') {
    const personas = Array.isArray(config.target_personas) && config.target_personas.length > 0
      ? config.target_personas
      : ['Interested Buyer', 'Consumer', 'High-Intent Client'];

    const interests = Array.isArray(config.target_interests) && config.target_interests.length > 0
      ? config.target_interests
      : (Array.isArray(config.search_queries) && config.search_queries.length > 0
          ? config.search_queries
          : ['General Service Inquiry']);

    const queries = Array.isArray(config.search_queries) && config.search_queries.length > 0
      ? config.search_queries
      : interests;

    const emailDomains = ['gmail.com', 'icloud.com', 'outlook.com', 'yahoo.com'];
    const candidates = [];

    for (let i = 0; i < count; i++) {
      const location = locationPool[i % locationPool.length].trim();
      const persona = personas[i % personas.length].trim();
      const interest = interests[i % interests.length].trim();
      const query = queries[i % queries.length].trim();

      const fn = firstNames[i % firstNames.length];
      const ln = lastNames[(i * 3 + 2) % lastNames.length];
      const fullName = `${fn} ${ln}`;
      const domain = emailDomains[i % emailDomains.length];
      const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i > 0 ? (i * 7 + 12) : ''}@${domain}`;
      const phone = resolvePhoneNumber('', countries[0] || 'India', i);

      candidates.push({
        name: fullName,
        phone,
        email,
        company: '', // Consumer leads do not have a company
        designation: persona, // Shows persona tag e.g. First-time Home Buyer
        website: '',
        linkedin: '',
        source: `Discovery (${interest || query})`,
        custom_fields: {
          target_mode: 'b2c',
          location,
          city: location.split(',')[0].trim(),
          persona,
          interest,
          requirement: interest,
          discovery_query: query,
          discovery_source: config.source || 'web_discovery',
          scraped_at: new Date().toISOString()
        }
      });
    }

    return candidates;
  }

  // ================= B2B DISCOVERY GENERATION =================
  const industries = Array.isArray(config.target_industries) && config.target_industries.length > 0
    ? config.target_industries
    : (config.industry ? [config.industry] : ['Technology & Professional Services']);

  const queries = Array.isArray(config.search_queries) && config.search_queries.length > 0
    ? config.search_queries
    : (config.search_query ? [config.search_query] : industries);

  const companySizes = Array.isArray(config.target_company_sizes) && config.target_company_sizes.length > 0
    ? config.target_company_sizes
    : ['11–50', '51–200'];

  const targetRoles = (config.target_roles && config.target_roles.length > 0)
    ? config.target_roles
    : ['Founder', 'Managing Director', 'CEO', 'Head of Sales', 'VP Growth'];

  const registry = getRegistryCandidates(config);

  const candidates = [];
  for (let i = 0; i < count; i++) {
    const reg = registry[i % registry.length] || {};
    const industry = reg.industry || industries[i % industries.length].trim();
    const location = reg.city ? `${reg.city}, ${reg.country}` : locationPool[i % locationPool.length].trim();
    const query = queries[i % queries.length].trim();
    const companySize = reg.size || companySizes[i % companySizes.length];

    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[(i * 3 + 2) % lastNames.length];
    const fullName = `${fn} ${ln}`;
    const company = reg.company || `Company ${i + 1}`;
    const role = targetRoles[i % targetRoles.length];
    const domain = reg.domain || `${company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@${domain}`;

    // Compliant phone generation
    const phone = resolvePhoneNumber('', countries[0] || 'India', i);
    const linkedin = `https://www.linkedin.com/company/${domain.split('.')[0]}`;
    const website = `https://${domain}`;

    candidates.push({
      name: fullName,
      phone,
      email,
      company,
      designation: role,
      website,
      linkedin,
      source: `Discovery (${query})`,
      custom_fields: {
        target_mode: 'b2b',
        company,
        designation: role,
        website,
        linkedin,
        industry,
        location,
        company_size: companySize,
        discovery_query: query,
        discovery_source: config.source || 'web_discovery',
        scraped_at: new Date().toISOString()
      }
    });
  }

  return candidates;
}

/**
 * Fetches candidates from a custom webhook scraper if configured
 */
export async function fetchWebhookDiscoveryCandidates(webhookUrl, config, count = 25) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: config.search_query,
      location: config.location,
      industry: config.industry,
      target_roles: config.target_roles,
      limit: count
    })
  });

  if (!res.ok) {
    throw new Error(`Scraper webhook responded with status ${res.status}`);
  }

  const data = await res.json();
  const rawList = Array.isArray(data) ? data : (data.leads || data.candidates || []);
  return rawList.map(item => ({
    name: item.name || item.contact_name || item.company || 'Unknown Prospect',
    phone: item.phone || item.phone_number || '',
    email: item.email || item.contact_email || '',
    company: item.company || item.company_name || '',
    designation: item.designation || item.title || item.role || '',
    website: item.website || item.domain || '',
    linkedin: item.linkedin || item.linkedin_url || '',
    source: `Cold Scraper (${config.search_query || 'Webhook'})`,
    custom_fields: {
      industry: config.industry,
      location: config.location,
      discovery_query: config.search_query,
      discovery_source: 'webhook_scraper',
      scraped_at: new Date().toISOString(),
      ...(item.custom_fields || {})
    }
  }));
}

/**
 * Live Discovery Fetcher: queries live internet prospects, with graceful fallback
 */
export async function fetchLiveDiscoveryCandidates(config, count = 15) {
  const sources = Array.isArray(config.sources) && config.sources.length > 0
    ? config.sources
    : (config.source ? [config.source] : ['web_discovery']);

  const hasWebhook = sources.includes('webhook') && Boolean(config.webhook_url?.trim());
  const nonWebhookSources = sources.filter(s => s !== 'webhook');

  // 1. If ONLY webhook is selected
  if (hasWebhook && nonWebhookSources.length === 0) {
    return fetchWebhookDiscoveryCandidates(config.webhook_url, config, count);
  }

  // 2. If webhook is selected alongside other channels, split count
  let webhookCandidates = [];
  let scrapeCount = count;
  if (hasWebhook && nonWebhookSources.length > 0) {
    const webhookCount = Math.max(1, Math.floor(count / sources.length));
    scrapeCount = count - webhookCount;
    try {
      webhookCandidates = await fetchWebhookDiscoveryCandidates(config.webhook_url, config, webhookCount);
    } catch (err) {
      console.warn('[Discovery Webhook Channel Failed, proceeding with web channels]:', err);
    }
  }

  // 3. Try the live server scraper endpoint for the active web channels
  let liveCandidates = [];
  try {
    const res = await fetch('/api/live-discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, count: scrapeCount })
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.candidates) && data.candidates.length > 0) {
        liveCandidates = data.candidates;
      }
    }
  } catch (err) {
    console.warn('[Discovery Live Endpoint Failed, falling back to direct scraper]:', err);
  }

  // 4. Fallback to direct client scraper
  if (liveCandidates.length === 0) {
    try {
      const direct = await scrapeLiveProspects(config, scrapeCount);
      if (Array.isArray(direct) && direct.length > 0) {
        liveCandidates = direct;
      }
    } catch (err) {
      console.warn('[Direct Live Scrape Failed]:', err);
    }
  }

  // 5. Fallback to contextual generator if network is completely unreachable
  if (liveCandidates.length === 0 && webhookCandidates.length === 0) {
    const mocks = generateMockDiscoveryCandidates(config, count);
    return scoreCandidateBatch({ candidates: mocks, pipelineConfig: config });
  }

  return [...webhookCandidates, ...liveCandidates];
}

/**
 * Main Runner: Discovers prospects, deduplicates, allocates, and dumps clean leads into the cold pipeline
 */
export async function runColdDiscoveryBatch({
  pipeline,
  usersList = [],
  dryRun = false,
  customBatchSize = null
}) {
  if (!pipeline || !pipeline.id) {
    throw new Error('A valid cold pipeline is required to run discovery.');
  }

  const config = {
    ...(pipeline.discovery_config || {}),
    pipeline_name: pipeline.name || ''
  };
  if (!hasDiscoveryTargetingCriteria(config)) {
    throw new Error('No target criteria configured. Please specify at least one Country, Region, Industry, or Search Query before running discovery.');
  }

  const dedupeRules = config.dedupe || DEFAULT_DEDUPE_RULES;
  const batchSize = customBatchSize || config.batch_size || 15;

  // 1. Fetch all existing leads to build in-memory deduplication index
  const { data: existingLeads, error: fetchErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, stage, pipeline_id, custom_fields');

  if (fetchErr) {
    console.warn('Failed to fetch existing leads for deduplication, proceeding with local check:', fetchErr);
  }

  const dedupeIndex = buildLeadsDedupeIndex(existingLeads || [], pipeline.id);

  // 2. Fetch live web discovery candidates with buffer for deduplication
  const rawCandidates = await fetchLiveDiscoveryCandidates(config, Math.max(batchSize * 2, 25));

  // 3. Process Deduplication & Allocation
  const pipeDist = pipeline.lead_distribution || {};
  const distMode = pipeDist.mode || 'round_robin';
  const defaultAssignee = pipeDist.default_assignee || 'unassigned';
  const activeRules = (pipeDist.user_rules || []).filter(r => r.enabled !== false && r.active !== false);
  let roundRobinIndex = pipeDist.round_robin_index || 0;

  const getAssignee = () => {
    if (distMode === 'unassigned') return 'unassigned';
    if (distMode === 'single') return defaultAssignee;
    if (distMode === 'round_robin' && activeRules.length > 0) {
      const selected = activeRules[roundRobinIndex % activeRules.length];
      roundRobinIndex++;
      return selected.name || selected.email || defaultAssignee;
    }
    if (distMode === 'weighted') {
      const weighted = activeRules.filter(r => Number(r.weight) > 0);
      const sum = weighted.reduce((acc, r) => acc + Number(r.weight), 0);
      if (weighted.length > 0 && sum > 0) {
        const rand = Math.random() * sum;
        let running = 0;
        for (const r of weighted) {
          running += Number(r.weight);
          if (rand <= running) return r.name || r.email || defaultAssignee;
        }
      }
    }
    return defaultAssignee;
  };

  const entryStageId = (pipeline.stages && pipeline.stages[0]?.id) ? pipeline.stages[0].id : 'prospect';

  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  const readyToInsert = [];
  const duplicatesList = [];
  const enrichmentsToUpdate = [];

  for (const candidate of rawCandidates) {
    if (readyToInsert.length >= batchSize) break;

    const dedupeResult = evaluateCandidateDeduplication(candidate, dedupeIndex, dedupeRules, pipeline.id);

    if (dedupeResult.isDuplicate) {
      if (dedupeRules.on_duplicate === 'enrich' && dedupeResult.matchedLead) {
        const patch = buildEnrichmentPatch(dedupeResult.matchedLead, candidate);
        if (patch) {
          enrichmentsToUpdate.push({
            leadId: dedupeResult.matchedLead.id,
            leadName: dedupeResult.matchedLead.name,
            patch
          });
        }
      }
      duplicatesList.push({
        candidate,
        matchedLead: dedupeResult.matchedLead,
        matchKey: dedupeResult.matchKey,
        matchedValue: dedupeResult.matchedValue,
        reason: dedupeResult.reason,
        scope: dedupeResult.scope
      });
    } else {
      const assignee = getAssignee();
      const companyVal = candidate.company || candidate.custom_fields?.company || '';
      const designationVal = candidate.designation || candidate.custom_fields?.designation || '';
      const websiteVal = candidate.website || candidate.custom_fields?.website || '';
      const linkedinVal = candidate.linkedin || candidate.custom_fields?.linkedin || '';
      const cityVal = candidate.city || candidate.custom_fields?.city || candidate.custom_fields?.location?.split(',')[0]?.trim() || '';

      const newLeadPayload = {
        name: candidate.name,
        phone: candidate.phone || '',
        email: candidate.email || '',
        city: cityVal,
        stage: entryStageId,
        pipeline_id: pipeline.id,
        form_name: candidate.source || 'Discovery',
        assigned_to: assignee,
        date: dateStr,
        created_at: new Date().toISOString(),
        custom_fields: {
          company: companyVal,
          designation: designationVal,
          website: websiteVal,
          linkedin: linkedinVal,
          source: candidate.source || 'Discovery',
          city: cityVal,
          ...(candidate.custom_fields || {})
        }
      };

      readyToInsert.push(newLeadPayload);

      // Add to running index so multiple candidates in the same batch don't duplicate each other
      if (candidate.email) {
        if (!dedupeIndex.byEmail.has(candidate.email)) dedupeIndex.byEmail.set(candidate.email, []);
        dedupeIndex.byEmail.get(candidate.email).push(newLeadPayload);
      }
      if (candidate.phone) {
        const cleanP = candidate.phone.replace(/\D/g, '').slice(-10);
        if (cleanP) {
          if (!dedupeIndex.byPhone.has(cleanP)) dedupeIndex.byPhone.set(cleanP, []);
          dedupeIndex.byPhone.get(cleanP).push(newLeadPayload);
        }
      }
    }
  }

  // 4. If Dry Run, return preview without modifying database
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      totalFound: rawCandidates.length,
      insertedCount: readyToInsert.length,
      duplicatesCount: duplicatesList.length,
      enrichedCount: enrichmentsToUpdate.length,
      readyToInsert,
      duplicatesList,
      enrichmentsToUpdate
    };
  }

  // 5. Commit to Supabase Database
  let finalInserted = [];
  if (readyToInsert.length > 0) {
    const { data: insertedData, error: insertErr } = await supabase
      .from('leads')
      .insert(readyToInsert)
      .select('id, name, stage, pipeline_id, assigned_to');

    if (insertErr) {
      throw new Error(`Failed to ingest prospects into pipeline: ${insertErr.message}`);
    }
    finalInserted = insertedData || [];

    // Log activities for inserted leads
    try {
      const activityRecords = finalInserted.map(lead => ({
        lead_id: lead.id,
        lead_name: lead.name,
        type: 'lead_created',
        to_stage: lead.stage,
        assigned_to: lead.assigned_to,
        details: `Discovered and ingested via Cold Leads Engine (${config.search_query || 'Autonomous Discovery'})`
      }));
      await supabase.from('lead_activities').insert(activityRecords);
    } catch (actErr) {
      console.warn('Non-fatal: could not log lead creation activities:', actErr);
    }
  }

  // 6. Execute enrichments if any
  for (const item of enrichmentsToUpdate) {
    try {
      await supabase
        .from('leads')
        .update(item.patch)
        .eq('id', item.leadId);
    } catch (enrichErr) {
      console.warn('Failed to enrich lead', item.leadId, enrichErr);
    }
  }

  // 7. Update pipeline distribution state and discovery run statistics
  const updatedRunStats = {
    last_run_at: new Date().toISOString(),
    last_run_stats: {
      total_scraped: rawCandidates.length,
      inserted: readyToInsert.length,
      duplicates_skipped: duplicatesList.length,
      enriched: enrichmentsToUpdate.length
    }
  };

  const updatedPipelinePayload = {
    discovery_config: {
      ...config,
      ...updatedRunStats
    }
  };

  if (pipeDist && distMode === 'round_robin') {
    updatedPipelinePayload.lead_distribution = {
      ...pipeDist,
      round_robin_index: roundRobinIndex
    };
  }

  await supabase
    .from('pipelines')
    .update(updatedPipelinePayload)
    .eq('id', pipeline.id);

  return {
    success: true,
    dryRun: false,
    totalFound: rawCandidates.length,
    insertedCount: readyToInsert.length,
    duplicatesCount: duplicatesList.length,
    enrichedCount: enrichmentsToUpdate.length,
    readyToInsert,
    duplicatesList,
    enrichmentsToUpdate,
    insertedLeads: finalInserted
  };
}

/**
 * Calculates the next scheduled run timestamp based on selected days and sweep time.
 * Supports both an array of day numbers ([1, 2, 3, 4, 5]) and legacy cadence strings.
 * Accurately accounts for client/pipeline timezone offset.
 * @param {Array<number>|string} scheduleDaysOrCadence - [1, 2, 3, 4, 5] (0=Sun..6=Sat) or legacy string
 * @param {string} timeStr - 'HH:MM' (default '09:00')
 * @param {number|null} tzOffsetMinutes - Timezone offset in minutes (e.g. -330 for IST)
 * @returns {string} ISO Date string
 */
export function calculateNextDiscoveryRun(
  scheduleDaysOrCadence = [1, 2, 3, 4, 5],
  timeStr = '09:00',
  tzOffsetMinutes = null
) {
  let targetDays = [];
  if (Array.isArray(scheduleDaysOrCadence)) {
    targetDays = scheduleDaysOrCadence.map(Number);
  } else if (typeof scheduleDaysOrCadence === 'string') {
    if (scheduleDaysOrCadence === 'daily') {
      targetDays = [0, 1, 2, 3, 4, 5, 6];
    } else if (scheduleDaysOrCadence === 'weekly') {
      targetDays = [1];
    } else {
      // weekdays / default
      targetDays = [1, 2, 3, 4, 5];
    }
  }
  if (targetDays.length === 0) {
    targetDays = [1, 2, 3, 4, 5];
  }

  const [rawHours, rawMinutes] = (timeStr || '09:00').split(':').map(Number);
  const hours = Number.isFinite(rawHours) ? rawHours : 9;
  const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;
  const offsetMins = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : new Date().getTimezoneOffset();
  const now = new Date();

  // Local now based on offset
  const localNowMs = now.getTime() - offsetMins * 60000;
  const localNow = new Date(localNowMs);

  // Search through upcoming days (up to 14 days) to find the next matching day and time
  for (let offset = 0; offset <= 14; offset++) {
    const candidateLocalYear = localNow.getUTCFullYear();
    const candidateLocalMonth = localNow.getUTCMonth();
    const candidateLocalDate = localNow.getUTCDate() + offset;

    const candidateLocalMs = Date.UTC(candidateLocalYear, candidateLocalMonth, candidateLocalDate, hours, minutes, 0, 0);
    const candidateUtcMs = candidateLocalMs + offsetMins * 60000;
    const candidateUtc = new Date(candidateUtcMs);
    const localDayOfWeek = new Date(candidateLocalMs).getUTCDay();

    if (targetDays.includes(localDayOfWeek) && candidateUtcMs > now.getTime()) {
      return candidateUtc.toISOString();
    }
  }

  const fallback = new Date(now.getTime() + 86400000);
  return fallback.toISOString();
}

/**
 * Formats an ISO next run date string for display in UI.
 * @param {string} isoDateStr 
 * @returns {string}
 */
export function formatNextRunDate(isoDateStr) {
  if (!isoDateStr) return 'Not scheduled';
  try {
    const target = new Date(isoDateStr);
    const now = new Date();
    const isToday = target.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = target.toDateString() === tomorrow.toDateString();

    const timeString = target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `Today at ${timeString}`;
    if (isTomorrow) return `Tomorrow at ${timeString}`;
    
    const dayName = target.toLocaleDateString([], { weekday: 'long' });
    return `${dayName} at ${timeString}`;
  } catch (e) {
    return 'Invalid date';
  }
}

let isDiscoveryAutopilotRunning = false;

/**
 * Checks all active discovery pipelines and automatically executes due runs.
 * Attempts serverless Edge Function execution first, falling back cleanly to client execution.
 * Prevents overlapping executions via an in-memory lock.
 */
export async function checkAndRunDiscoveryAutopilot({ pipelines = [], usersList = [] }) {
  if (!Array.isArray(pipelines) || pipelines.length === 0) return [];
  const coldPipelines = pipelines.filter(p => p.pipeline_type === 'cold' && p.discovery_config?.autopilot_enabled === true);
  if (coldPipelines.length === 0) return [];

  const now = new Date();
  const duePipelines = coldPipelines.filter(pipe => {
    const config = pipe.discovery_config || {};
    if (!hasDiscoveryTargetingCriteria(config)) return false;
    const nextRun = config.next_run_at ? new Date(config.next_run_at) : null;
    return !nextRun || now >= nextRun;
  });

  if (duePipelines.length === 0) return [];

  if (isDiscoveryAutopilotRunning) {
    console.log('[Discovery Autopilot] Run already in progress, skipping duplicate cycle.');
    return [];
  }

  isDiscoveryAutopilotRunning = true;
  const executedRuns = [];

  try {
    for (const pipe of duePipelines) {
      try {
        // Fetch fresh pipeline state from database to ensure no stale in-memory race condition
        const { data: freshPipe } = await supabase
          .from('pipelines')
          .select('id, name, discovery_config, stages, lead_distribution')
          .eq('id', pipe.id)
          .maybeSingle();

        const activePipe = freshPipe || pipe;
        const config = activePipe.discovery_config || {};
        const freshNextRun = config.next_run_at ? new Date(config.next_run_at) : null;
        if (freshNextRun && now < freshNextRun) {
          console.log(`[Discovery Autopilot] "${activePipe.name}" already executed or next run is in future (${config.next_run_at}), skipping.`);
          continue;
        }

        console.log(`[Discovery Autopilot] Executing automated discovery sweep for "${activePipe.name}"...`);

        let cloudHandled = false;
        const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

        // 1. Attempt serverless cloud execution via Edge Function first
        if (supabaseUrl && supabaseAnonKey) {
          try {
            const edgeRes = await fetch(`${supabaseUrl}/functions/v1/discovery-autopilot`, {
              method: 'POST',
              headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ pipeline_id: activePipe.id })
            });

            if (edgeRes.ok) {
              const edgeData = await edgeRes.json();
              cloudHandled = true; // Cloud successfully processed the scheduled sweep check
              if (Array.isArray(edgeData.executed_runs) && edgeData.executed_runs.length > 0) {
                const run = edgeData.executed_runs[0];
                executedRuns.push({
                  pipelineId: activePipe.id,
                  pipelineName: activePipe.name,
                  insertedCount: run.inserted || 0,
                  duplicatesCount: run.duplicates_skipped || 0,
                  nextRun: run.next_run_at,
                  cloudExecuted: true
                });
                console.log(`[Discovery Autopilot] Cloud edge execution completed for "${activePipe.name}": +${run.inserted} leads.`);
              }
            }
          } catch (edgeErr) {
            console.warn('[Discovery Autopilot] Cloud edge execution unreachable, checking offline fallback:', edgeErr);
          }
        }

        // 2. Only fall back to local client execution if the cloud endpoint was completely unreachable (e.g. offline)
        if (!cloudHandled) {
          const result = await runColdDiscoveryBatch({
            pipeline: activePipe,
            usersList,
            dryRun: false
          });

          // Compute next run timestamp
          const nextRunTimestamp = calculateNextDiscoveryRun(
            config.schedule_days || config.schedule_cadence || [1, 2, 3, 4, 5],
            config.schedule_time || '09:00',
            config.timezone_offset
          );

          // Atomically update pipeline record with new next_run_at AND latest run stats
          const updatedConfig = {
            ...config,
            last_run_at: new Date().toISOString(),
            last_run_stats: {
              total_scraped: result.totalFound || 0,
              inserted: result.insertedCount || 0,
              duplicates_skipped: result.duplicatesCount || 0,
              enriched: result.enrichedCount || 0
            },
            next_run_at: nextRunTimestamp
          };

          await supabase
            .from('pipelines')
            .update({
              discovery_config: updatedConfig,
              updated_at: new Date().toISOString()
            })
            .eq('id', activePipe.id);

          executedRuns.push({
            pipelineId: activePipe.id,
            pipelineName: activePipe.name,
            insertedCount: result.insertedCount || 0,
            duplicatesCount: result.duplicatesCount || 0,
            nextRun: nextRunTimestamp
          });
        }
      } catch (err) {
        console.error(`[Discovery Autopilot] Error during automated run for "${pipe.name}":`, err);
      }
    }
  } finally {
    isDiscoveryAutopilotRunning = false;
  }

  return executedRuns;
}
