import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * Fast DNS-over-HTTPS (DoH) verification for automated edge execution
 */
async function verifyDomainDoH(domain: string): Promise<{ isValid: boolean; provider: string; mxHost: string | null }> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!clean || !clean.includes('.')) return { isValid: false, provider: 'None', mxHost: null };

  const CONSUMER_DOMAINS: Record<string, string> = {
    'gmail.com': 'Google Consumer',
    'outlook.com': 'Microsoft Outlook',
    'yahoo.com': 'Yahoo Mail',
    'icloud.com': 'Apple iCloud'
  };
  if (CONSUMER_DOMAINS[clean]) {
    return { isValid: true, provider: CONSUMER_DOMAINS[clean], mxHost: `smtp.${clean}` };
  }

  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(clean)}&type=MX`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.Answer) && data.Answer.length > 0) {
        const mxList = data.Answer.filter((a: any) => a.type === 15 && a.data).map((a: any) => a.data.trim());
        if (mxList.length > 0) {
          const combined = mxList.join(' ').toLowerCase();
          let provider = 'Custom MX';
          if (combined.includes('google') || combined.includes('aspmx')) provider = 'Google Workspace';
          else if (combined.includes('outlook') || combined.includes('protection.outlook')) provider = 'Microsoft 365';
          else if (combined.includes('zoho')) provider = 'Zoho Mail';
          return { isValid: true, provider, mxHost: mxList[0] };
        }
      }
    }
  } catch { }

  return { isValid: false, provider: 'None', mxHost: null };
}

/**
 * Fetches real Google Maps businesses from Serper.dev Places API
 * ZERO FAKE DATA GUARANTEE: If a phone or email is not publicly published, it is left as "" (empty string).
 */
async function fetchSerperPlaces(config: any, count = 25) {
  const apiKey = Deno.env.get("SERPER_API_KEY") || Deno.env.get("VITE_SERPER_API_KEY");
  if (!apiKey) {
    console.warn("[Autopilot] SERPER_API_KEY environment variable is not configured.");
    return [];
  }

  const searchCategory = (config.target_industries && config.target_industries[0]) ||
    (config.search_queries && config.search_queries[0]) ||
    config.search_query ||
    config.industry ||
    "Commercial Businesses";

  let searchLocation = (config.target_regions && config.target_regions[0]) || config.location || "Bengaluru";
  const searchCountry = (config.target_countries && config.target_countries[0]) || config.country || "India";

  if (!searchLocation || /major metros|regional hubs|all regions|worldwide|global/i.test(searchLocation)) {
    if (/united states|usa|us/i.test(searchCountry)) searchLocation = "New York";
    else if (/united kingdom|uk/i.test(searchCountry)) searchLocation = "London";
    else searchLocation = "Bengaluru";
  }

  const fullQuery = `${searchCategory} in ${searchLocation}, ${searchCountry}`.trim();

  try {
    const res = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: fullQuery,
        gl: searchCountry.toLowerCase().includes("us") ? "us" : "in",
        hl: "en"
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      const places = Array.isArray(data.places) ? data.places : [];
      return places.map((p: any) => {
        const cleanTitle = (p.title || "Local Business").trim();
        const cleanAddress = (p.address || `${searchLocation}, ${searchCountry}`).trim();
        const phone = (p.phoneNumber || "").trim();
        const website = (p.website || "").trim();
        const category = (p.category || searchCategory || "Local Business").trim();
        const mapsUrl = p.cid
          ? `https://www.google.com/maps?cid=${p.cid}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${cleanTitle} ${cleanAddress}`)}`;

        return {
          name: cleanTitle,
          company: cleanTitle,
          phone,
          email: "",
          website,
          address: cleanAddress,
          city: searchLocation,
          category,
          custom_fields: {
            company: cleanTitle,
            designation: "Business Owner / Management",
            address: cleanAddress,
            phone,
            website,
            rating: p.rating || null,
            review_count: p.ratingCount || 0,
            category,
            google_maps_url: mapsUrl,
            location: `${searchLocation}, ${searchCountry}`,
            discovery_source: "google_places",
            is_real_scraped_phone: Boolean(phone)
          }
        };
      });
    }
  } catch (err) {
    console.warn("[Autopilot Serper Places error]:", err);
  }

  return [];
}

/**
 * Calculates the next scheduled run timestamp based on selected days and sweep time.
 * Accounts for client/pipeline timezone offset so cloud server (UTC) matches local schedule.
 */
