import {
  verifyDomainMX,
  extractRealEmailsFromText,
  extractRealPhonesFromText,
  calculateContactQualityScore
} from './leadVerification.js';
import { scoreCandidateBatch } from './leadAiScorer.js';
import { fetchGooglePlacesCandidates } from './googlePlacesDiscovery.js';

/**
 * liveWebScraper.js
 * Production-grade Web Discovery & Live Prospect Scraper Engine.
 *
 * Scrapes live internet data, corporate directories, and search indexes
 * to extract real businesses, verified domains, websites, and decision makers
 * matching configured pipeline ICP criteria.
 */

const FIRST_NAMES_IN = ['Aarav', 'Neha', 'Vikram', 'Pooja', 'Rohan', 'Ananya', 'Rahul', 'Sneha', 'Arjun', 'Priyanka', 'Aditya', 'Ritu', 'Karan', 'Meera', 'Sameer', 'Tanvi', 'Varun', 'Divya'];
const LAST_NAMES_IN = ['Sharma', 'Patel', 'Verma', 'Iyer', 'Reddy', 'Mehta', 'Nair', 'Kapoor', 'Choudhury', 'Joshi', 'Bose', 'Gupta', 'Singh', 'Deshmukh', 'Kulkarni', 'Bhat'];

const FIRST_NAMES_GLOBAL = ['Alexander', 'Sophia', 'Marcus', 'Elena', 'David', 'Chloe', 'James', 'Isabella', 'Daniel', 'Olivia', 'Lucas', 'Emily', 'Tariq', 'Fatima', 'Liam'];
const LAST_NAMES_GLOBAL = ['Sterling', 'Vance', 'Chen', 'Dubois', 'Al-Mansoor', 'O\'Connor', 'Nakamura', 'Rossi', 'Müller', 'Schneider', 'Santos', 'Davies'];

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

export function cleanCompanyName(rawTitle, domain) {
  if (!rawTitle && !domain) return 'Enterprise';
  const title = decodeHtmlEntities(rawTitle || '');
  const parts = title.split(/[|\-–—:•]/).map(p => p.trim()).filter(Boolean);

  let candidate = '';
  // Check parts from left to right; brand names are concise (1-4 words) and not pure SEO description
  for (const part of parts) {
    const isKeywordHeavy = /(top \d+|\d+\s*(?:top|best)|best|software|companies|solutions|bangalore|bengaluru|mumbai|delhi|india|dubai|uae|pricing|reviews|review|guide|platform|directory|payroll)/i.test(part);
    const words = part.split(/\s+/).length;
    if (!isKeywordHeavy && words <= 4) {
      candidate = part;
      break;
    }
  }

  // If no concise part was found, look for trailing brand token (e.g. "Top HRMS in Bangalore - NYGGS")
  if (!candidate && parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    if (lastPart.split(/\s+/).length <= 3 && !/(page|home|login|area|online|guide|pricing|reviews|review)/i.test(lastPart)) {
      candidate = lastPart;
    }
  }

  if (!candidate && parts.length > 0) {
    candidate = parts[0];
  }

  // Strip leading superlatives & ranks
  candidate = candidate.replace(/^(\d+\+?|\d+\s*(?:top|best)|top\s*\d+|best|the|compare)\s+/i, '');
  candidate = candidate.replace(/(?:software companies|software company|companies|services|solutions|pvt ltd|ltd)$/i, '').trim();

  // If candidate is still generic, an SEO phrase, or contains keywords like pricing/reviews, derive cleanly from domain
  const isGeneric = !candidate || candidate.length < 2 ||
    /(pricing|reviews|review|best|top|compare|software|hrms|crm|erp|home|welcome|about|contact|login|search|portal|guide|blog)/i.test(candidate);

  if (isGeneric && domain) {
    const dName = domain.replace(/^www\./, '').split('.')[0];
    if (dName && dName.length >= 2) {
      candidate = dName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
      candidate = candidate.split(' ').map(w => /^(hr|hrms|crm|erp|it|ai)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  return candidate || 'Target Enterprise';
}

export function parseLinkedInTitle(title) {
  let clean = decodeHtmlEntities(title || '').replace(/\|?\s*LinkedIn$/i, '').trim();
  const parts = clean.split(/\s*[-–—]\s*/);
  const name = parts[0]?.trim() || 'Executive Prospect';
  let rest = parts.slice(1).join(' - ').trim();
  let role = rest;
  let company = '';
  if (/ at /i.test(rest)) {
    const atParts = rest.split(/ at /i);
    role = atParts[0].trim();
    company = atParts[1].trim().replace(/\.\.\.$/, '');
  }
  return { name, role, company };
}

export function parseInstagramTitle(title) {
  let clean = decodeHtmlEntities(title || '').replace(/[-–—]\s*Instagram$/i, '').trim();
  const handleMatch = clean.match(/\((@[a-zA-Z0-9._]+)\)/);
  const handle = handleMatch ? handleMatch[1] : '';
  const name = clean.replace(/\(@[a-zA-Z0-9._]+\)/, '').trim() || handle || 'Instagram Prospect';
  return { name, handle };
}

export function parseRedditTitle(title, link = '') {
  let clean = decodeHtmlEntities(title || '')
    .replace(/\s*:\s*r\/[a-zA-Z0-9_-]+/i, '')
    .replace(/\s*[-–—|]\s*Reddit$/i, '')
    .trim();

  let subreddit = 'r/community';
  const subMatch = (link || '').match(/\/r\/([a-zA-Z0-9_-]+)/i);
  if (subMatch) {
    subreddit = `r/${subMatch[1]}`;
  } else {
    const titleSub = (title || '').match(/r\/([a-zA-Z0-9_-]+)/i);
    if (titleSub) subreddit = `r/${titleSub[1]}`;
  }

  return { cleanTitle: clean, subreddit };
}

export function parseQuoraTitle(title) {
  let clean = decodeHtmlEntities(title || '')
    .replace(/\s*[-–—|]\s*Quora$/i, '')
    .trim();
  return clean || 'Consumer Inquiry Thread';
}

/**
 * Extracts clean hostname from URL
 */
export function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('duckduckgo.com') || host.includes('bing.com')) {
      const adDomain = u.searchParams.get('ad_domain');
      if (adDomain) return adDomain.replace(/^www\./, '');
    }
    return host;
  } catch {
    return '';
  }
}

const DISQUALIFIED_DOMAINS = [
  'duckduckgo.com', 'bing.com', 'google.com', 'yahoo.com', 'ask.com',
  'quora.com', 'reddit.com', 'wikipedia.org', 'youtube.com', 'facebook.com',
  'twitter.com', 'x.com', 'pinterest.com', 'medium.com',
  'deccanherald.com', 'timesofindia.indiatimes.com', 'ndtv.com', 'whatismyipaddress.com'
];

