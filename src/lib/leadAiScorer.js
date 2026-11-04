/**
 * leadAiScorer.js
 * Autonomous AI ICP Scoring & Dynamic Icebreaker Synthesis Engine.
 *
 * Capabilities:
 * 1. Evaluates lead fit against pipeline ICP criteria (roles, company size, industry, location)
 * 2. Synthesizes a 0–100 ICP Fit Score with executive 1-sentence reasoning
 * 3. Crafts hyper-personalized 1st-line icebreakers and identifies operational pain points
 * 4. Dual-engine architecture: OpenRouter LLMs with instant offline heuristic fallback
 */

const OPENROUTER_STORAGE_KEY = 'crm_openrouter_api_key';

export const OPENROUTER_MODELS = [
  'minimax/minimax-m3.1-flash:free',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-3.5-lightning:free'
];

export function getOpenRouterApiKey() {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(OPENROUTER_STORAGE_KEY);
      if (stored) return stored;
    }
  } catch {}
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENROUTER_API_KEY) {
      return import.meta.env.VITE_OPENROUTER_API_KEY;
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env?.VITE_OPENROUTER_API_KEY) {
      return process.env.VITE_OPENROUTER_API_KEY;
    }
  } catch {}
  return '';
}

/**
 * Heuristic fallback: computes semantic ICP fit score & icebreaker without network dependencies
 */
