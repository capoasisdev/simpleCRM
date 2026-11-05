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
import { fetchSerperGooglePlaces } from './serperDiscovery.js';
import { scoreCandidateBatch } from './leadAiScorer.js';

/**
 * Evaluates whether a discovery configuration has at least one valid targeting criterion specified.
 * Supports Lead Drip Buffer, Roles, Categories, Locations, or Queries.
 */
export function hasDiscoveryTargetingCriteria(config) {
  if (!config) return false;
  if (Array.isArray(config.drip_buffer) && config.drip_buffer.length > 0) return true;

  const hasRole = Boolean(
    config.role?.trim() ||
    (Array.isArray(config.target_roles) && config.target_roles.length > 0)
  );

  const hasIndustry = Boolean(
    config.industry?.trim() ||
    (Array.isArray(config.target_industries) && config.target_industries.length > 0)
  );

  const hasQuery = Boolean(
    config.search_query?.trim() ||
    (Array.isArray(config.search_queries) && config.search_queries.length > 0)
  );

  const hasLocation = Boolean(
    config.location?.trim() ||
    config.region?.trim() ||
    config.country?.trim() ||
    (Array.isArray(config.target_regions) && config.target_regions.length > 0) ||
    (Array.isArray(config.target_countries) && config.target_countries.length > 0) ||
    (Array.isArray(config.target_locations) && config.target_locations.length > 0)
  );

  return hasRole || hasIndustry || hasQuery || hasLocation;
}

/**
 * Zero Fake Data Policy: Mock discovery generator is permanently disabled.
 * The system strictly imports genuine public business listings or leads from the Lead Drip Buffer.
 */
export function generateMockDiscoveryCandidates(config, count = 15) {
  return [];
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
 * Expands target locations, translating abstract presets into real metropolitan cities.
 */
export function expandTargetLocations(regions = [], country = 'India') {
  const isIndia = /india|\bin\b/i.test(country);
  const isUS = /united states|usa|\bus\b/i.test(country);
  const isUK = /united kingdom|uk|\bgb\b/i.test(country);

  const metroPresets = {
    in: ['Bengaluru', 'Mumbai', 'Pune', 'Delhi NCR', 'Hyderabad', 'Chennai'],
    us: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami', 'San Francisco'],
    uk: ['London', 'Manchester', 'Birmingham', 'Leeds']
  };

  const hubPresets = {
    in: ['Ahmedabad', 'Kolkata', 'Jaipur', 'Indore', 'Kochi', 'Chandigarh'],
    us: ['Austin', 'Seattle', 'Denver', 'Atlanta', 'Boston'],
    uk: ['Bristol', 'Glasgow', 'Edinburgh', 'Liverpool']
  };

  const activeMetros = isUS ? metroPresets.us : (isUK ? metroPresets.uk : metroPresets.in);
  const activeHubs = isUS ? hubPresets.us : (isUK ? hubPresets.uk : hubPresets.in);

  const rawList = Array.isArray(regions) ? regions : (regions ? [regions] : []);
  const results = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    if (/major metros/i.test(trimmed)) {
      results.push(...activeMetros);
    } else if (/regional hubs/i.test(trimmed)) {
      results.push(...activeHubs);
    } else if (/all regions|worldwide|global/i.test(trimmed)) {
      results.push(activeMetros[0]);
    } else {
      results.push(trimmed);
    }
  }

  const unique = Array.from(new Set(results));
  return unique.length > 0 ? unique : [activeMetros[0]];
}

/**
 * Extracts and deduplicates all distinct business categories and search keywords.
 */
export function extractTargetCategories(config = {}) {
  const categories = [];

  const rawQueries = Array.isArray(config.search_queries) ? config.search_queries : (config.search_query ? [config.search_query] : []);
  const rawIndustries = Array.isArray(config.target_industries) ? config.target_industries : (config.industry ? [config.industry] : []);

  // 1. First add explicit search keywords/queries
  for (const q of rawQueries) {
    if (q && typeof q === 'string' && q.trim()) {
      const trimmed = q.trim();
      if (!categories.includes(trimmed)) categories.push(trimmed);
    }
  }

  // 2. Add industries that aren't already represented
  for (const ind of rawIndustries) {
    if (ind && typeof ind === 'string' && ind.trim()) {
      const trimmed = ind.trim();
      const isAlreadyCovered = categories.some(
        c => c.toLowerCase() === trimmed.toLowerCase()
      );
      if (!isAlreadyCovered) {
        categories.push(trimmed);
      }
    }
  }

  return categories.length > 0 ? categories : ['Commercial Businesses'];
}

/**
 * Builds an interleaved queue of search tasks across all categories, cities, and pagination depths.
 */