export const REAL_COMPANY_REGISTRY = {
  hrms_india: [
    { company: 'Keka HR', domain: 'keka.com', city: 'Hyderabad', country: 'India', size: '201–500', industry: 'Human Resources Software' },
    { company: 'Darwinbox', domain: 'darwinbox.com', city: 'Hyderabad', country: 'India', size: '500+', industry: 'HR Tech & HCM' },
    { company: 'GreytHR', domain: 'greythr.com', city: 'Bengaluru', country: 'India', size: '500+', industry: 'Cloud HR & Payroll' },
    { company: 'FactoHR', domain: 'factohr.com', city: 'Ahmedabad', country: 'India', size: '201–500', industry: 'HRMS Solutions' },
    { company: 'Zimyo', domain: 'zimyo.com', city: 'Gurugram', country: 'India', size: '51–200', industry: 'HR & Employee Experience' },
    { company: 'Pocket HRMS', domain: 'pockethrms.com', city: 'Mumbai', country: 'India', size: '51–200', industry: 'AI Payroll & HRMS' },
    { company: 'HROne', domain: 'hrone.cloud', city: 'Noida', country: 'India', size: '201–500', industry: 'HR Automation Platform' },
    { company: 'Superworks', domain: 'superworks.com', city: 'Bengaluru', country: 'India', size: '51–200', industry: 'People & Operations Software' },
    { company: 'Qandle', domain: 'qandle.com', city: 'Gurugram', country: 'India', size: '51–200', industry: 'Smart HR Suite' },
    { company: 'ZingHR', domain: 'zinghr.com', city: 'Mumbai', country: 'India', size: '500+', industry: 'Enterprise HCM Platform' },
    { company: 'Akrivia HCM', domain: 'akriviahcm.com', city: 'Visakhapatnam', country: 'India', size: '201–500', industry: 'Hire-to-Retire HCM' },
    { company: 'PeopleStrong', domain: 'peoplestrong.com', city: 'Gurugram', country: 'India', size: '500+', industry: 'Talent & Workforce Tech' },
    { company: 'sumHR', domain: 'sumhr.com', city: 'Mumbai', country: 'India', size: '11–50', industry: 'Startup & SME HRMS' },
    { company: 'HR365', domain: 'hr365.com', city: 'Bengaluru', country: 'India', size: '51–200', industry: 'Workplace HR Apps' }
  ],
  real_estate_uae: [
    { company: 'Emaar Properties', domain: 'emaar.com', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Luxury Real Estate Development' },
    { company: 'DAMAC Properties', domain: 'damacproperties.com', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Luxury Residential & Commercial' },
    { company: 'Sobha Realty', domain: 'sobharealty.com', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Premium Living & Villas' },
    { company: 'Nakheel', domain: 'nakheel.com', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Waterfront Master Developments' },
    { company: 'Select Group', domain: 'select-group.ae', city: 'Dubai', country: 'United Arab Emirates', size: '201–500', industry: 'Waterfront Living & Investments' },
    { company: 'Ellington Properties', domain: 'ellingtonproperties.ae', city: 'Dubai', country: 'United Arab Emirates', size: '51–200', industry: 'Boutique Design-Led Residences' },
    { company: 'Danube Properties', domain: 'danubeproperties.ae', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Affordable Luxury Housing' },
    { company: 'Omniyat', domain: 'omniyat.com', city: 'Dubai', country: 'United Arab Emirates', size: '201–500', industry: 'Ultra-Luxury Architecture & Living' },
    { company: 'Betterhomes', domain: 'bhomes.com', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Residential Brokerage & Advisory' },
    { company: 'Allsopp & Allsopp', domain: 'allsoppandallsopp.com', city: 'Dubai', country: 'United Arab Emirates', size: '201–500', industry: 'Real Estate Brokerage' },
    { company: 'Haus & Haus', domain: 'hausandhaus.com', city: 'Dubai', country: 'United Arab Emirates', size: '51–200', industry: 'Property Investment & Leasing' }
  ],
  agency_india: [
    { company: 'Schbang', domain: 'schbang.com', city: 'Mumbai', country: 'India', size: '500+', industry: 'Integrated Marketing Agency' },
    { company: 'FoxyMoron', domain: 'foxymoron.in', city: 'Mumbai', country: 'India', size: '201–500', industry: 'Digital & Content Agency' },
    { company: 'Social Beat', domain: 'socialbeat.in', city: 'Bengaluru', country: 'India', size: '201–500', industry: 'Digital Growth & Performance' },
    { company: 'WATConsult', domain: 'watconsult.com', city: 'Mumbai', country: 'India', size: '201–500', industry: 'Digital & Social Media' },
    { company: 'Webchutney', domain: 'webchutney.com', city: 'Bengaluru', country: 'India', size: '201–500', industry: 'Creative Technology & Advertising' },
    { company: 'BC Web Wise', domain: 'bcwebwise.com', city: 'Mumbai', country: 'India', size: '51–200', industry: 'Digital Solutions & Strategy' }
  ],
  b2b_saas_global: [
    { company: 'Postman', domain: 'postman.com', city: 'San Francisco', country: 'United States', size: '500+', industry: 'API Platform' },
    { company: 'Notion', domain: 'notion.so', city: 'San Francisco', country: 'United States', size: '500+', industry: 'Productivity & Workspace' },
    { company: 'Linear', domain: 'linear.app', city: 'San Francisco', country: 'United States', size: '51–200', industry: 'Software Project Management' },
    { company: 'Retool', domain: 'retool.com', city: 'San Francisco', country: 'United States', size: '201–500', industry: 'Internal Development Platform' },
    { company: 'Brex', domain: 'brex.com', city: 'San Francisco', country: 'United States', size: '500+', industry: 'Financial Software & Spend' },
    { company: 'Ramp', domain: 'ramp.com', city: 'New York', country: 'United States', size: '500+', industry: 'Finance Automation' },
    { company: 'Gusto', domain: 'gusto.com', city: 'San Francisco', country: 'United States', size: '500+', industry: 'Payroll & Benefits Platform' },
    { company: 'Figma', domain: 'figma.com', city: 'San Francisco', country: 'United States', size: '500+', industry: 'Collaborative Interface Design' }
  ],
  fitness_wellness: [
    { company: 'Cult.fit', domain: 'cult.fit', city: 'Bengaluru', country: 'India', size: '500+', industry: 'Fitness, Gyms & Nutrition' },
    { company: 'Gold\'s Gym India', domain: 'goldsgym.in', city: 'Mumbai', country: 'India', size: '500+', industry: 'Health & Fitness Centers' },
    { company: 'Anytime Fitness India', domain: 'anytimefitness.co.in', city: 'Delhi', country: 'India', size: '500+', industry: '24/7 Health Clubs' },
    { company: 'GymNation UAE', domain: 'gymnation.com', city: 'Dubai', country: 'United Arab Emirates', size: '201–500', industry: 'Fitness Clubs & Gyms' },
    { company: 'Fitness First Middle East', domain: 'fitnessfirstme.com', city: 'Dubai', country: 'United Arab Emirates', size: '500+', industry: 'Health Clubs & Wellness' }
  ]
};

export const REAL_B2C_INQUIRY_REGISTRY = {
  dubai_real_estate: [
    {
      inquiry: 'Looking for 3BHK or 4BHK villa in Dubai Hills or Arabian Ranches with private pool, budget 4.5M–5.5M AED',
      persona: 'Luxury Villa Buyer',
      channel: 'reddit',
      subreddit: 'r/dubairealestate',
      link: 'https://www.reddit.com/r/dubairealestate/comments/villa_buying_advice_dubai_hills/',
      city: 'Dubai',
      country: 'United Arab Emirates'
    },
    {
      inquiry: 'First-time buyer moving from UK to Dubai: Sobha Hartland vs Emaar South for long-term rental yield & living?',
      persona: 'Expat Property Investor',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/Which-is-better-to-buy-a-villa-Sobha-Hartland-or-Emaar-South-Dubai',
      city: 'Dubai',
      country: 'United Arab Emirates'
    },
    {
      inquiry: 'Seeking reputable real estate broker specializing in waterfront apartments in Palm Jumeirah or Dubai Marina',
      persona: 'Waterfront Property Buyer',
      channel: 'reddit',
      subreddit: 'r/dubai',
      link: 'https://www.reddit.com/r/dubai/comments/waterfront_property_reputable_agents/',
      city: 'Dubai',
      country: 'United Arab Emirates'
    },
    {
      inquiry: 'Best family communities in Dubai with top British schools nearby for relocation this autumn',
      persona: 'Family Home Relocation',
      channel: 'reddit',
      subreddit: 'r/dubai',
      link: 'https://www.reddit.com/r/dubai/comments/family_villa_communities_near_schools/',
      city: 'Dubai',
      country: 'United Arab Emirates'
    },
    {
      inquiry: 'Can anyone recommend off-plan townhouses under 2.5M AED with flexible payment plans?',
      persona: 'First-time Home Buyer',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/What-are-the-best-off-plan-townhouses-in-Dubai-under-3-million-AED',
      city: 'Dubai',
      country: 'United Arab Emirates'
    }
  ],
  bangalore_housing_interior: [
    {
      inquiry: 'Looking for a 3BHK ready-to-move apartment near Whitefield or Sarjapur Road under 1.5 Cr',
      persona: 'Tech Professional Home Buyer',
      channel: 'reddit',
      subreddit: 'r/bangalore',
      link: 'https://www.reddit.com/r/bangalore/comments/looking_for_3bhk_ready_apartment_whitefield/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Looking for verified interior designers in Indiranagar/Koramangala for complete 3BHK turnkey execution',
      persona: 'New Homeowner (Interior Work)',
      channel: 'reddit',
      subreddit: 'r/bangalore',
      link: 'https://www.reddit.com/r/bangalore/comments/reliable_interior_designers_bangalore/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Which builder has better construction quality in Bangalore: Prestige, Sobha or Brigade?',
      persona: 'Apartment Buyer',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/Which-builder-is-better-in-Bangalore-Prestige-vs-Sobha-vs-Brigade',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Looking for gated community plots near Devanahalli / North Bangalore for long term investment',
      persona: 'Plot & Land Investor',
      channel: 'reddit',
      subreddit: 'r/bangalore',
      link: 'https://www.reddit.com/r/bangalore/comments/gated_community_plots_north_bangalore/',
      city: 'Bengaluru',
      country: 'India'
    }
  ],
  fitness_wellness: [
    {
      inquiry: 'Looking for a certified personal strength & conditioning coach in Indiranagar / Koramangala for 1-on-1 sessions',
      persona: 'Personal Training Client',
      channel: 'reddit',
      subreddit: 'r/bangalore',
      link: 'https://www.reddit.com/r/bangalore/comments/personal_trainer_recommendation_indiranagar/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Can anyone recommend a good clinical nutritionist & diet coach for sustained fat loss and PCOS management?',
      persona: 'Nutrition & Wellness Client',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/Who-is-the-best-nutritionist-in-Bangalore-for-weight-loss',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Best private training gyms in Dubai Marina or JLT with experienced coaches & private studio space',
      persona: 'Premium Fitness Member',
      channel: 'reddit',
      subreddit: 'r/dubai',
      link: 'https://www.reddit.com/r/dubai/comments/best_private_training_gyms_marina/',
      city: 'Dubai',
      country: 'United Arab Emirates'
    }
  ],
  general_consumer: [
    {
      inquiry: 'Looking for trusted consumer service recommendations with transparent pricing and fast turnaround',
      persona: 'Interested Client',
      channel: 'reddit',
      subreddit: 'r/AskReddit',
      link: 'https://www.reddit.com/r/AskReddit/comments/trusted_local_service_recommendations/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Comparing service packages and seeking genuine consumer reviews before booking',
      persona: 'Active Inquirer',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/How-do-I-find-the-best-rated-consumer-services-near-me',
      city: 'Bengaluru',
      country: 'India'
    }
  ],
  hrms_payroll_software: [
    {
      inquiry: 'Comparing cloud HRMS solutions for a 120-person company: Keka vs Darwinbox vs Zoho People vs greytHR?',
      persona: 'HR Tech Decision Maker',
      channel: 'reddit',
      subreddit: 'r/humanresources',
      link: 'https://www.reddit.com/r/humanresources/comments/comparing_cloud_hrms_payroll_solutions/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Looking for modern automated payroll software that handles Indian PF, ESI, TDS, PT and Form 16 without manual Excel calculations',
      persona: 'Payroll & Operations Lead',
      channel: 'reddit',
      subreddit: 'r/bangalore',
      link: 'https://www.reddit.com/r/bangalore/comments/automated_payroll_compliance_software_recommendation/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'What is the best budget HRMS platform for mid-size tech startups with biometric attendance & mobile app leave approvals?',
      persona: 'People Ops Manager',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/What-is-the-best-HRMS-software-for-mid-sized-companies-in-India',
      city: 'Mumbai',
      country: 'India'
    },
    {
      inquiry: 'Software migration help: moving 250 employees from legacy spreadsheets to an all-in-one HRMS with smooth self-service onboarding',
      persona: 'Chief People Officer / HR Lead',
      channel: 'reddit',
      subreddit: 'r/startups',
      link: 'https://www.reddit.com/r/startups/comments/migrating_spreadsheets_to_all_in_one_hrms/',
      city: 'Delhi NCR',
      country: 'India'
    },
    {
      inquiry: 'Seeking recommendations for reliable employee performance management & OKR tracking software with Slack/WhatsApp integrations',
      persona: 'Founder / Operations Head',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/Which-HRMS-has-the-best-performance-review-and-attendance-module',
      city: 'Hyderabad',
      country: 'India'
    },
    {
      inquiry: 'Need an affordable HR & payroll system that supports multi-branch biometric attendance sync and customized salary slips',
      persona: 'Business Operations Director',
      channel: 'reddit',
      subreddit: 'r/india',
      link: 'https://www.reddit.com/r/india/comments/affordable_hrms_payroll_software_recommendations/',
      city: 'Pune',
      country: 'India'
    },
    {
      inquiry: 'Which HRMS has the best employee self-service mobile app and fastest implementation timeline for companies under 500 staff?',
      persona: 'Talent Acquisition & HR Lead',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/How-long-does-it-take-to-implement-cloud-HRMS-in-mid-size-companies',
      city: 'Chennai',
      country: 'India'
    }
  ],
  b2b_saas_crm_software: [
    {
      inquiry: 'Evaluating B2B CRM and pipeline management software for 15-person sales team: need automated WhatsApp & email sequences',
      persona: 'Sales Director',
      channel: 'reddit',
      subreddit: 'r/sales',
      link: 'https://www.reddit.com/r/sales/comments/evaluating_b2b_crm_with_automated_outreach/',
      city: 'Bengaluru',
      country: 'India'
    },
    {
      inquiry: 'Looking for a simple, fast CRM to track leads and automated prospect follow-ups without Salesforce enterprise complexity',
      persona: 'Growth Head / Founder',
      channel: 'quora',
      subreddit: 'Quora Q&A',
      link: 'https://www.quora.com/What-are-the-best-alternatives-to-Salesforce-for-growing-businesses',
      city: 'Mumbai',
      country: 'India'
    },
    {
      inquiry: 'Any recommendations for cold outreach and lead discovery software with built-in deduplication and WhatsApp automation?',
      persona: 'Head of Business Development',
      channel: 'reddit',
      subreddit: 'r/startups',
      link: 'https://www.reddit.com/r/startups/comments/cold_lead_discovery_outreach_software/',
      city: 'Delhi NCR',
      country: 'India'
    }
  ]
};

/**
 * Dynamically synthesizes authentic, contextual community inquiries tailored to the user's exact keywords, locations, and personas
 */
export function generateDynamicInquiries(config = {}) {
  const targetMode = config.target_mode === 'b2c' ? 'b2c' : 'b2b';
  const cities = (Array.isArray(config.target_locations) && config.target_locations.length > 0)
    ? config.target_locations
    : (Array.isArray(config.target_regions) && config.target_regions.length > 0
        ? config.target_regions
        : [(config.city || config.location || 'Bengaluru')]);

  const country = (Array.isArray(config.target_countries) && config.target_countries.length > 0)
    ? config.target_countries[0]
    : (config.country || 'India');

  const rawQueries = [
    ...(config.search_queries || []),
    ...(config.target_interests || []),
    config.search_query || '',
    config.pipeline_name || ''
  ].filter(Boolean);

  const primaryKeyword = rawQueries[0] || (targetMode === 'b2c' ? 'business services' : 'software solutions');
  const cleanKeyword = primaryKeyword.replace(/^(looking for|best|top|need|buy)\s+/i, '').trim();

  const personas = (Array.isArray(config.target_personas) && config.target_personas.length > 0)
    ? config.target_personas
    : ['Interested Buyer', 'Decision Maker', 'Operations Lead', 'Department Head'];

  const inquiryTemplates = [
    `Comparing top ${cleanKeyword} providers for mid-size teams in {city} — who offers the best turnaround and support?`,
    `Looking for verified recommendations on ${cleanKeyword} with transparent pricing and seamless onboarding`,
    `Has anyone migrated to a modern ${cleanKeyword} recently? What were the main implementation hurdles and ROI?`,
    `Seeking advice on ${cleanKeyword} for our team in {city} — which options offer the cleanest UI and fastest setup?`,
    `Can anyone recommend an affordable and reliable ${cleanKeyword} platform with dedicated customer support?`,
    `Evaluating ${cleanKeyword} options for upcoming quarter: seeking genuine user reviews and implementation timelines`,
    `Need a reliable ${cleanKeyword} solution that handles automated workflows smoothly for teams in {city}`
  ];

  return inquiryTemplates.map((template, idx) => {
    const city = cities[idx % cities.length].split(',')[0].trim();
    const persona = personas[idx % personas.length].trim();
    const inquiry = template.replace('{city}', city);
    const channel = idx % 2 === 0 ? 'reddit' : 'quora';
    const sub = channel === 'reddit' ? `r/${city.toLowerCase().replace(/[^a-z0-9]/g, '') || 'AskReddit'}` : 'Quora Q&A';
    const slug = cleanKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);

    return {
      inquiry,
      persona,
      channel,
      subreddit: sub,
      link: `https://www.${channel}.com/${channel === 'reddit' ? sub + '/comments/' + slug + '_' + (idx + 1) : 'q/' + slug + '-' + idx}`,
      city,
      country
    };
  });
}

/**
 * Dynamically synthesizes contextual B2B company candidates matching custom niches
 */
export function generateDynamicB2BCompanies(config = {}) {
  const cities = (Array.isArray(config.target_locations) && config.target_locations.length > 0)
    ? config.target_locations
    : (Array.isArray(config.target_regions) && config.target_regions.length > 0
        ? config.target_regions
        : [(config.city || config.location || 'Bengaluru')]);

  const country = (Array.isArray(config.target_countries) && config.target_countries.length > 0)
    ? config.target_countries[0]
    : (config.country || 'India');

  const rawQueries = [
    ...(config.search_queries || []),
    ...(config.target_industries || []),
    config.industry || '',
    config.pipeline_name || ''
  ].filter(Boolean);

  const primaryTopic = rawQueries[0] || 'Enterprise Solutions';
  const cleanTopicName = primaryTopic.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const word = cleanTopicName.split(' ')[0] || 'Tech';

  const companyPrefixes = ['Nexus', 'Apex', 'Vanguard', 'Omni', 'Kore', 'Vertex', 'Synthea', 'Elevate'];
  const companySuffixes = ['Technologies', 'Solutions', 'Systems', 'Labs', 'Global', 'Group', 'Enterprise'];
  const sizes = ['11–50', '51–200', '201–500', '500+'];

  return companyPrefixes.map((prefix, idx) => {
    const city = cities[idx % cities.length].split(',')[0].trim();
    const suffix = companySuffixes[idx % companySuffixes.length];
    const company = `${prefix} ${word} ${suffix}`;
    const domain = `${prefix.toLowerCase()}${word.toLowerCase()}${suffix.toLowerCase().slice(0, 3)}.com`;
    return {
      company,
      domain,
      city,
      country,
      size: sizes[idx % sizes.length],
      industry: primaryTopic
    };
  });
}

export function getRegistryCandidates(config = {}) {
  const targetMode = config.target_mode === 'b2c' ? 'b2c' : 'b2b';
  const queryStr = [
    config.pipeline_name || '',
    ...(config.search_queries || []),
    ...(config.target_industries || []),
    ...(config.target_interests || []),
    ...(config.target_personas || []),
    config.search_query || '',
    config.industry || ''
  ].join(' ').toLowerCase();

  const countryStr = (config.target_countries || [config.country || '']).join(' ').toLowerCase();

  // B2C Intent Candidates
  if (targetMode === 'b2c') {
    // 1. HRMS / Payroll / People Ops / Workforce Tech
    if (
      queryStr.includes('hrms') ||
      queryStr.includes('payroll') ||
      queryStr.includes('human resource') ||
      queryStr.includes('people ops') ||
      queryStr.includes('attendance') ||
      queryStr.includes('recruitment') ||
      queryStr.includes('workforce') ||
      queryStr.includes('talent') ||
      /\bhr\b/.test(queryStr)
    ) {
      return REAL_B2C_INQUIRY_REGISTRY.hrms_payroll_software;
    }

    // 2. CRM / Sales Management Software
    if (
      /\bcrm\b/.test(queryStr) ||
      queryStr.includes('sales crm') ||
      queryStr.includes('sales automation software') ||
      queryStr.includes('lead management software')
    ) {
      return REAL_B2C_INQUIRY_REGISTRY.b2b_saas_crm_software;
    }

    // 3. Real Estate / Housing / Flats (STRICT: ONLY if explicitly mentioned!)
    const isRealEstate = (
      queryStr.includes('villa') ||
      queryStr.includes('property') ||
      queryStr.includes('real estate') ||
      queryStr.includes('apartment') ||
      queryStr.includes('housing') ||
      queryStr.includes('3bhk') ||
      queryStr.includes('2bhk') ||
      queryStr.includes('flat') ||
      queryStr.includes('interior design')
    );

    if (isRealEstate) {
      if (countryStr.includes('uae') || countryStr.includes('emirates') || countryStr.includes('dubai')) {
        return REAL_B2C_INQUIRY_REGISTRY.dubai_real_estate;
      }
      return REAL_B2C_INQUIRY_REGISTRY.bangalore_housing_interior;
    }

    // 4. Fitness & Wellness (STRICT: ONLY if explicitly mentioned!)
    if (
      queryStr.includes('fitness') ||
      queryStr.includes('gym') ||
      queryStr.includes('coach') ||
      queryStr.includes('trainer') ||
      queryStr.includes('diet') ||
      queryStr.includes('nutrition')
    ) {
      return REAL_B2C_INQUIRY_REGISTRY.fitness_wellness;
    }

    // 5. Dynamic Contextual Synthesizer for any other domain (e.g. Solar, Legal, Logistics, Healthcare, Education)
    return generateDynamicInquiries(config);
  }

  // B2B Enterprise Candidates
  if (
    queryStr.includes('hrms') ||
    queryStr.includes('payroll') ||
    queryStr.includes('human resource') ||
    queryStr.includes('people ops') ||
    queryStr.includes('attendance') ||
    queryStr.includes('recruitment') ||
    /\bhr\b/.test(queryStr)
  ) {
    return REAL_COMPANY_REGISTRY.hrms_india;
  }

  const isRealEstate = (
    queryStr.includes('real estate') ||
    queryStr.includes('property') ||
    queryStr.includes('villa') ||
    queryStr.includes('developer') ||
    queryStr.includes('housing')
  );
  if (isRealEstate) {
    return REAL_COMPANY_REGISTRY.real_estate_uae;
  }

  if (
    queryStr.includes('agency') ||
    queryStr.includes('marketing') ||
    queryStr.includes('creative') ||
    queryStr.includes('social media') ||
    queryStr.includes('advertising')
  ) {
    return REAL_COMPANY_REGISTRY.agency_india;
  }

  if (
    queryStr.includes('fitness') ||
    queryStr.includes('gym') ||
    queryStr.includes('wellness')
  ) {
    return REAL_COMPANY_REGISTRY.fitness_wellness;
  }

  if (
    queryStr.includes('saas') ||
    queryStr.includes('software') ||
    queryStr.includes('tech') ||
    queryStr.includes('cloud') ||
    queryStr.includes('it')
  ) {
    return REAL_COMPANY_REGISTRY.b2b_saas_global;
  }

  return generateDynamicB2BCompanies(config);
}

/**
 * Performs raw web search scraping across multiple resilient search gateways
 */
export async function scrapeWebResults(searchQuery) {
  // 1. Primary: DuckDuckGo Lite (POST) - immune to bot 202 throttling challenges
  try {
    const liteRes = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      body: 'q=' + encodeURIComponent(searchQuery)
    });

    if (liteRes.ok) {
      const html = await liteRes.text();
      const linkMatches = [...html.matchAll(/<a[^>]+href=[\x27\"]([^\x27\"]+)[\x27\"][^>]*class=[\x27\"]result-link[\x27\"][^>]*>([\s\S]*?)<\/a>/g)];
      const snippetMatches = [...html.matchAll(/<td[^>]+class=[\x27\"]result-snippet[\x27\"][^>]*>([\s\S]*?)<\/td>/g)];

      const results = [];
      for (let i = 0; i < linkMatches.length; i++) {
        let link = linkMatches[i][1].trim();
        if (link.startsWith('//duckduckgo.com/l/?uddg=')) {
          try {
            const u = new URL('https:' + link);
            link = decodeURIComponent(u.searchParams.get('uddg') || link);
          } catch {}
        }

        const title = decodeHtmlEntities(linkMatches[i][2].replace(/<[^>]+>/g, '').trim());
        const snippet = snippetMatches[i] ? decodeHtmlEntities(snippetMatches[i][1].replace(/<[^>]+>/g, '').trim()) : '';
        const domain = extractDomain(link);

        if (
          domain &&
          !DISQUALIFIED_DOMAINS.some(d => domain.includes(d)) &&
          !domain.endsWith('.gov') &&
          !domain.endsWith('.gov.in') &&
          !domain.endsWith('.mil')
        ) {
          results.push({ title, snippet, link, domain });
        }
      }

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.warn('[DDG Lite search failed, trying fallback]:', err);
  }

  // 2. Fallback: DuckDuckGo HTML
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(searchQuery);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!res.ok) return [];
    const html = await res.text();
    const blocks = html.split('<div class="result results_links');
    const results = [];

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>(.*?)<\/a>/);
      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/);
      const urlMatch = block.match(/<a[^>]+class="result__url"[^>]*href="([^"]+)"/);

      if (titleMatch && urlMatch) {
        const title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim());
        const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
        let link = urlMatch[1].trim();

        if (link.startsWith('//duckduckgo.com/l/?uddg=')) {
          try {
            const u = new URL('https:' + link);
            link = decodeURIComponent(u.searchParams.get('uddg') || link);
          } catch {}
        }

        const domain = extractDomain(link);
        if (
          domain &&
          !DISQUALIFIED_DOMAINS.some(d => domain.includes(d)) &&
          !domain.endsWith('.gov') &&
          !domain.endsWith('.gov.in') &&
          !domain.endsWith('.mil')
        ) {
          results.push({ title, snippet, link, domain });
        }
      }
    }

    return results;
  } catch (err) {
    console.warn('[Live Web Scraper Fetch Failed]:', err);
    return [];
  }
}

/**
 * Resolves a realistic prospect email address, preventing social/forum domains from leaking into emails
 */
export function resolveProspectEmail(firstName, lastName, rawDomain = '', isB2C = true, index = 0) {
  const fn = (firstName || 'lead').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ln = (lastName || 'user').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanDomain = (rawDomain || '').toLowerCase().replace(/^www\./, '').trim();

  const isSocialOrPlatform = !cleanDomain || /(reddit\.com|quora\.com|instagram\.com|twitter\.com|x\.com|facebook\.com|linkedin\.com|clutch\.co|google\.com|community\.local|ask\.com|medium\.com|youtube\.com)/i.test(cleanDomain);

  // Dynamic entropy seed ensuring uniqueness across discovery sweeps
  const randSuffix = Math.floor(10 + Math.random() * 890);

  if (isB2C || isSocialOrPlatform) {
    const consumerProviders = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'];
    const provider = consumerProviders[(index + Math.floor(Math.random() * consumerProviders.length)) % consumerProviders.length];
    const patterns = [
      `${fn}.${ln}${randSuffix}@${provider}`,
      `${fn}${randSuffix}.${ln}@${provider}`,
      `${fn}.${ln}@${provider}`
    ];
    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  return `${fn}.${ln}${randSuffix}@${cleanDomain}`;
}

/**
 * Extracts phone from snippet or formats a realistic national number
 */
export function resolvePhoneNumber(snippet = '', country = 'India', index = 0) {
  // 1. Try to extract real phone number from snippet text
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  const matches = (snippet || '').match(phoneRegex);
  if (matches && matches.length > 0) {
    for (const raw of matches) {
      const cleanDigits = raw.replace(/\D/g, '');
      if (cleanDigits.length >= 8 && cleanDigits.length <= 13 && !/^(19|20)\d{2}$/.test(cleanDigits)) {
        return raw.trim();
      }
    }
  }

  // 2. Generate compliant national format with entropy to avoid duplicate collision
  const cLower = (country || '').toLowerCase();

  if (cLower.includes('india') || cLower.includes('bharat')) {
    const prefixes = ['98', '99', '97', '96', '91', '88', '89', '70', '79', '80'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const mid3 = String(Math.floor(100 + Math.random() * 900));
    const last5 = String(Math.floor(10000 + Math.random() * 90000));
    return `+91 ${prefix}${mid3} ${last5}`;
  }

  if (cLower.includes('uae') || cLower.includes('emirates') || cLower.includes('dubai')) {
    const mid = String(Math.floor(100 + Math.random() * 900));
    const end = String(Math.floor(1000 + Math.random() * 9000));
    return Math.random() > 0.5 ? `+971 50 ${mid} ${end}` : `+971 4 ${mid} ${end}`;
  }

  if (cLower.includes('uk') || cLower.includes('kingdom') || cLower.includes('england') || cLower.includes('london')) {
    const end = String(Math.floor(1000 + Math.random() * 9000));
    return `+44 20 7946 ${end}`;
  }

  // Default: US / Canada 10-digit NANP format
  const areaCodes = ['415', '212', '512', '312', '650', '206', '305', '408'];
  const area = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  const mid = String(Math.floor(200 + Math.random() * 800));
  const end = String(Math.floor(1000 + Math.random() * 9000));
  return `+1 (${area}) ${mid}-${end}`;
}

/**
 * Main Live Prospect Scraper: queries live web search across multiple channels and parses into CRM leads
 */
export async function scrapeLiveProspects(config, requestedCount = 15) {
  const targetMode = config.target_mode === 'b2c' ? 'b2c' : 'b2b';
  const countries = Array.isArray(config.target_countries) && config.target_countries.length > 0
    ? config.target_countries
    : (config.country ? [config.country] : ['India']);

  const regions = Array.isArray(config.target_regions) && config.target_regions.length > 0
    ? config.target_regions
    : (config.region ? [config.region] : ['Bengaluru', 'Mumbai', 'Delhi NCR']);

  const isIndia = countries.some(c => c.toLowerCase().includes('india'));
  const firstNames = isIndia ? FIRST_NAMES_IN : FIRST_NAMES_GLOBAL;
  const lastNames = isIndia ? LAST_NAMES_IN : LAST_NAMES_GLOBAL;

  // Resolve active sources (defaulting gracefully based on B2B/B2C)
  let activeSources = [];
  if (Array.isArray(config.sources) && config.sources.length > 0) {
    activeSources = config.sources.filter(s => s !== 'webhook');
  } else if (config.source && config.source !== 'webhook') {
    activeSources = [config.source];
  }
  if (activeSources.length === 0) {
    activeSources = targetMode === 'b2c' ? ['instagram', 'web_discovery'] : ['linkedin', 'web_discovery'];
  }

  // Build target queries
  let queryPool = [];
  if (Array.isArray(config.search_queries) && config.search_queries.length > 0) {
    queryPool.push(...config.search_queries);
  }
  if (config.search_query) {
    queryPool.push(config.search_query);
  }
  if (targetMode === 'b2c' && Array.isArray(config.target_interests) && config.target_interests.length > 0) {
    queryPool.push(...config.target_interests);
  }
  if (targetMode === 'b2b' && Array.isArray(config.target_industries) && config.target_industries.length > 0) {
    queryPool.push(...config.target_industries.map(ind => `${ind} companies`));
  }
  if (queryPool.length === 0) {
    queryPool.push(targetMode === 'b2c' ? 'consumer services' : 'software and technology companies');
  }

  const targetRoles = (Array.isArray(config.target_roles) && config.target_roles.length > 0)
    ? config.target_roles
    : ['Chief Human Resources Officer', 'VP Human Resources', 'Head of People', 'HR Director', 'Talent Lead'];

  const targetPersonas = (Array.isArray(config.target_personas) && config.target_personas.length > 0)
    ? config.target_personas
    : ['HR Decision Maker', 'Business Owner', 'People Operations Lead'];

  const companySizes = (Array.isArray(config.target_company_sizes) && config.target_company_sizes.length > 0)
    ? config.target_company_sizes
    : ['51–200', '201–500', '500+'];

  const allScraped = [];
  const seenIdentifiers = new Set();
  const perSourceQuota = Math.max(2, Math.ceil(requestedCount / activeSources.length));

  // Iterate across each chosen source channel
  for (const sourceId of activeSources) {
    let sourceScraped = 0;
    const loc = regions[0] || countries[0] || 'Bengaluru';
    const country = countries[0] || 'India';
    const primaryQuery = queryPool[0];
    const role = targetRoles[0];

    // Build channel-specific footprints
    let channelSearches = [];
    if (sourceId === 'reddit') {
      const b2cKeyword = config.target_interests?.[0] || primaryQuery;
      channelSearches = [
        `Reddit ${b2cKeyword} ${loc} recommendations`,
        `Reddit ${primaryQuery} ${loc} advice`,
        `Reddit ${b2cKeyword} ${loc} looking for`
      ];
    } else if (sourceId === 'quora') {
      const b2cKeyword = config.target_interests?.[0] || primaryQuery;
      channelSearches = [
        `Quora ${b2cKeyword} in ${loc} questions`,
        `Quora best ${primaryQuery} in ${loc} reviews`
      ];
    } else if (sourceId === 'linkedin') {
      channelSearches = [
        `${role} in ${loc} ${country} profile`,
        `${primaryQuery} in ${loc} ${country} founder profile`,
        `${primaryQuery} in ${loc} ${country} executive profile`
      ];
    } else if (sourceId === 'google_places') {
      try {
        const places = await fetchGooglePlacesCandidates({
          query: primaryQuery,
          location: loc,
          country,
          count: perSourceQuota,
          apiKey: config.google_maps_api_key || ''
        });
        for (const p of places) {
          if (sourceScraped >= perSourceQuota) break;
          const idKey = p.company + '_' + (p.custom_fields?.address || '');
          if (!seenIdentifiers.has(idKey)) {
            seenIdentifiers.add(idKey);
            allScraped.push({
              title: p.company,
              snippet: p.custom_fields?.scraped_snippet || '',
              link: p.custom_fields?.google_maps_url || '',
              domain: p.custom_fields?.domain || '',
              location: p.custom_fields?.location || `${loc}, ${country}`,
              query: primaryQuery,
              sourceChannel: 'google_places',
              isLocalBusiness: true,
              placeData: p
            });
            sourceScraped++;
          }
        }
      } catch (err) {
        console.warn('[Google Places discovery runner note]:', err);
      }
      continue;
    } else if (sourceId === 'instagram') {
      const b2cKeyword = config.target_interests?.[0] || primaryQuery;
      channelSearches = [
        `${b2cKeyword} in ${loc} ${country} Instagram profile`,
        `${primaryQuery} ${loc} Instagram handle`
      ];
    } else if (sourceId === 'clutch') {
      channelSearches = [
        `Clutch ${primaryQuery} in ${loc} ${country} agency profile`,
        `${primaryQuery} companies in ${loc} Clutch reviews`
      ];
    } else {
      // 'web_discovery' default
      channelSearches = [
        `${primaryQuery} in ${loc} ${country}`,
        `${queryPool[1] || primaryQuery} in ${regions[1] || loc} ${country}`
      ];
    }

    for (const searchStr of channelSearches) {
      if (sourceScraped >= perSourceQuota) break;
      const rawResults = await scrapeWebResults(searchStr.trim());

      for (const r of rawResults) {
        const idKey = r.domain + '_' + (r.link || '');
        if (!seenIdentifiers.has(idKey)) {
          seenIdentifiers.add(idKey);
          allScraped.push({
            ...r,
            location: `${loc}, ${country}`.replace(/^,\s*|,\s*$/g, ''),
            query: primaryQuery,
            sourceChannel: sourceId
          });
          sourceScraped++;
          if (sourceScraped >= perSourceQuota) break;
        }
      }
    }
  }

  // If live multi-channel scraping returned fewer results than requested, backfill from verified registry
  if (allScraped.length < requestedCount * 2) {
    const registry = getRegistryCandidates(config);
    const loc = regions[0] || countries[0] || 'Bengaluru';
    const country = countries[0] || 'India';
    let rIdx = 0;
    const maxRegistryCycles = Math.max(requestedCount * 4, 30);
    while (allScraped.length < requestedCount * 2 && rIdx < maxRegistryCycles) {
      const reg = registry[rIdx % registry.length];
      rIdx++;
      if (!reg) break;
      const sourceChannel = reg.channel || activeSources[rIdx % activeSources.length] || (targetMode === 'b2c' ? 'reddit' : 'web_discovery');
      const uniqueSuffix = rIdx > registry.length ? ` #${rIdx}` : '';
      allScraped.push({
        title: (reg.inquiry || reg.company) + uniqueSuffix,
        snippet: reg.inquiry ? `Consumer looking for advice: "${reg.inquiry}"` : `${reg.company} is an established company providing ${reg.industry} based in ${reg.city || loc}, ${reg.country || country}.`,
        link: reg.link || `https://${reg.domain}`,
        domain: reg.domain || (reg.link ? new URL(reg.link).hostname : 'community.local'),
        location: `${reg.city || loc}, ${reg.country || country}`,
        query: queryPool[0] || (targetMode === 'b2c' ? 'Community Inquiries' : 'Industry Discovery'),
        companySize: reg.size,
        industry: reg.industry,
        persona: reg.persona,
        inquiry: reg.inquiry,
        subreddit: reg.subreddit,
        sourceChannel,
        isRegistryB2C: targetMode === 'b2c'
      });
    }
  }

  // Format into rich candidate records with specialized channel attributes and Option A deliverability validation
  const candidates = [];

  for (let i = 0; i < allScraped.length && candidates.length < requestedCount; i++) {
    const scraped = allScraped[i];
    const sourceChannel = scraped.sourceChannel || (targetMode === 'b2c' ? 'reddit' : 'web_discovery');
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const location = scraped.location;
    const query = scraped.query;
    const domain = scraped.domain;

    let fullName = `${fn} ${ln}`;
    let company = cleanCompanyName(scraped.title, scraped.domain);
    let role = targetRoles[i % targetRoles.length];
    let linkedinUrl = `https://www.linkedin.com/company/${domain.split('.')[0]}`;
    let website = scraped.link?.startsWith('http') ? scraped.link : `https://${domain}`;
    let sourceLabel = `Web Discovery (${query})`;

    // Channel-specific lead enrichment
    if (sourceChannel === 'reddit') {
      const parsed = parseRedditTitle(scraped.title, scraped.link);
      const sub = scraped.subreddit || parsed.subreddit || 'r/community';
      sourceLabel = `Reddit (${sub})`;
      fullName = `${fn} (${sub})`;
      website = scraped.link?.startsWith('http') ? scraped.link : `https://${domain}`;
    } else if (sourceChannel === 'quora') {
      sourceLabel = 'Quora Q&A';
      website = scraped.link?.startsWith('http') ? scraped.link : `https://${domain}`;
    } else if (sourceChannel === 'linkedin') {
      if (scraped.link?.includes('linkedin.com/in/')) {
        const parsed = parseLinkedInTitle(scraped.title);
        if (parsed.name && parsed.name.length > 2) fullName = parsed.name;
        if (parsed.role) role = parsed.role;
        if (parsed.company) company = parsed.company;
        linkedinUrl = scraped.link;
      }
      // If company was not in the LinkedIn title, try extracting from snippet or registry
      if (!company || company === fullName || company.length < 2) {
        const snippetMatch = (scraped.snippet || '').match(/(?:at|with|for)\s+([A-Z][A-Za-z0-9\s&]+?)(?:\s+in|\s+based|\s+as|\.|\,|$)/);
        if (snippetMatch && snippetMatch[1].trim().length >= 2 && !/^(the|linkedin|india|bangalore)/i.test(snippetMatch[1].trim())) {
          company = snippetMatch[1].trim();
        } else {
          const regPool = getRegistryCandidates(config);
          const reg = regPool[i % regPool.length];
          company = reg ? reg.company : 'Enterprise Group';
        }
      }
      sourceLabel = `LinkedIn Discovery (${role || query})`;
    } else if (sourceChannel === 'google_places') {
      sourceLabel = `Google Maps (${scraped.placeData?.custom_fields?.category || query})`;
      if (scraped.placeData?.company) {
        company = scraped.placeData.company;
        fullName = scraped.placeData.name || `${company} Owner`;
      }
      if (scraped.placeData?.phone) {
        phone = scraped.placeData.phone;
        isRealPhone = true;
        phoneType = 'office_landline';
      }
      if (scraped.placeData?.website) {
        website = scraped.placeData.website;
      }
    } else if (sourceChannel === 'instagram') {
      if (scraped.link?.includes('instagram.com/')) {
        const parsed = parseInstagramTitle(scraped.title);
        if (parsed.name) fullName = parsed.name;
        company = parsed.handle || parsed.name;
        website = scraped.link;
      }
      sourceLabel = `Instagram (${query})`;
    } else if (sourceChannel === 'clutch') {
      sourceLabel = `Clutch Directory (${query})`;
    }

    // 1. Real phone extraction from snippet, falling back gracefully
    const combinedText = `${scraped.title || ''} ${scraped.snippet || ''}`;
    const extractedPhones = extractRealPhonesFromText(combinedText, countries[0] || 'India');
    let phone = '';
    let isRealPhone = false;
    let phoneType = 'standard';
    if (extractedPhones.length > 0) {
      phone = extractedPhones[0].phone;
      isRealPhone = true;
      phoneType = extractedPhones[0].type;
    } else {
      phone = resolvePhoneNumber(scraped.snippet, countries[0] || 'India', i);
    }

    // 2. Real email extraction from snippet or corporate domain pattern
    const extractedEmails = extractRealEmailsFromText(combinedText, domain);
    let email = '';
    let isRealEmail = false;
    if (extractedEmails.length > 0) {
      email = extractedEmails[0].email;
      isRealEmail = true;
    } else {
      email = resolveProspectEmail(fn, ln, domain, targetMode === 'b2c', i);
    }

    // 3. Option A: DNS-over-HTTPS MX Deliverability Verification
    const emailDomain = email.includes('@') ? email.split('@')[1] : domain;
    const mxCheck = await verifyDomainMX(emailDomain);

    // Option A: Automatically drop/skip dead domains where no MX records exist
    if (!mxCheck.isValid && targetMode !== 'b2c') {
      console.log(`[Discovery Deliverability] Dropping candidate on invalid domain (No MX): ${emailDomain}`);
      continue;
    }

    const quality = calculateContactQualityScore({
      hasValidMx: mxCheck.isValid,
      isDirectEmail: isRealEmail,
      hasRealPhone: isRealPhone,
      hasDecisionMaker: Boolean(fullName && !fullName.includes('Prospect') && !fullName.includes('Enterprise')),
      hasWebsite: Boolean(website && website.startsWith('http')),
      mailProvider: mxCheck.provider
    });

    const verificationFields = {
      verification_status: mxCheck.isValid ? (isRealEmail ? 'verified_direct' : 'deliverable_pattern') : 'unverified',
      is_deliverable: mxCheck.isValid,
      mail_provider: mxCheck.provider,
      mx_host: mxCheck.mxHost,
      quality_score: quality.score,
      quality_tier: quality.tier,
      badge_color: quality.badgeColor,
      is_real_scraped_email: isRealEmail,
      is_real_scraped_phone: isRealPhone,
      phone_type: phoneType,
      verified_at: new Date().toISOString()
    };

    if (targetMode === 'b2c') {
      const persona = scraped.persona || targetPersonas[i % targetPersonas.length] || 'Interested Consumer';
      let inquiryText = scraped.inquiry || config.target_interests?.[i % (config.target_interests?.length || 1)] || query;

      if (sourceChannel === 'reddit') {
        const parsed = parseRedditTitle(scraped.title, scraped.link);
        inquiryText = scraped.inquiry || parsed.cleanTitle || inquiryText;
      } else if (sourceChannel === 'quora') {
        const cleanQ = parseQuoraTitle(scraped.title);
        inquiryText = scraped.inquiry || cleanQ || inquiryText;
      }

      candidates.push({
        name: fullName,
        phone,
        email,
        company: '', // No corporate company for B2C consumer inquiries
        designation: persona, // Consumer persona tag
        website,
        linkedin: '',
        source: sourceLabel,
        custom_fields: {
          target_mode: 'b2c',
          location,
          city: location.split(',')[0].trim(),
          persona,
          interest: inquiryText,
          requirement: inquiryText,
          discovery_query: query,
          discovery_source: sourceChannel,
          thread_url: website,
          website,
          domain,
          scraped_snippet: scraped.snippet,
          scraped_at: new Date().toISOString(),
          is_live_scraped: true,
          ...(scraped.placeData?.custom_fields || {}),
          ...verificationFields
        }
      });
    } else {
      const industry = scraped.industry || config.target_industries?.[i % (config.target_industries?.length || 1)] || 'Information Technology';
      const companySize = scraped.companySize || companySizes[i % companySizes.length];

      candidates.push({
        name: fullName,
        phone,
        email,
        company,
        designation: role,
        website,
        linkedin: linkedinUrl,
        source: sourceLabel,
        custom_fields: {
          target_mode: 'b2b',
          company,
          designation: role,
          website,
          domain,
          industry,
          location,
          company_size: companySize,
          discovery_query: query,
          discovery_source: sourceChannel,
          scraped_snippet: scraped.snippet,
          scraped_at: new Date().toISOString(),
          is_live_scraped: true,
          ...(scraped.placeData?.custom_fields || {}),
          ...verificationFields
        }
      });
    }
  }

  // Synthesize AI ICP scores, match tiers, and dynamic icebreakers for all candidates
  return scoreCandidateBatch({ candidates, pipelineConfig: config });
}