export function heuristicScoreAndIcebreaker({ candidate, pipelineConfig = {} }) {
  const targetMode = pipelineConfig.target_mode === 'b2c' ? 'b2c' : 'b2b';
  const company = candidate.company || candidate.custom_fields?.company || '';
  const role = candidate.designation || candidate.role || candidate.custom_fields?.designation || '';
  const location = candidate.city || candidate.custom_fields?.city || candidate.custom_fields?.location || 'India';
  const city = location.split(',')[0].trim();
  const domain = candidate.domain || candidate.custom_fields?.domain || '';
  const cleanSnippet = candidate.scraped_snippet || candidate.custom_fields?.scraped_snippet || '';
  const interestOrTopic = candidate.custom_fields?.interest || candidate.custom_fields?.requirement || pipelineConfig.search_query || 'business operations';

  let score = 50; // Baseline
  const reasons = [];

  // 1. Role / Seniority Match (up to +25)
  const targetRoles = pipelineConfig.target_roles || [];
  const roleLower = role.toLowerCase();
  const isCLevelOrVP = /(chief|vp|vice president|head|director|founder|co-founder|owner|partner)/i.test(roleLower);
  const isTargetRoleExact = targetRoles.some((tr) => roleLower.includes(tr.toLowerCase()));

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

  // 2. Industry & Niche Match (up to +20)
  const targetIndustries = pipelineConfig.target_industries || [];
  const candidateIndustry = (candidate.custom_fields?.industry || '').toLowerCase();
  const matchesIndustry = targetIndustries.some((ti) => candidateIndustry.includes(ti.toLowerCase()));

  if (matchesIndustry) {
    score += 20;
    reasons.push('Direct industry alignment');
  } else if (domain && !domain.includes('gmail') && !domain.includes('yahoo')) {
    score += 10;
    reasons.push('Verified corporate domain footprint');
  }

  // 3. Location / Region Alignment (up to +15)
  const targetRegions = pipelineConfig.target_regions || pipelineConfig.target_locations || [];
  const matchesRegion = targetRegions.some((r) => location.toLowerCase().includes(r.toLowerCase()));
  if (matchesRegion) {
    score += 15;
    reasons.push(`Target region match: ${city}`);
  } else {
    score += 5;
  }

  // 4. Data Completeness & Authenticity (up to +15)
  if (candidate.custom_fields?.is_deliverable) score += 10;
  if (candidate.website && candidate.website.startsWith('http')) score += 5;

  score = Math.min(98, Math.max(45, score));

  let tier = 'warm';
  if (score >= 85) tier = 'hot';
  else if (score < 65) tier = 'mid';

  const reasoning = reasons.length > 0 ? reasons.join(' · ') : 'Relevant market prospect matching target scope.';

  // Synthesize tailored icebreakers & pain points
  let icebreaker = '';
  let painPoint = '';
  let valueProp = '';

  const isLocal = Boolean(candidate.custom_fields?.is_local_business || candidate.custom_fields?.rating);

  if (isLocal) {
    const rating = candidate.custom_fields?.rating || 4.8;
    const revCount = candidate.custom_fields?.review_count ? ` (${candidate.custom_fields.review_count}+ reviews)` : '';
    const cleanCompany = company || 'your business';
    icebreaker = `Loved seeing ${cleanCompany}'s stellar ${rating}★ rating${revCount} on Google Maps in ${city} — reached out seeing your strong local customer reputation.`;
    painPoint = `Handling instant speed-to-lead responses, missed calls, and automated review requests from local customers.`;
    valueProp = `Instantly engage and convert incoming inquiries with automated WhatsApp follow-ups in under 60 seconds.`;
  } else if (targetMode === 'b2c') {
    icebreaker = `Noticed your inquiry regarding ${interestOrTopic} in ${city} — wanted to reach out directly with verified options and pricing.`;
    painPoint = `Finding transparent, reliable recommendations for ${interestOrTopic} without sales pressure.`;
    valueProp = `Fast, customized advisory and verified quotes tailored to your timeline.`;
  } else {
    const cleanCompany = company || 'your company';
    if (cleanSnippet && cleanSnippet.length > 25) {
      icebreaker = `Noticed ${cleanCompany}'s work in ${city} — particularly your focus on scaling operations and team efficiency.`;
    } else {
      icebreaker = `Loved seeing ${cleanCompany}'s footprint in ${city} — reached out seeing your leadership over ${role || 'team operations'}.`;
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
    engine: 'heuristic'
  };
}

/**
 * Evaluates candidate using OpenRouter LLM, with automatic heuristic fallback
 */
export async function scoreAndSynthesizeLead({ candidate, pipelineConfig = {} }) {
  const apiKey = getOpenRouterApiKey();

  // If no API key configured, use high-speed heuristic engine directly
  if (!apiKey || !apiKey.trim()) {
    return heuristicScoreAndIcebreaker({ candidate, pipelineConfig });
  }

  const candidateSummary = {
    name: candidate.name,
    company: candidate.company || candidate.custom_fields?.company || '',
    role: candidate.designation || candidate.custom_fields?.designation || '',
    website: candidate.website || candidate.custom_fields?.website || '',
    domain: candidate.domain || candidate.custom_fields?.domain || '',
    location: candidate.city || candidate.custom_fields?.city || candidate.custom_fields?.location || '',
    snippet: (candidate.scraped_snippet || candidate.custom_fields?.scraped_snippet || '').slice(0, 300),
    interest: candidate.custom_fields?.interest || ''
  };

  const icpCriteria = {
    target_mode: pipelineConfig.target_mode || 'b2b',
    target_roles: pipelineConfig.target_roles || [],
    target_industries: pipelineConfig.target_industries || [],
    target_company_sizes: pipelineConfig.target_company_sizes || [],
    target_locations: pipelineConfig.target_regions || pipelineConfig.target_locations || [],
    primary_query: pipelineConfig.search_query || ''
  };

  const systemPrompt = `You are an elite B2B Sales Development & Outbound Intelligence AI.
Analyze this discovered lead against the target ICP (Ideal Customer Profile) criteria.
Output MUST be valid, raw JSON (no markdown formatting, no code fences):
{
  "icp_score": <number between 40 and 99>,
  "icp_tier": <"hot" | "warm" | "mid">,
  "icp_reasoning": <concise 1-sentence explanation of fit>,
  "ai_icebreaker": <compelling, hyper-personalized 1st sentence opening hook for cold email/WhatsApp referencing their company or context>,
  "identified_pain_point": <likely operational or business bottleneck for this role/company>,
  "suggested_value_prop": <1-sentence value pitch solving that bottleneck>
}`;

  const userPrompt = `Target ICP Criteria:
${JSON.stringify(icpCriteria, null, 2)}

Discovered Prospect Data:
${JSON.stringify(candidateSummary, null, 2)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const model = OPENROUTER_MODELS[0] || 'minimax/minimax-m3.1-flash:free';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        'X-Title': 'SimpleCRM'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 350
      })
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const cleanJson = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.icp_score && parsed.ai_icebreaker) {
        return {
          icp_score: Math.min(99, Math.max(40, Number(parsed.icp_score) || 75)),
          icp_tier: parsed.icp_tier || (parsed.icp_score >= 85 ? 'hot' : parsed.icp_score >= 70 ? 'warm' : 'mid'),
          icp_reasoning: parsed.icp_reasoning || 'Strong alignment with target role and industry.',
          ai_icebreaker: parsed.ai_icebreaker,
          identified_pain_point: parsed.identified_pain_point || 'Operational bottlenecks in manual sales outreach.',
          suggested_value_prop: parsed.suggested_value_prop || 'Automate and streamline your workflows with modern CRM infrastructure.',
          engine: 'openrouter'
        };
      }
    }
  } catch (err) {
    // Timeout or network error -> fallback seamlessly to heuristic engine
  } finally {
    clearTimeout(timeoutId);
  }

  return heuristicScoreAndIcebreaker({ candidate, pipelineConfig });
}

/**
 * Concurrently scores and synthesizes icebreakers for an array of candidates
 */
export async function scoreCandidateBatch(arg1 = {}, arg2 = {}) {
  // Support both scoreCandidateBatch({ candidates, pipelineConfig }) and scoreCandidateBatch(candidates, pipelineConfig)
  let candidates = [];
  let pipelineConfig = {};

  if (Array.isArray(arg1)) {
    candidates = arg1;
    pipelineConfig = arg2 || {};
  } else if (arg1 && typeof arg1 === 'object') {
    candidates = arg1.candidates || [];
    pipelineConfig = arg1.pipelineConfig || {};
  }

  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const promises = candidates.map(async (candidate) => {
    try {
      const aiData = await scoreAndSynthesizeLead({ candidate, pipelineConfig });
      return {
        ...candidate,
        custom_fields: {
          ...(candidate.custom_fields || {}),
          ...aiData
        }
      };
    } catch {
      const fallback = heuristicScoreAndIcebreaker({ candidate, pipelineConfig });
      return {
        ...candidate,
        custom_fields: {
          ...(candidate.custom_fields || {}),
          ...fallback
        }
      };
    }
  });

  const results = await Promise.allSettled(promises);
  return results.map((r, idx) => (r.status === 'fulfilled' ? r.value : candidates[idx]));
}