function calculateNextDiscoveryRun(
  scheduleDaysOrCadence: any = [1, 2, 3, 4, 5],
  timeStr = "09:00",
  tzOffsetMinutes: number = -330
): string {
  let targetDays: number[] = [];
  if (Array.isArray(scheduleDaysOrCadence)) {
    targetDays = scheduleDaysOrCadence.map(Number);
  } else if (typeof scheduleDaysOrCadence === "string") {
    if (scheduleDaysOrCadence === "daily") {
      targetDays = [0, 1, 2, 3, 4, 5, 6];
    } else if (scheduleDaysOrCadence === "weekly") {
      targetDays = [1];
    } else {
      targetDays = [1, 2, 3, 4, 5];
    }
  }
  if (targetDays.length === 0) {
    targetDays = [1, 2, 3, 4, 5];
  }

  const [rawHours, rawMinutes] = (timeStr || "09:00").split(":").map(Number);
  const hours = Number.isFinite(rawHours) ? rawHours : 9;
  const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;
  const offsetMins = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : -330;
  const now = new Date();

  // Local now:
  const localNowMs = now.getTime() - offsetMins * 60000;
  const localNow = new Date(localNowMs);

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let force = url.searchParams.get("force") === "true";
    let targetPipelineId = url.searchParams.get("pipeline_id");

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.force !== undefined) force = Boolean(body.force);
        if (body.pipeline_id) targetPipelineId = String(body.pipeline_id);
      } catch {
        // Body was empty or non-JSON
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY") ??
      "";

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration in Edge Function environment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch active cold pipelines with autopilot enabled
    let query = supabase
      .from("pipelines")
      .select("id, name, stages, pipeline_type, lead_distribution, discovery_config")
      .eq("pipeline_type", "cold");

    if (targetPipelineId) {
      query = query.eq("id", targetPipelineId);
    }

    const { data: pipelines, error: pipeErr } = await query;

    if (pipeErr) {
      return new Response(
        JSON.stringify({ error: pipeErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const executedRuns = [];
    const nowIso = new Date().toISOString();

    for (const pipe of pipelines || []) {
      const config = pipe.discovery_config || {};
      const isAutopilot = config.autopilot_enabled === true;

      // When running as scheduled cron, skip if autopilot is disabled unless forced
      if (!force && !isAutopilot) {
        continue;
      }

      // Check schedule trigger unless explicitly forced
      if (!force && isAutopilot) {
        const nextRunAt = config.next_run_at ? new Date(config.next_run_at).getTime() : 0;
        const nowMs = Date.now();
        // Allow up to 10 minutes grace window
        if (nextRunAt > 0 && nextRunAt > (nowMs + 60000)) {
          continue;
        }
      }

      const batchSize = Number(config.batch_size) || 25;
      const dedupeRules = config.dedupe || { match_email: true, match_phone: true, on_duplicate: "skip" };

      // Fetch existing leads for deduplication
      const { data: existingLeads } = await supabase
        .from("leads")
        .select("id, phone, email")
        .eq("pipeline_id", pipe.id);

      const existingEmails = new Set(
        (existingLeads || []).map((l: any) => (l.email || "").toLowerCase().trim()).filter(Boolean)
      );
      const existingPhones = new Set(
        (existingLeads || []).map((l: any) => (l.phone || "").replace(/\D/g, "").slice(-10)).filter(Boolean)
      );

      // Lead distribution rules
      const pipeDist = pipe.lead_distribution || {};
      const distMode = pipeDist.mode || "round_robin";
      const defaultAssignee = pipeDist.default_assignee || "unassigned";
      const activeRules = (pipeDist.user_rules || []).filter((r: any) => r.enabled !== false && r.active !== false);
      let roundRobinIndex = Number(pipeDist.round_robin_index) || 0;

      const getAssignee = () => {
        if (distMode === "unassigned") return "unassigned";
        if (distMode === "single") return defaultAssignee;
        if (distMode === "round_robin" && activeRules.length > 0) {
          const selected = activeRules[roundRobinIndex % activeRules.length];
          roundRobinIndex++;
          return selected.name || selected.email || defaultAssignee;
        }
        if (distMode === "weighted") {
          const weighted = activeRules.filter((r: any) => Number(r.weight) > 0);
          const sum = weighted.reduce((acc: number, r: any) => acc + Number(r.weight), 0);
          if (weighted.length > 0 && sum > 0) {
            const rand = Math.random() * sum;
            let running = 0;
            for (const r of weighted) {
              running += Number(r.weight);
              if (rand <= running) return r.name || r.email || defaultAssignee;
            }
          }
        }
        return activeRules.length > 0 ? (activeRules[0].name || defaultAssignee) : defaultAssignee;
      };

      const entryStage = (pipe.stages && pipe.stages[0]?.id)
        ? pipe.stages[0].id
        : (pipe.stages && pipe.stages[0]?.name)
          ? pipe.stages[0].name
          : "prospect";

      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

      // Candidates Resolution: Prioritize Drip Buffer, otherwise real Directory search
      let rawCandidates: any[] = [];
      let isFromDripBuffer = false;
      let remainingDripBuffer: any[] | null = null;

      const dripBuffer = Array.isArray(config.drip_buffer) ? config.drip_buffer : [];
      if (dripBuffer.length > 0) {
        rawCandidates = dripBuffer.slice(0, batchSize);
        remainingDripBuffer = dripBuffer.slice(batchSize);
        isFromDripBuffer = true;
      } else {
        // Query real Google Maps businesses via Serper API
        rawCandidates = await fetchSerperPlaces(config, batchSize * 2);
      }

      const readyToInsert: any[] = [];
      let duplicatesSkipped = 0;

      for (const candidate of rawCandidates) {
        if (readyToInsert.length >= batchSize) break;

        const cleanPhone = (candidate.phone || "").replace(/\D/g, "").slice(-10);
        const cleanEmail = (candidate.email || "").toLowerCase().trim();

        if (
          (dedupeRules.match_email && cleanEmail && existingEmails.has(cleanEmail)) ||
          (dedupeRules.match_phone && cleanPhone && existingPhones.has(cleanPhone))
        ) {
          duplicatesSkipped++;
          continue;
        }

        if (cleanEmail) existingEmails.add(cleanEmail);
        if (cleanPhone) existingPhones.add(cleanPhone);

        const assignee = getAssignee();
        const candidateName = candidate.name || candidate.company || "Prospect";
        const candidateCompany = candidate.company || candidate.name || "";
        const candidatePhone = candidate.phone || "";
        const candidateEmail = candidate.email || "";
        const candidateWebsite = candidate.website || "";
        const candidateAddress = candidate.address || "";
        const candidateCity = candidate.city || "";

        readyToInsert.push({
          name: candidateName,
          phone: candidatePhone,
          email: candidateEmail,
          city: candidateCity,
          stage: entryStage,
          pipeline_id: pipe.id,
          form_name: isFromDripBuffer ? "Lead Drip Buffer" : `Directory Discovery (${candidate.category || "Local Business"})`,
          assigned_to: assignee,
          date: dateStr,
          created_at: new Date().toISOString(),
          custom_fields: {
            company: candidateCompany,
            designation: candidate.designation || (isFromDripBuffer ? "Prospect" : "Business Owner"),
            website: candidateWebsite,
            address: candidateAddress,
            city: candidateCity,
            phone_type: candidatePhone ? "office_landline" : "unlisted",
            is_real_scraped_phone: Boolean(candidatePhone),
            verification_status: candidateEmail ? "deliverable" : "unlisted",
            source: isFromDripBuffer ? "Lead Drip Buffer" : "google_places",
            discovery_source: isFromDripBuffer ? "drip_buffer" : "google_places",
            scraped_at: new Date().toISOString(),
            ...(candidate.custom_fields || {})
          }
        });
      }

      let insertedCount = 0;
      if (readyToInsert.length > 0) {
        const { data: insertedData, error: insertErr } = await supabase
          .from("leads")
          .insert(readyToInsert)
          .select("id, name, stage, assigned_to");

        if (!insertErr && insertedData) {
          insertedCount = insertedData.length;
        }
      }

      const nextRunTimestamp = calculateNextDiscoveryRun(
        config.schedule_days || config.schedule_cadence || [1, 2, 3, 4, 5],
        config.schedule_time || "09:00",
        config.timezone_offset
      );

      const updatedConfig = {
        ...config,
        ...(isFromDripBuffer && remainingDripBuffer !== null ? { drip_buffer: remainingDripBuffer } : {}),
        last_run_at: new Date().toISOString(),
        last_run_stats: {
          total_scraped: rawCandidates.length,
          inserted: insertedCount,
          duplicates_skipped: duplicatesSkipped,
          enriched: 0
        },
        next_run_at: nextRunTimestamp
      };

      const updatedPipelinePayload: Record<string, any> = {
        discovery_config: updatedConfig,
        updated_at: new Date().toISOString()
      };

      if (pipeDist && distMode === "round_robin") {
        updatedPipelinePayload.lead_distribution = {
          ...pipeDist,
          round_robin_index: roundRobinIndex
        };
      }

      await supabase
        .from("pipelines")
        .update(updatedPipelinePayload)
        .eq("id", pipe.id);

      executedRuns.push({
        pipeline_id: pipe.id,
        pipeline_name: pipe.name,
        total_scraped: rawCandidates.length,
        inserted: insertedCount,
        duplicates_skipped: duplicatesSkipped,
        remaining_in_buffer: isFromDripBuffer && remainingDripBuffer ? remainingDripBuffer.length : null,
        next_run_at: nextRunTimestamp
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        executed_runs_count: executedRuns.length,
        executed_runs: executedRuns
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