export function buildDiscoveryQueryPlan(config = {}) {
  const searchCountry = (config.target_countries && config.target_countries[0]) || config.country || 'India';
  const cities = expandTargetLocations(config.target_regions || [config.location], searchCountry);
  const categories = extractTargetCategories(config);

  const tasks = [];

  // Round 1: Page 1 across all categories in City 1, then City 2, etc.
  for (const city of cities) {
    for (const category of categories) {
      tasks.push({
        category,
        location: city,
        country: searchCountry,
        page: 1
      });
    }
  }

  // Round 2: Page 2 for primary cities to ensure sufficient depth if duplicates are encountered
  for (const city of cities.slice(0, 3)) {
    for (const category of categories) {
      tasks.push({
        category,
        location: city,
        country: searchCountry,
        page: 2
      });
    }
  }

  return tasks;
}

/**
 * Live Discovery Fetcher: queries Google Places across multiple categories and cities with zero fake data.
 */
export async function fetchLiveDiscoveryCandidates(config, count = 15) {
  // 1. If custom webhook is explicitly configured, query it
  if (config.webhook_url && config.webhook_url.trim()) {
    try {
      const webhookCandidates = await fetchWebhookDiscoveryCandidates(config.webhook_url, config, count);
      if (webhookCandidates.length > 0) return webhookCandidates;
    } catch (err) {
      console.warn('[Discovery Webhook Failed, proceeding with Google Places]:', err);
    }
  }

  // 2. Multi-category Google Places Discovery powered by Serper
  const queryTasks = buildDiscoveryQueryPlan(config);
  const collectedPlaces = [];
  const seenPlaceKeys = new Set();

  for (const task of queryTasks) {
    if (collectedPlaces.length >= count) break;
    try {
      const places = await fetchSerperGooglePlaces({
        query: task.category,
        location: task.location,
        country: task.country,
        page: task.page,
        count: Math.min(20, count - collectedPlaces.length)
      });

      if (Array.isArray(places)) {
        for (const p of places) {
          const key = (p.phone || p.name || p.company || '').toLowerCase().trim();
          if (key && !seenPlaceKeys.has(key)) {
            seenPlaceKeys.add(key);
            collectedPlaces.push(p);
            if (collectedPlaces.length >= count) break;
          }
        }
      }
    } catch (err) {
      console.warn(`[Serper query failed for "${task.category} in ${task.location}"]:`, err);
    }
  }

  if (collectedPlaces.length > 0) {
    return await scoreCandidateBatch({ candidates: collectedPlaces, pipelineConfig: config });
  }
  return [];
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
  const dripBuffer = Array.isArray(config.drip_buffer) ? config.drip_buffer : [];
  const hasDrip = dripBuffer.length > 0;

  if (!hasDrip && !hasDiscoveryTargetingCriteria(config)) {
    throw new Error('No target criteria or drip buffer configured. Please specify targeting criteria or upload prospects to the Lead Drip Buffer.');
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

  // 2. Set up allocation and pipeline parameters
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
  let totalCandidatesEvaluated = 0;

  let isFromDripBuffer = false;
  let remainingDripBuffer = null;

  // Process candidate helper
  const processCandidate = (candidate) => {
    if (readyToInsert.length >= batchSize) return false;
    totalCandidatesEvaluated++;

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
      return true;
    }

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

    return true;
  };

  // 3. Lead Fulfillment Loop
  if (hasDrip) {
    const dripSlice = dripBuffer.slice(0, batchSize * 2);
    for (const candidate of dripSlice) {
      if (readyToInsert.length >= batchSize) break;
      processCandidate(candidate);
    }
    remainingDripBuffer = dripBuffer.slice(readyToInsert.length);
    isFromDripBuffer = true;
  } else {
    // Multi-category, multi-city dynamic batch fulfillment loop
    const queryTasks = buildDiscoveryQueryPlan(config);
    const maxTasksToRun = Math.min(queryTasks.length, 12); // Safety cap to avoid infinite loops

    for (let taskIdx = 0; taskIdx < maxTasksToRun; taskIdx++) {
      if (readyToInsert.length >= batchSize) break;

      const task = queryTasks[taskIdx];
      try {
        const places = await fetchSerperGooglePlaces({
          query: task.category,
          location: task.location,
          country: task.country,
          page: task.page,
          count: 20
        });

        if (Array.isArray(places) && places.length > 0) {
          const scoredBatch = await scoreCandidateBatch({ candidates: places, pipelineConfig: config });
          for (const candidate of scoredBatch) {
            if (readyToInsert.length >= batchSize) break;
            processCandidate(candidate);
          }
        }
      } catch (taskErr) {
        console.warn(`[Discovery task failed for "${task.category} in ${task.location}"]:`, taskErr);
      }
    }
  }

  // 4. If Dry Run, return preview without modifying database
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      totalFound: totalCandidatesEvaluated,
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
      total_scraped: totalCandidatesEvaluated,
      inserted: readyToInsert.length,
      duplicates_skipped: duplicatesList.length,
      enriched: enrichmentsToUpdate.length
    }
  };

  const updatedPipelinePayload = {
    discovery_config: {
      ...config,
      ...(isFromDripBuffer && remainingDripBuffer !== null ? { drip_buffer: remainingDripBuffer } : {}),
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
    totalFound: totalCandidatesEvaluated,
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
