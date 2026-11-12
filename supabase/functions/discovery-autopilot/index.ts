import {
  corsHeaders,
  createServiceClients,
  getAuthenticatedCrmCaller,
  isCronSecretRequest,
  isServiceRoleRequest,
  jsonResponse,
} from "../_shared/authBridge.ts";
import { isCompanySubscriptionActive } from "../_shared/billing.ts";
import { pickWeightedRule } from "../_shared/leadDistribution.ts";

function expandAutopilotLocations(regions: any = [], country = "India") {
  const isUS = /united states|usa|\bus\b/i.test(country);
  const isUK = /united kingdom|uk|\bgb\b/i.test(country);

  const metroPresets = {
    in: ["Bengaluru", "Mumbai", "Pune", "Delhi NCR", "Hyderabad", "Chennai"],
    us: ["New York", "Los Angeles", "Chicago", "Houston", "Miami", "San Francisco"],
    uk: ["London", "Manchester", "Birmingham", "Leeds"],
  };
  const hubPresets = {
    in: ["Ahmedabad", "Kolkata", "Jaipur", "Indore", "Kochi", "Chandigarh"],
    us: ["Austin", "Seattle", "Denver", "Atlanta", "Boston"],
    uk: ["Bristol", "Glasgow", "Edinburgh", "Liverpool"],
  };

  const activeMetros = isUS ? metroPresets.us : isUK ? metroPresets.uk : metroPresets.in;
  const activeHubs = isUS ? hubPresets.us : isUK ? hubPresets.uk : hubPresets.in;

  const rawList = Array.isArray(regions) ? regions : regions ? [regions] : [];
  const results: string[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== "string") continue;
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

function extractAutopilotCategories(config: any = {}) {
  const categories: string[] = [];
  const rawQueries = Array.isArray(config.search_queries)
    ? config.search_queries
    : config.search_query
      ? [config.search_query]
      : [];
  const rawIndustries = Array.isArray(config.target_industries)
    ? config.target_industries
    : config.industry
      ? [config.industry]
      : [];

  for (const q of rawQueries) {
    if (q && typeof q === "string" && q.trim()) {
      const trimmed = q.trim();
      if (!categories.includes(trimmed)) categories.push(trimmed);
    }
  }
  for (const ind of rawIndustries) {
    if (ind && typeof ind === "string" && ind.trim()) {
      const trimmed = ind.trim();
      const isAlreadyCovered = categories.some(
        (c) => c.toLowerCase() === trimmed.toLowerCase()
      );
      if (!isAlreadyCovered) categories.push(trimmed);
    }
  }

  return categories.length > 0 ? categories : ["Commercial Businesses"];
}

/**
 * Computes semantic ICP fit score & icebreaker for autopilot candidates
 */
function computeAutopilotIcpScore(candidate: any, pipelineConfig: any = {}) {
  const targetMode = pipelineConfig.target_mode === "b2c" ? "b2c" : "b2b";
  const company = candidate.company || candidate.custom_fields?.company || "";
  const role =
    candidate.designation ||
    candidate.role ||
    candidate.custom_fields?.designation ||
    "Business Owner";
  const location =
    candidate.city ||
    candidate.custom_fields?.city ||
    candidate.custom_fields?.location ||
    "India";
  const city = location.split(",")[0].trim();
  const domain = candidate.website
    ? candidate.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : "";
  const cleanSnippet = candidate.custom_fields?.scraped_snippet || "";
  const interestOrTopic =
    candidate.custom_fields?.category || pipelineConfig.search_query || "business operations";

  let score = 55;
  const reasons: string[] = [];

  const targetRoles = pipelineConfig.target_roles || [];
  const roleLower = role.toLowerCase();
  const isCLevelOrVP =
    /(chief|vp|vice president|head|director|founder|co-founder|owner|partner|management)/i.test(
      roleLower
    );
  const isTargetRoleExact = targetRoles.some((tr: string) =>
    roleLower.includes(tr.toLowerCase())
  );

  if (isTargetRoleExact) {
    score += 25;
    reasons.push(`Exact role match: ${role}`);
  } else if (isCLevelOrVP) {
    score += 20;
    reasons.push(`Executive decision-maker: ${role}`);
  } else if (role) {
    score += 10;
    reasons.push(`Identified professional role: ${role}`);
  }

  const targetIndustries = pipelineConfig.target_industries || [];
  const candidateCategory = (
    candidate.category ||
    candidate.custom_fields?.category ||
    ""
  ).toLowerCase();
  const matchesIndustry = targetIndustries.some(
    (ti: string) =>
      candidateCategory.includes(ti.toLowerCase()) || ti.toLowerCase().includes(candidateCategory)
  );

  if (matchesIndustry) {
    score += 20;
    reasons.push("Direct industry alignment");
  } else if (domain && !domain.includes("gmail") && !domain.includes("yahoo")) {
    score += 10;
    reasons.push("Verified corporate domain footprint");
  }

  const targetRegions =
    pipelineConfig.target_regions || pipelineConfig.target_locations || [];
  const matchesRegion = targetRegions.some((r: string) =>
    location.toLowerCase().includes(r.toLowerCase())
  );
  if (matchesRegion) {
    score += 15;
    reasons.push(`Target region match: ${city}`);
  } else {
    score += 5;
  }

  if (candidate.phone) score += 10;
  if (candidate.website && candidate.website.startsWith("http")) score += 5;

  score = Math.min(98, Math.max(45, score));

  let tier = "warm";
  if (score >= 85) tier = "hot";
  else if (score < 65) tier = "mid";

  const reasoning =
    reasons.length > 0 ? reasons.join(" · ") : "Relevant commercial prospect matching target scope.";

  let icebreaker = "";
  let painPoint = "";
  let valueProp = "";

  const isLocal = Boolean(
    candidate.custom_fields?.is_local_business || candidate.custom_fields?.rating
  );

  if (isLocal) {
    const rating = candidate.custom_fields?.rating || 4.8;
    const revCount = candidate.custom_fields?.review_count
      ? ` (${candidate.custom_fields.review_count}+ reviews)`
      : "";
    const cleanCompany = company || "your business";
    icebreaker = `Loved seeing ${cleanCompany}'s stellar ${rating}★ rating${revCount} on Google Maps in ${city} — reached out seeing your strong local customer reputation.`;
    painPoint = `Handling instant speed-to-lead responses, missed calls, and automated review requests from local customers.`;
    valueProp = `Instantly engage and convert incoming inquiries with automated WhatsApp follow-ups in under 60 seconds.`;
  } else if (targetMode === "b2c") {
    icebreaker = `Noticed your inquiry regarding ${interestOrTopic} in ${city} — wanted to reach out directly with verified options and pricing.`;
    painPoint = `Finding transparent, reliable recommendations for ${interestOrTopic} without sales pressure.`;
    valueProp = `Fast, customized advisory and verified quotes tailored to your timeline.`;
  } else {
    const cleanCompany = company || "your company";
    if (cleanSnippet && cleanSnippet.length > 25) {
      icebreaker = `Noticed ${cleanCompany}'s work in ${city} — particularly your focus on scaling operations and team efficiency.`;
    } else {
      icebreaker = `Loved seeing ${cleanCompany}'s footprint in ${city} — reached out seeing your leadership over ${role || "team operations"}.`;
    }
    painPoint = `Managing operational bottlenecks, manual follow-ups, and repetitive workflows across scaling teams.`;
    valueProp = `Streamline your pipeline, eliminate manual outreach overhead, and accelerate team conversions by 3x.`;
  }

  return {
    icp_score: score,
    icp_tier: tier,
    icp_reasoning: reasoning,
    ai_icebreaker: icebreaker,
    identified_pain_point: painPoint,
    suggested_value_prop: valueProp,
    engine: "heuristic",
  };
}

/**
 * Fetches real Google Maps businesses from Serper.dev Places API using either
 * tenant BYO Serper key or platform SERPER_API_KEY secret (zero hardcoded keys).
 */
async function fetchSerperPlaces(config: any, count = 25) {
  const apiKey =
    (config.serper_api_key && String(config.serper_api_key).trim()) ||
    (config.google_maps_api_key && String(config.google_maps_api_key).trim()) ||
    (Deno.env.get("SERPER_API_KEY") ?? "").trim();

  if (!apiKey) {
    console.warn("[Autopilot] SERPER_API_KEY secret is not configured.");
    return [];
  }

  const searchCountry =
    (config.target_countries && config.target_countries[0]) || config.country || "India";
  const cities = expandAutopilotLocations(
    config.target_regions || [config.location],
    searchCountry
  );
  const categories = extractAutopilotCategories(config);

  const collected: any[] = [];
  const seenKeys = new Set<string>();

  for (const city of cities) {
    if (collected.length >= count) break;
    for (const category of categories) {
      if (collected.length >= count) break;

      const fullQuery = `${category} in ${city}, ${searchCountry}`.trim();
      try {
        const res = await fetch("https://google.serper.dev/places", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: fullQuery,
            gl: searchCountry.toLowerCase().includes("us") ? "us" : "in",
            hl: "en",
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = await res.json();
          const places = Array.isArray(data.places) ? data.places : [];
          for (const p of places) {
            const cleanTitle = (p.title || "Local Business").trim();
            const cleanAddress = (p.address || `${city}, ${searchCountry}`).trim();
            const phone = (p.phoneNumber || "").trim();
            const key = (phone || cleanTitle).toLowerCase().trim();

            if (key && !seenKeys.has(key)) {
              seenKeys.add(key);
              const website = (p.website || "").trim();
              const cat = (p.category || category || "Local Business").trim();
              const rating = typeof p.rating === "number" ? p.rating : null;
              const reviewCount = typeof p.ratingCount === "number" ? p.ratingCount : 0;
              const mapsUrl = p.cid
                ? `https://www.google.com/maps?cid=${p.cid}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${cleanTitle} ${cleanAddress}`)}`;
              const snippet = `${cleanTitle} is a ${cat} located at ${cleanAddress}.${rating ? ` Rated ${rating}★ from ${reviewCount} customer reviews.` : ""}`;

              collected.push({
                name: cleanTitle,
                company: cleanTitle,
                phone,
                email: "",
                website,
                address: cleanAddress,
                city,
                category: cat,
                custom_fields: {
                  company: cleanTitle,
                  designation: "Business Owner / Management",
                  address: cleanAddress,
                  city,
                  country: searchCountry,
                  location: `${city}, ${searchCountry}`,
                  phone,
                  website,
                  rating,
                  review_count: reviewCount,
                  category: cat,
                  google_maps_url: mapsUrl,
                  cid: p.cid ? String(p.cid) : "",
                  discovery_source: "google_places",
                  discovery_query: fullQuery,
                  scraped_snippet: snippet,
                  phone_type: phone ? "office_landline" : "unlisted",
                  is_real_scraped_phone: Boolean(phone),
                  quality_score: 90,
                  quality_tier: "A",
                  quality_badge: "Google Verified",
                  is_local_business: true,
                },
              });

              if (collected.length >= count) break;
            }
          }
        }
      } catch (err) {
        console.warn(`[Autopilot Serper error for "${category} in ${city}"]:`, err);
      }
    }
  }

  return collected;
}

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

  const localNowMs = now.getTime() - offsetMins * 60000;
  const localNow = new Date(localNowMs);

  for (let offset = 0; offset <= 14; offset++) {
    const candidateLocalYear = localNow.getUTCFullYear();
    const candidateLocalMonth = localNow.getUTCMonth();
    const candidateLocalDate = localNow.getUTCDate() + offset;

    const candidateLocalMs = Date.UTC(
      candidateLocalYear,
      candidateLocalMonth,
      candidateLocalDate,
      hours,
      minutes,
      0,
      0
    );
    const candidateUtcMs = candidateLocalMs + offsetMins * 60000;
    const localDayOfWeek = new Date(candidateLocalMs).getUTCDay();

    if (targetDays.includes(localDayOfWeek) && candidateUtcMs > now.getTime()) {
      return new Date(candidateUtcMs).toISOString();
    }
  }

  return new Date(now.getTime() + 86400000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({
      status: "active",
      service: "simplecrm discovery-autopilot",
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { adminClient } = createServiceClients();
    const isCronOrService = isCronSecretRequest(req) || (await isServiceRoleRequest(req));
    const caller = isCronOrService ? null : await getAuthenticatedCrmCaller(req, adminClient);

    if (!isCronOrService && !caller) {
      return jsonResponse({ success: false, error: "Authentication required." }, 401);
    }

    const url = new URL(req.url);
    let force = url.searchParams.get("force") === "true";
    let targetPipelineId = url.searchParams.get("pipeline_id");

    const body = await req.json().catch(() => ({}));
    if (body.force !== undefined) force = Boolean(body.force);
    if (body.pipeline_id) targetPipelineId = String(body.pipeline_id);

    // Fetch active cold pipelines, strictly binding end-user calls to their company_id
    let query = adminClient
      .from("pipelines")
      .select("id, company_id, name, stages, pipeline_type, lead_distribution, discovery_config")
      .eq("pipeline_type", "cold");

    if (!isCronOrService && caller) {
      query = query.eq("company_id", caller.crmUser.company_id);
    }

    if (targetPipelineId) {
      query = query.eq("id", targetPipelineId);
    }

    const { data: pipelines, error: pipeErr } = await query;

    if (pipeErr) {
      return jsonResponse({ error: pipeErr.message }, 500);
    }

    if (!isCronOrService && targetPipelineId && (!pipelines || pipelines.length === 0)) {
      return jsonResponse({ success: false, error: "Pipeline not found for your company." }, 404);
    }

    // Gate sweeps to companies with active or trialing subscriptions
    const companyIds = Array.from(
      new Set((pipelines || []).map((p: any) => p.company_id).filter(Boolean))
    );
    const eligibleCompanyIds = new Set<string>();

    if (companyIds.length > 0) {
      const { data: companiesRows } = await adminClient
        .from("companies")
        .select("id, subscription_status, trial_ends_at, is_billing_exempt")
        .in("id", companyIds);

      for (const comp of companiesRows || []) {
        if (isCompanySubscriptionActive(comp)) {
          eligibleCompanyIds.add(comp.id);
        }
      }
    }

    const dailyPlatformCap = Number(Deno.env.get("PLATFORM_DAILY_DISCOVERY_CAP")) || 150;
    const executedRuns = [];

    for (const pipe of pipelines || []) {
      const companyId = pipe.company_id ? String(pipe.company_id) : null;
      if (!companyId || !eligibleCompanyIds.has(companyId)) {
        continue;
      }

      const config = pipe.discovery_config || {};
      const isAutopilot = config.autopilot_enabled === true;

      if (!force && !isAutopilot) {
        continue;
      }

      if (!force && isAutopilot) {
        const nextRunAt = config.next_run_at ? new Date(config.next_run_at).getTime() : 0;
        if (nextRunAt > 0 && nextRunAt > Date.now() + 60000) {
          continue;
        }
      }

      const requestedBatchSize = Number(config.batch_size) || 25;
      const dedupeRules = config.dedupe || {
        match_email: true,
        match_phone: true,
        on_duplicate: "skip",
      };

      const dripBuffer = Array.isArray(config.drip_buffer) ? config.drip_buffer : [];
      const hasByoSerperKey = Boolean(
        (config.serper_api_key && String(config.serper_api_key).trim()) ||
          (config.google_maps_api_key && String(config.google_maps_api_key).trim())
      );

      // Protect shared platform Serper credits with per-company 24h discovery quota
      let effectiveBatchSize = requestedBatchSize;
      if (dripBuffer.length === 0 && !hasByoSerperKey) {
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: recentCount } = await adminClient
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", sinceIso)
          .contains("custom_fields", { discovery_source: "google_places" });

        const remainingQuota = Math.max(0, dailyPlatformCap - (recentCount || 0));
        if (remainingQuota === 0) {
          console.warn(
            `[Autopilot] Skipping pipeline ${pipe.id} (company=${companyId}): 24h platform discovery quota (${dailyPlatformCap}) reached.`
          );
          continue;
        }
        effectiveBatchSize = Math.min(requestedBatchSize, remainingQuota);
      }

      // Company-scoped lead deduplication (never crosses tenant boundaries)
      const { data: existingLeads } = await adminClient
        .from("leads")
        .select("id, phone, email")
        .eq("company_id", companyId);

      const existingEmails = new Set(
        (existingLeads || []).map((l: any) => (l.email || "").toLowerCase().trim()).filter(Boolean)
      );
      const existingPhones = new Set(
        (existingLeads || [])
          .map((l: any) => (l.phone || "").replace(/\D/g, "").slice(-10))
          .filter(Boolean)
      );

      const pipeDist = pipe.lead_distribution || {};
      const distMode = pipeDist.mode || "round_robin";
      const defaultAssignee = pipeDist.default_assignee || "unassigned";
      const activeRules = (pipeDist.user_rules || []).filter(
        (r: any) => r.enabled !== false && r.active !== false
      );
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
          const chosen = pickWeightedRule(activeRules);
          if (chosen) return chosen.name || chosen.email || defaultAssignee;
        }
        return activeRules.length > 0 ? activeRules[0].name || defaultAssignee : defaultAssignee;
      };

      const entryStage =
        pipe.stages && pipe.stages[0]?.id
          ? pipe.stages[0].id
          : pipe.stages && pipe.stages[0]?.name
            ? pipe.stages[0].name
            : "prospect";

      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

      let rawCandidates: any[] = [];
      let isFromDripBuffer = false;
      let remainingDripBuffer: any[] | null = null;

      if (dripBuffer.length > 0) {
        rawCandidates = dripBuffer.slice(0, effectiveBatchSize);
        remainingDripBuffer = dripBuffer.slice(effectiveBatchSize);
        isFromDripBuffer = true;
      } else {
        rawCandidates = await fetchSerperPlaces(config, Math.max(effectiveBatchSize * 3, 35));
      }

      const readyToInsert: any[] = [];
      let duplicatesSkipped = 0;

      for (const candidate of rawCandidates) {
        if (readyToInsert.length >= effectiveBatchSize) break;

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
        const candidateIcp = computeAutopilotIcpScore(candidate, config);

        readyToInsert.push({
          company_id: companyId,
          name: candidateName,
          phone: candidatePhone,
          email: candidateEmail,
          city: candidateCity,
          stage: entryStage,
          pipeline_id: pipe.id,
          form_name: isFromDripBuffer
            ? "Lead Drip Buffer"
            : `Directory Discovery (${candidate.category || "Local Business"})`,
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
            ...(candidate.custom_fields || {}),
            ...candidateIcp,
          },
        });
      }

      let insertedCount = 0;
      if (readyToInsert.length > 0) {
        const { data: insertedData, error: insertErr } = await adminClient
          .from("leads")
          .insert(readyToInsert)
          .select("id, name, stage, assigned_to");

        if (!insertErr && insertedData) {
          insertedCount = insertedData.length;
        } else if (insertErr) {
          console.error(
            `[Autopilot] Insert error for pipeline=${pipe.id}, company=${companyId}:`,
            insertErr
          );
        }
      }

      const nextRunTimestamp = calculateNextDiscoveryRun(
        config.schedule_days || config.schedule_cadence || [1, 2, 3, 4, 5],
        config.schedule_time || "09:00",
        config.timezone_offset
      );

      const updatedConfig = {
        ...config,
        ...(isFromDripBuffer && remainingDripBuffer !== null
          ? { drip_buffer: remainingDripBuffer }
          : {}),
        last_run_at: new Date().toISOString(),
        last_run_stats: {
          total_scraped: rawCandidates.length,
          inserted: insertedCount,
          duplicates_skipped: duplicatesSkipped,
          enriched: 0,
        },
        next_run_at: nextRunTimestamp,
      };

      const updatedPipelinePayload: Record<string, any> = {
        discovery_config: updatedConfig,
        updated_at: new Date().toISOString(),
      };

      if (pipeDist && distMode === "round_robin") {
        updatedPipelinePayload.lead_distribution = {
          ...pipeDist,
          round_robin_index: roundRobinIndex,
        };
      }

      await adminClient
        .from("pipelines")
        .update(updatedPipelinePayload)
        .eq("id", pipe.id)
        .eq("company_id", companyId);

      executedRuns.push({
        pipeline_id: pipe.id,
        company_id: companyId,
        pipeline_name: pipe.name,
        total_scraped: rawCandidates.length,
        inserted: insertedCount,
        duplicates_skipped: duplicatesSkipped,
        remaining_in_buffer:
          isFromDripBuffer && remainingDripBuffer ? remainingDripBuffer.length : null,
        next_run_at: nextRunTimestamp,
      });
    }

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      executed_runs_count: executedRuns.length,
      executed_runs: executedRuns,
    });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || "Internal server error" }, 500);
  }
});
