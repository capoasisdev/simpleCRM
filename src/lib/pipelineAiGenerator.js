/**
 * pipelineAiGenerator.js
 * AI & Heuristic Intelligence Engine to automatically generate complete,
 * production-ready pipelines and targeting configurations from a single natural language prompt.
 */

const OPENROUTER_STORAGE_KEY = 'crm_openrouter_api_key';

function getOpenRouterApiKey() {
  try {
    return (
      localStorage.getItem(OPENROUTER_STORAGE_KEY) ||
      import.meta.env.VITE_OPENROUTER_API_KEY ||
      ''
    );
  } catch {
    return import.meta.env.VITE_OPENROUTER_API_KEY || '';
  }
}

const OPENROUTER_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'minimax/minimax-m3.1-flash:free',
  'meta-llama/llama-3.3-70b-instruct:free'
];

// Pre-defined knowledge base for common geographies & top commercial hubs
const GEOGRAPHY_DATABASE = [
  {
    keywords: ['india', 'indian', 'bharat', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai', 'noida', 'gurgaon'],
    country: 'India',
    cities: ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Pune', 'Chennai']
  },
  {
    keywords: ['uae', 'dubai', 'abu dhabi', 'sharjah', 'emirates'],
    country: 'United Arab Emirates',
    cities: ['Dubai', 'Abu Dhabi', 'Sharjah']
  },
  {
    keywords: ['usa', 'united states', 'america', 'us', 'california', 'new york', 'texas', 'florida'],
    country: 'United States',
    cities: ['New York', 'San Francisco', 'Austin', 'Los Angeles', 'Chicago', 'Miami']
  },
  {
    keywords: ['uk', 'united kingdom', 'britain', 'england', 'london', 'manchester'],
    country: 'United Kingdom',
    cities: ['London', 'Manchester', 'Birmingham', 'Leeds']
  },
  {
    keywords: ['canada', 'canadian', 'toronto', 'vancouver', 'montreal'],
    country: 'Canada',
    cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary']
  },
  {
    keywords: ['australia', 'sydney', 'melbourne', 'brisbane'],
    country: 'Australia',
    cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth']
  },
  {
    keywords: ['singapore'],
    country: 'Singapore',
    cities: ['Central Region', 'Marina Bay', 'Jurong']
  },
  {
    keywords: ['saudi', 'ksa', 'riyadh', 'jeddah'],
    country: 'Saudi Arabia',
    cities: ['Riyadh', 'Jeddah', 'Dammam']
  },
  {
    keywords: ['germany', 'berlin', 'munich', 'frankfurt'],
    country: 'Germany',
    cities: ['Berlin', 'Munich', 'Frankfurt', 'Hamburg']
  }
];

// Common B2B & B2C Domain Profiles
const NICHE_TEMPLATES = [
  {
    keywords: ['crm', 'customer relationship', 'sales software', 'lead management', 'sales automation', 'crm software'],
    mode: 'b2b',
    name: 'SMB CRM Client Acquisition',
    industries: [
      'Real Estate & Property Development',
      'Logistics & Supply Chain',
      'Clinics & Diagnostic Centers',
      'Construction & Interior Design Studios',
      'Manufacturing & Wholesale Distribution',
      'Education & Coaching Academies',
      'Financial & Legal Advisory'
    ],
    roles: ['Founder & CEO', 'Managing Director', 'Business Owner', 'Director of Sales', 'Operations Head'],
    personas: ['SMB Business Owners', 'Founders & Managing Directors', 'Sales Heads & Growth Directors', 'Commercial Firm Leaders'],
    interests: ['Lead Management Software', 'Sales Automation CRM', 'Customer Follow-up Systems', 'Inquiry Tracking'],
    companySizes: ['1–10', '11–50', '51–200'],
    queries: ['Real estate agencies', 'Logistics companies', 'Interior design studios', 'Manufacturing firms', 'Diagnostic clinics'],
    stages: [
      { name: 'Prospect' },
      { name: 'Contacted' },
      { name: 'Discovery & Pain Points' },
      { name: 'CRM Demo Presented' },
      { name: 'Trial / Proposal Sent' },
      { name: 'Closed Won', is_won: true },
      { name: 'Lost / Unresponsive', is_lost: true }
    ],
    explanation: 'Configured for selling CRM software to high-touch non-tech SMBs (Real Estate, Logistics, Clinics, Manufacturing, and Services) targeting business owners and sales leaders.'
  },
  {
    keywords: ['hrms', 'payroll', 'human resource', 'hr software', 'hcm', 'staffing software', 'attendance software'],
    mode: 'b2b',
    name: 'HRMS & Payroll Client Acquisition',
    industries: [
      'Manufacturing & Industrial Plants',
      'Retail & Store Chains',
      'Hospitals & Healthcare Centers',
      'Logistics & Warehousing Hubs',
      'Security & Facility Management',
      'Hotels & Restaurant Chains'
    ],
    roles: ['Founder & Managing Director', 'Business Owner', 'General Manager', 'HR Manager', 'Head of Operations'],
    personas: ['SMB Business Owners', 'Managing Directors', 'Operations & HR Heads', 'Factory & Store Leaders'],
    interests: ['Employee Attendance & Shifts', 'Automated Payroll Software', 'Staff Management Systems', 'Leave & Compliance Tracking'],
    companySizes: ['11–50', '51–200', '201–500'],
    queries: ['Manufacturing companies', 'Retail chains', 'Hospitals and nursing homes', 'Logistics hubs', 'Facility management companies'],
    stages: [
      { name: 'Prospect' },
      { name: 'Contacted' },
      { name: 'Payroll & HR Needs Review' },
      { name: 'HRMS Demo Scheduled' },
      { name: 'Commercial Proposal' },
      { name: 'Closed Won', is_won: true },
      { name: 'Lost / Unresponsive', is_lost: true }
    ],
    explanation: 'Configured for selling HRMS & payroll software to companies with frontline and deskless staff (Manufacturing, Retail, Healthcare, Logistics, and Hospitality).'
  },
  {
    keywords: ['real estate', 'realty', 'property', 'properties', 'villa', 'villas', 'apartment', 'apartments', 'flats', 'flat', 'housing', 'off-plan', 'luxury homes', 'home buyer', 'home buyers'],
    mode: 'b2c',
    name: 'Real Estate Buyer Discovery',
    industries: ['Real Estate & Brokerage', 'Property Development', 'Luxury Hospitality', 'Investment Services'],
    roles: ['Real Estate Broker', 'Managing Partner', 'Property Consultant', 'Investment Advisor'],
    personas: ['High-Net-Worth Investors', 'Luxury Home Buyers', 'First-Time Home Buyers', 'Expat Property Investors'],
    interests: ['Luxury Villas', '3 & 4 BHK Apartments', 'Off-Plan Properties', 'Penthouse Inquiries'],
    companySizes: ['1–10', '11–50', '51–200'],
    queries: ['Looking to buy apartment', 'Luxury villas for sale', 'Property investment inquiries'],
    stages: [
      { name: 'Prospect' },
      { name: 'Contacted' },
      { name: 'Requirement Analysis' },
      { name: 'Site Visit Scheduled' },
      { name: 'Booking / Token Paid' },
      { name: 'Deal Closed', is_won: true },
      { name: 'Lost / Dropped', is_lost: true }
    ],
    explanation: 'Configured for consumer real estate buyer acquisition with stages focused on site visits, property requirements, and booking conversions.'
  },
  {
    keywords: ['devops', 'cybersecurity', 'developer tool', 'cloud infrastructure', 'api platform'],
    mode: 'b2b',
    name: 'DevOps & Cloud Tech Prospecting',
    industries: ['Software & SaaS', 'Information Technology', 'Internet & FinTech', 'E-Commerce'],
    roles: ['Chief Technology Officer (CTO)', 'VP Engineering', 'Head of Product', 'Founder & CEO', 'IT Director'],
    personas: ['Tech Founders & CEOs', 'CTOs & Engineering Leads', 'Head of Product', 'IT & DevOps Directors'],
    interests: ['Cloud Solutions', 'Workflow Automation Tools', 'Developer Infrastructure', 'B2B Software'],
    companySizes: ['11–50', '51–200', '201–500'],
    queries: ['SaaS technology leaders', 'B2B software buyers', 'Companies scaling cloud infrastructure'],
    stages: [
      { name: 'Prospect' },
      { name: 'Outreach Sent' },
      { name: 'Discovery Call Booked' },
      { name: 'Product Demo' },
      { name: 'Trial / Pilot' },
      { name: 'Closed Won', is_won: true },
      { name: 'Unresponsive / Lost', is_lost: true }
    ],
    explanation: 'Configured for modern B2B SaaS outreach targeting technical and product leadership.'
  },
  {
    keywords: ['fitness', 'gym', 'personal training', 'workout', 'weight loss', 'trainer'],
    mode: 'b2c',
    name: 'Fitness & Gym Client Acquisition',
    industries: ['Health & Wellness', 'Sports & Fitness', 'Lifestyle Services', 'Hospitality'],
    roles: ['Gym Owner', 'Fitness Director', 'Head Trainer', 'Studio Manager'],
    personas: ['Fitness Enthusiasts', 'Weight Loss Seekers', 'Busy Professionals', 'Strength & Wellness Clients'],
    interests: ['Personal Training 1-on-1', 'Weight Loss Program', 'Gym Membership', 'Nutrition Coaching'],
    companySizes: ['1–10', '11–50'],
    queries: ['Personal trainer near me', 'Best fitness coaching programs', 'Gym membership inquiries'],
    stages: [
      { name: 'Inquiry' },
      { name: 'Contacted' },
      { name: 'Free Trial / Consultation Booked' },
      { name: 'Fitness Assessment' },
      { name: 'Membership Enrolled', is_won: true },
      { name: 'Lost', is_lost: true }
    ],
    explanation: 'Configured for high-intent B2C health and wellness consumer acquisition.'
  },
  {
    keywords: ['consulting', 'agency', 'marketing', 'advertising', 'branding', 'seo'],
    mode: 'b2b',
    name: 'Agency & Services Pipeline',
    industries: ['Marketing & Advertising', 'Consumer Goods', 'Retail & E-commerce', 'Financial Services'],
    roles: ['Chief Marketing Officer (CMO)', 'VP Marketing', 'Head of Growth', 'Founder & Managing Director'],
    personas: ['Brand & Growth Leaders', 'E-commerce Founders', 'Marketing Directors', 'Business Owners Seeking Growth'],
    interests: ['Performance Marketing', 'SEO & Brand Strategy', 'Paid Acquisition', 'Creative Design Services'],
    companySizes: ['11–50', '51–200'],
    queries: ['Marketing decision makers', 'Growth leaders seeking agency support', 'Brands scaling digital acquisition'],
    stages: [
      { name: 'Prospect' },
      { name: 'Contacted' },
      { name: 'Strategy Call' },
      { name: 'Audit & Proposal Presented' },
      { name: 'Retainer Closed', is_won: true },
      { name: 'Lost', is_lost: true }
    ],
    explanation: 'Configured for B2B consulting and marketing agency client acquisition.'
  }
];

/**
 * High-precision heuristic generator that operates instantly without external network calls.
 */
export function generateHeuristicPipelineConfig(promptText, options = {}) {
  const p = promptText.toLowerCase();
  const currentMode = options?.currentMode;

  const matchesKeyword = (kw) => {
    if (kw.length <= 4) {
      return new RegExp(`\\b${kw}\\b`, 'i').test(promptText);
    }
    return p.includes(kw);
  };

  // 1. Detect Geography
  const matchedCountries = [];
  const matchedCities = [];

  for (const geo of GEOGRAPHY_DATABASE) {
    if (geo.keywords.some(matchesKeyword)) {
      if (!matchedCountries.includes(geo.country)) {
        matchedCountries.push(geo.country);
      }
      geo.cities.forEach(c => {
        if (!matchedCities.includes(c)) matchedCities.push(c);
      });
    }
  }

  const countries = matchedCountries.length > 0 ? matchedCountries : ['India'];
  const defaultCommercialCities = countries[0] === 'India'
    ? ['Bengaluru', 'Mumbai', 'Delhi NCR', 'Pune', 'Hyderabad', 'Chennai']
    : ['New York', 'San Francisco', 'Austin', 'Chicago', 'Miami'];
  const cities = matchedCities.length > 0 ? matchedCities.slice(0, 6) : defaultCommercialCities;

  // 2. Detect B2B vs B2C & Niche
  let matchedTemplate = null;
  for (const tmpl of NICHE_TEMPLATES) {
    if (tmpl.keywords.some(matchesKeyword)) {
      matchedTemplate = tmpl;
      break;
    }
  }

  // 3. Fallback inference if no exact niche matches
  const b2bTerms = ['b2b', 'enterprise', 'corporate', 'company', 'companies', 'business', 'vendor', 'firm'];
  const isB2bExplicit = b2bTerms.some(term => p.includes(term));

  const cleanSubject = promptText
    .replace(/i want to target|target|customers in|people in|create a pipeline for|setup a pipeline for|create a cold pipeline for/gi, '')
    .trim();

  const titleCasedSubject = cleanSubject ? cleanSubject.charAt(0).toUpperCase() + cleanSubject.slice(1) : 'Target Prospecting';

  if (!matchedTemplate) {
    const isB2B = isB2bExplicit || (!p.includes('consumer') && !p.includes('personal') && !p.includes('individuals') && !p.includes('customer') && currentMode !== 'b2c');

    matchedTemplate = isB2B ? {
      mode: 'b2b',
      name: `${titleCasedSubject} Outreach`,
      industries: ['Technology & Software', 'Business Services', 'Commercial Enterprises'],
      roles: ['Founder & CEO', 'Managing Director', 'VP Sales & Growth', 'Operations Director'],
      personas: [
        `${titleCasedSubject} Decision Makers`,
        `Companies Seeking ${titleCasedSubject}`,
        `${titleCasedSubject} Buyers & Clients`,
        `Interested Organizations`
      ],
      interests: [
        `${titleCasedSubject} Solutions`,
        `${titleCasedSubject} Services`,
        `Commercial ${titleCasedSubject}`,
        `Modern ${titleCasedSubject} Systems`
      ],
      companySizes: ['11–50', '51–200', '201–500'],
      queries: [`${titleCasedSubject} buyers in ${countries[0]}`, `Decision makers for ${titleCasedSubject}`],
      stages: [
        { name: 'Prospect' },
        { name: 'Contacted' },
        { name: 'Discovery Meeting' },
        { name: 'Proposal Sent' },
        { name: 'Closed Won', is_won: true },
        { name: 'Unresponsive / Lost', is_lost: true }
      ],
      explanation: `Configured as a B2B pipeline targeting executive decision-makers in ${countries.join(', ')}.`
    } : {
      mode: 'b2c',
      name: `${titleCasedSubject} Discovery`,
      industries: ['Consumer Services', 'Retail & Lifestyle', 'Commercial Services'],
      roles: ['Individual Client', 'Direct Buyer', 'Account Holder', 'Consumer'],
      personas: ['High-Intent Buyers', 'Qualified Consumers', 'Active Inquirers', `${titleCasedSubject} Seekers`],
      interests: [titleCasedSubject, `Premium ${titleCasedSubject}`, `${titleCasedSubject} Inquiries`, `Affordable ${titleCasedSubject}`],
      companySizes: ['1–10', '11–50'],
      queries: [`Looking for ${titleCasedSubject} in ${cities[0]}`, `${titleCasedSubject} inquiries`],
      stages: [
        { name: 'Inquiry' },
        { name: 'Contacted' },
        { name: 'Needs Assessment' },
        { name: 'Offer Presented' },
        { name: 'Closed Won', is_won: true },
        { name: 'Lost', is_lost: true }
      ],
      explanation: `Configured as a B2C consumer pipeline targeting individual buyers and clients in ${cities.slice(0, 3).join(', ')}.`
    };
  }

  // Determine mode: if user is currently on b2c or prompt requested customers/consumers, enforce b2c
  const effectiveMode = currentMode === 'b2c'
    ? 'b2c'
    : (p.includes('customer') && !p.includes('b2b enterprise') && !isB2bExplicit ? 'b2c' : matchedTemplate.mode);

  // Derive dynamic name with geography
  const pipelineName = matchedTemplate.name.toLowerCase().includes(countries[0].toLowerCase())
    ? matchedTemplate.name
    : `${countries[0]} ${matchedTemplate.name}`;

  // Ensure personas are never empty
  const defaultPersonas = (matchedTemplate.personas && matchedTemplate.personas.length > 0)
    ? matchedTemplate.personas
    : [
        `${titleCasedSubject} Decision Makers`,
        `Companies Seeking ${titleCasedSubject}`,
        `${titleCasedSubject} Buyers & Clients`,
        `Interested ${titleCasedSubject} Inquirers`
      ];

  // Ensure interests are never empty
  const defaultInterests = (matchedTemplate.interests && matchedTemplate.interests.length > 0)
    ? matchedTemplate.interests
    : [
        `${titleCasedSubject} Solutions`,
        `${titleCasedSubject} Inquiries`,
        `Enterprise ${titleCasedSubject}`,
        `Modern ${titleCasedSubject} Services`
      ];

  const defaultRoles = (matchedTemplate.roles && matchedTemplate.roles.length > 0)
    ? matchedTemplate.roles
    : ['Founder & CEO', 'Managing Director', 'VP Sales & Growth', 'Operations Director'];

  const defaultIndustries = (matchedTemplate.industries && matchedTemplate.industries.length > 0)
    ? matchedTemplate.industries
    : ['Technology & Software', 'Business Services', 'Commercial Enterprises'];

  const defaultCompanySizes = (matchedTemplate.companySizes && matchedTemplate.companySizes.length > 0)
    ? matchedTemplate.companySizes
    : ['11–50', '51–200', '201–500'];

  return {
    name: pipelineName,
    pipeline_type: 'cold',
    target_mode: effectiveMode,
    target_countries: countries,
    target_regions: cities,
    target_industries: defaultIndustries,
    target_company_sizes: defaultCompanySizes,
    target_roles: defaultRoles,
    target_personas: defaultPersonas,
    target_interests: defaultInterests,
    search_queries: matchedTemplate.queries || [`${matchedTemplate.name} in ${countries[0]}`],
    stages: matchedTemplate.stages,
    explanation: matchedTemplate.explanation
  };
}

/**
 * Calls OpenRouter / Gemini API if configured to generate high-creativity pipeline configurations.
 * Seamlessly falls back to heuristic engine if no API key is present or on any network fault.
 */
export async function generatePipelineConfigFromPrompt(userPrompt, options = {}) {
  if (!userPrompt || !userPrompt.trim()) {
    throw new Error('Please provide a prompt describing your target audience.');
  }

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    // Instant heuristic fallback
    return generateHeuristicPipelineConfig(userPrompt, options);
  }

  const currentMode = options?.currentMode;
  const systemPrompt = `You are a World-Class CRM Pipeline & Outbound Prospecting Architect.
The user will provide a business description or targeting goal (e.g. "I want to target companies who might need CRM software from startups, small to mid size companies").

CRITICAL B2B BUYER DISAMBIGUATION RULES:
1. OFFERING VS. BUYER INDUSTRY:
   - When the user is selling a B2B horizontal tool or service (such as CRM software, HRMS software, ERP, Accounting, Invoicing, Website Development, or Marketing):
     * NEVER set "target_industries" to Software, SaaS, IT, or Tech! Tech companies build software themselves and are NOT your target clients.
     * ALWAYS set "target_industries" to the actual NON-TECH commercial businesses that need this tool to run their day-to-day operations:
       - For CRM: ["Real Estate & Property Development", "Logistics & Supply Chain", "Clinics & Diagnostic Centers", "Interior Design & Architecture Studios", "Manufacturing & Wholesale Distribution", "Education & Coaching Academies", "Financial & Legal Services"]
       - For HRMS: ["Manufacturing & Factories", "Retail & Store Chains", "Hospitals & Healthcare Centers", "Logistics & Warehousing Hubs", "Security & Facility Management", "Hotels & Restaurant Chains"]
     * Set "target_roles" to actual SMB business owners: ["Founder & CEO", "Managing Director", "Business Owner", "General Manager", "Head of Operations"]. (NEVER CTO, VP Engineering, or DevOps leads).
     * Set "search_queries" to concrete local business types on Google Places (e.g. ["Real estate agencies in Bengaluru", "Logistics companies in Mumbai", "Interior design studios in Delhi NCR", "Diagnostic clinics in Hyderabad"]).

2. NO ABSTRACT REGIONS OR PLACEHOLDERS:
   - NEVER output abstract placeholders like "Major Metros", "Regional Hubs", "All Regions", or "Global".
   - "target_regions" MUST ALWAYS be real, concrete commercial cities:
     - For India: ["Bengaluru", "Mumbai", "Delhi NCR", "Pune", "Hyderabad", "Chennai"]
     - For US: ["New York", "San Francisco", "Austin", "Chicago", "Miami"]
     - For UK: ["London", "Manchester", "Birmingham"]
   - If no country is specified by the user, default "target_countries" to ["India"] and "target_regions" to Indian commercial hubs.

3. MANDATORY CRITERIA RULES:
   - "target_personas": 3-5 specific personas (e.g. ["SMB Business Owners", "Managing Directors", "Commercial Firm Leaders"]).
   - "target_interests": 3-5 specific product/service pain points (e.g. ["Lead Management CRM", "Customer Follow-up Automation", "Sales Pipeline Tracking"]).
   - "target_company_sizes": ["1–10", "11–50", "51–200"].

Return ONLY valid JSON matching this exact structure, with no markdown code blocks and no surrounding text:
{
  "name": "Concise Descriptive Pipeline Name",
  "pipeline_type": "cold",
  "target_mode": "b2b",
  "target_countries": ["Country 1"],
  "target_regions": ["City 1", "City 2", "City 3"],
  "target_industries": ["Industry 1", "Industry 2"],
  "target_company_sizes": ["1–10", "11–50", "51–200"],
  "target_roles": ["Role 1", "Role 2", "Role 3"],
  "target_personas": ["Persona 1", "Persona 2", "Persona 3"],
  "target_interests": ["Interest 1", "Interest 2", "Interest 3"],
  "search_queries": ["Search Query 1", "Search Query 2"],
  "stages": [
    { "name": "Prospect" },
    { "name": "Contacted" },
    { "name": "Meeting / Demo" },
    { "name": "Proposal Sent" },
    { "name": "Closed Won", "is_won": true },
    { "name": "Lost", "is_lost": true }
  ],
  "explanation": "Brief 1-2 sentence explanation of your design."
}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        'X-Title': 'SimpleCRM'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODELS[0] || 'google/gemini-2.0-flash-exp:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt.trim() }
        ],
        temperature: 0.2
      })
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content || '';
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed && parsed.name && Array.isArray(parsed.stages)) {
        const rawPersonas = Array.isArray(parsed.target_personas) && parsed.target_personas.length > 0
          ? parsed.target_personas
          : (Array.isArray(parsed.target_roles) && parsed.target_roles.length > 0 ? parsed.target_roles.map(r => `${r}s`) : ['Key Decision Makers', 'Active Buyers']);

        const rawInterests = Array.isArray(parsed.target_interests) && parsed.target_interests.length > 0
          ? parsed.target_interests
          : (Array.isArray(parsed.search_queries) && parsed.search_queries.length > 0 ? parsed.search_queries : [`${parsed.name} Solutions`]);

        const rawRoles = Array.isArray(parsed.target_roles) && parsed.target_roles.length > 0
          ? parsed.target_roles
          : ['Founder & CEO', 'Managing Director', 'Operations Director'];

        const rawIndustries = Array.isArray(parsed.target_industries) && parsed.target_industries.length > 0
          ? parsed.target_industries
          : ['Technology & Software', 'Commercial Services'];

        const inferredMode = currentMode === 'b2c'
          ? 'b2c'
          : (parsed.target_mode === 'b2c' ? 'b2c' : 'b2b');

        return {
          name: parsed.name,
          pipeline_type: 'cold',
          target_mode: inferredMode,
          target_countries: Array.isArray(parsed.target_countries) && parsed.target_countries.length > 0 ? parsed.target_countries : ['India'],
          target_regions: Array.isArray(parsed.target_regions) ? parsed.target_regions : [],
          target_industries: rawIndustries,
          target_company_sizes: Array.isArray(parsed.target_company_sizes) ? parsed.target_company_sizes : ['11–50', '51–200'],
          target_roles: rawRoles,
          target_personas: rawPersonas,
          target_interests: rawInterests,
          search_queries: Array.isArray(parsed.search_queries) ? parsed.search_queries : [],
          stages: parsed.stages,
          explanation: parsed.explanation || 'Configured via AI Assistant.'
        };
      }
    }
  } catch (err) {
    console.warn('AI API call failed or timed out, using heuristic generator:', err);
  }

  // Graceful fallback to heuristic generator
  return generateHeuristicPipelineConfig(userPrompt, options);
}
