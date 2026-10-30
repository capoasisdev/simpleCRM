/**
 * aiAssistant.js - CRM AI Assistant Intelligence & Execution Engine
 *
 * Capabilities:
 * 1. Powered by OpenRouter free models (nvidia/nemotron-3.5-super-vl:free & minimax/minimax-m3.1-flash:free)
 * 2. Strict Role-Based Access Control (RBAC): scopes live CRM data, leads, deals, metrics, and actions to user permissions.
 * 3. Conversational Context & Multi-turn memory: resolves pronouns (he/she/they/him/her) across chat turns.
 * 4. Deep Temporal & Rep Analytics: exact per-rep stage breakdowns, activities in past 2 days / 7 days, leads contacted or moved.
 * 5. Executive CRM actions (stage transitions with permission verification, task creation in Sticky Notes).
 */

import { supabase } from './supabase';
import { createStickyNote } from './todos';
import { recordActivity, getStoredActivities } from './activities';
import {
  normalizePermissions,
  hasPermission,
  getLeadScope,
  isLeadAssignedToUser,
  getDashboardScope,
  getAnalyticsScope
} from './permissions';

const OPENROUTER_STORAGE_KEY = 'crm_openrouter_api_key';
const GEMINI_STORAGE_KEY = 'crm_gemini_api_key';

export const OPENROUTER_MODELS = [
  'minimax/minimax-m3.1-flash:free',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3.5-lightning:free'
];

/**
 * Retrieve OpenRouter API Key from localStorage or environment
 */
export function getOpenRouterApiKey() {
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

export function setOpenRouterApiKey(key) {
  try {
    if (key) {
      localStorage.setItem(OPENROUTER_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(OPENROUTER_STORAGE_KEY);
    }
  } catch {}
}

// Backwards-compatible aliases
export function getGeminiApiKey() {
  return getOpenRouterApiKey();
}

export function setGeminiApiKey(key) {
  setOpenRouterApiKey(key);
}

/**
 * Parse lead timestamp reliably from created_at or date
 */
export function getLeadTimestamp(lead) {
  if (!lead) return null;
  if (lead.created_at) {
    const t = new Date(lead.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  if (lead.date) {
    const m = String(lead.date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      const t = new Date(`${m[3]}-${month}-${day}T00:00:00Z`).getTime();
      if (!isNaN(t)) return t;
    }
    const t = new Date(lead.date).getTime();
    if (!isNaN(t)) return t;
  }
  return null;
}

/**
 * Resolve stage IDs (e.g. "stage 1792581059922" or "stage_123") to friendly human-readable stage names
 */
export function resolveStageName(stageIdOrName, pipelinesList = []) {
  if (!stageIdOrName) return 'New';
  const raw = String(stageIdOrName).trim();
  if (!raw) return 'New';

  // 1. Look up in pipelinesList stages
  if (Array.isArray(pipelinesList)) {
    for (const pipe of pipelinesList) {
      if (Array.isArray(pipe?.stages)) {
        const found = pipe.stages.find((s) => {
          if (!s) return false;
          const sId = String(s.id || '').trim();
          const sLabel = String(s.label || s.name || '').trim();
          return (
            sId === raw ||
            sId === `stage_${raw}` ||
            sId === raw.replace(/^stage_/, '') ||
            sId.toLowerCase() === raw.toLowerCase() ||
            (sLabel && sLabel.toLowerCase() === raw.toLowerCase())
          );
        });
        if (found) {
          return found.label || found.name || raw;
        }
      }
    }
  }

  // 2. Canonical standard names
  const lower = raw.toLowerCase().replace(/[-_]/g, ' ');
  if (lower === 'new' || lower === 'new leads' || lower === 'new lead') return 'New';
  if (lower === 'contacted' || lower === 'contact') return 'Contacted';
  if (
    lower.includes('call not rec') ||
    lower.includes('not connected') ||
    lower.includes('missed') ||
    lower.includes('rnr') ||
    lower.includes('no response')
  ) {
    return 'Call Not Rec.';
  }
  if (lower.includes('follow up') || lower.includes('followup') || lower.includes('in progress')) return 'Follow Up';
  if (lower.includes('interested') || lower.includes('hot lead')) return 'Interested';
  if (lower.includes('meeting') || lower.includes('demo') || lower.includes('pitch')) return 'Meeting Scheduled';
  if (lower.includes('converted') || lower.includes('won') || lower.includes('closed won') || lower.includes('deal closed')) return 'Converted';
  if (lower.includes('lost') || lower.includes('junk') || lower.includes('dropped') || lower.includes('not interested') || lower.includes('closed lost')) return 'Lost';

  // 3. If raw looks like a generated ID e.g. "stage 1792581059922" or "stage_1792..."
  if (/^stage[\s_-]*\d+/i.test(raw) || /^\d{10,}/.test(raw)) {
    return 'Custom Stage';
  }

  // 4. Default: title case with underscores replaced
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fetch and merge recent activities from Supabase and local storage
 */
export async function fetchFullActivities(passedActivities = []) {
  const local = getStoredActivities();
  let dbActivities = [];

  try {
    const { data, error } = await supabase
      .from('lead_activities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && Array.isArray(data)) {
      dbActivities = data;
    }
  } catch (err) {
    console.warn('Could not fetch lead_activities for AI context:', err);
  }

  const map = new Map();
  [...passedActivities, ...local, ...dbActivities].forEach((item) => {
    if (item && item.id) {
      map.set(item.id, item);
    } else if (item) {
      map.set(`${item.type}-${item.lead_id || item.lead_name}-${item.created_at}`, item);
    }
  });

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

/**
 * Search and fuzzy-match leads by name, spelling variations, phone, or email
 */
export function findRelevantLeads(query, leadsList = []) {
  if (!query || !Array.isArray(leadsList) || leadsList.length === 0) return [];

  const q = query.toLowerCase().trim();

  // If the query is an aggregate or analytical question without a specific person inquiry, do not match individual leads
  const isBroadAnalytical = /\b(how many|distribution|breakdown|statistics|stats|pipeline summary|overview|summary|today|yesterday|this week|stale leads|deal value|total leads|revenue)\b/i.test(q);
  if (isBroadAnalytical && !/\b(who is|details for|about|contact|call|phone|email)\b/i.test(q)) {
    return [];
  }

  const stopWords = new Set([
    'give', 'details', 'tell', 'about', 'lead', 'leads', 'show', 'info', 'what', 'who',
    'the', 'for', 'of', 'me', 'please', 'is', 'are', 'was', 'were', 'there', 'any', 'find',
    'search', 'status', 'view', 'check', 'can', 'you', 'how', 'many', 'much', 'came',
    'come', 'arrived', 'today', 'yesterday', 'tomorrow', 'week', 'month', 'year', 'distribution',
    'breakdown', 'split', 'ratio', 'count', 'total', 'stats', 'statistics', 'number', 'numbers',
    'percentage', 'incoming', 'received', 'added', 'created', 'got', 'and', 'with', 'from',
    'stage', 'stages', 'pipeline', 'pipelines', 'all'
  ]);

  const words = q
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  if (words.length === 0) return [];

  const matched = leadsList.filter((l) => {
    const name = (l.name || '').toLowerCase();
    const phone = (l.phone || '').toLowerCase().replace(/[^0-9]/g, '');
    const email = (l.email || '').toLowerCase();
    const city = (l.city || '').toLowerCase();

    for (const w of words) {
      if (w.length >= 3 && name.includes(w)) return true;
      if (w.length >= 3 && (email.includes(w) || city.includes(w))) return true;
      if (w.length >= 4 && phone.includes(w)) return true;

      // Phonetic/spelling normalization (e.g. kaushik <-> koushik, sachin <-> sachiinn)
      const normW = w
        .replace(/au/g, 'ou')
        .replace(/ii/g, 'i')
        .replace(/sh/g, 's')
        .replace(/ph/g, 'f');

      const normName = name
        .replace(/au/g, 'ou')
        .replace(/ii/g, 'i')
        .replace(/sh/g, 's')
        .replace(/ph/g, 'f');

      if (normW.length >= 3 && (normName.includes(normW) || normW.includes(normName))) {
        return true;
      }
    }
    return false;
  });

  // Sort matched: prioritize leads whose name contains one of the search words exactly
  return matched.sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    const aExact = words.some((w) => aName.includes(w));
    const bExact = words.some((w) => bName.includes(w));
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return 0;
  });
}

/**
 * Filter leads according to currentUser permissions & visibility scope
 */
export function getScopedLeads(leads = [], currentUser = {}) {
  if (!currentUser || currentUser.role === 'admin') {
    return leads;
  }

  const canView = hasPermission(currentUser, 'leads', 'view');
  if (!canView) return [];

  const scope = getLeadScope(currentUser);
  if (scope === 'all') return leads;

  return leads.filter((l) => isLeadAssignedToUser(l, currentUser));
}

/**
 * Filter deals according to currentUser permissions & visibility scope
 */
export function getScopedDeals(deals = [], scopedLeads = [], currentUser = {}) {
  if (!currentUser || currentUser.role === 'admin') {
    return deals;
  }

  const canViewDeals = hasPermission(currentUser, 'dashboard', 'view_deals');
  if (!canViewDeals) return [];

  const dashScope = getDashboardScope(currentUser);
  if (dashScope === 'all') return deals;

  const leadIdSet = new Set(scopedLeads.map((l) => l.id));
  const userName = (currentUser.name || '').toLowerCase().trim();

  return deals.filter((d) => {
    if (d.lead_id && leadIdSet.has(d.lead_id)) return true;
    if (d.rep && d.rep.toLowerCase().trim() === userName) return true;
    return false;
  });
}

/**
 * Build rich, structured snapshot of live CRM data strictly scoped to currentUser
 */
export function buildCrmContext({ leads = [], deals = [], pipelinesList = [], usersList = [], currentUser = {}, activities = [] }) {
  const scopedLeads = getScopedLeads(leads, currentUser);
  const scopedDeals = getScopedDeals(deals, scopedLeads, currentUser);

  const totalLeads = scopedLeads.length;
  const totalDeals = scopedDeals.length;

  const totalPipelineValue =
    scopedDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0) +
    scopedLeads.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

  // Group leads by stage (resolving internal stage IDs to human labels)
  const stageCounts = {};
  scopedLeads.forEach((l) => {
    const st = resolveStageName(l.stage, pipelinesList);
    stageCounts[st] = (stageCounts[st] || 0) + 1;
  });

  // Group leads by pipeline
  const pipelineMap = new Map();
  pipelinesList.forEach((p) => {
    pipelineMap.set(p.id, p.name);
  });
  const pipelineCounts = {};
  scopedLeads.forEach((l) => {
    const pName = pipelineMap.get(l.pipeline_id) || 'Default Pipeline';
    pipelineCounts[pName] = (pipelineCounts[pName] || 0) + 1;
  });

  // Stale leads: created > 5 days ago and still in new/contacted
  const now = Date.now();
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  const twoDaysMs = 48 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // Time boundaries for Today & Yesterday in local time
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const yesterdayStart = new Date(todayStartMs - 24 * 60 * 60 * 1000);
  const yesterdayStartMs = yesterdayStart.getTime();

  const leadsToday = [];
  const todayStageCounts = {};
  const leadsYesterday = [];
  const yesterdayStageCounts = {};
  const leadsPast7Days = [];

  const staleLeads = scopedLeads.filter((l) => {
    const age = now - (getLeadTimestamp(l) || now);
    const st = String(l.stage || '').toLowerCase();
    return age > fiveDaysMs && (st === 'new' || st === 'new leads' || st === 'contacted');
  });

  // Comprehensive Rep Breakdown (exact counts per stage & timeframe)
  const repBreakdown = {};
  scopedLeads.forEach((l) => {
    const rep = (l.assigned_to || l.assignedTo || 'Unassigned').trim();
    if (!repBreakdown[rep]) {
      repBreakdown[rep] = {
        total: 0,
        stages: {},
        newPast2Days: 0,
        newPast2DaysNames: [],
        newPast7Days: 0
      };
    }
    repBreakdown[rep].total += 1;
    const st = resolveStageName(l.stage, pipelinesList);
    repBreakdown[rep].stages[st] = (repBreakdown[rep].stages[st] || 0) + 1;

    const leadTime = getLeadTimestamp(l);
    if (leadTime) {
      if (leadTime >= todayStartMs) {
        leadsToday.push(l);
        todayStageCounts[st] = (todayStageCounts[st] || 0) + 1;
      } else if (leadTime >= yesterdayStartMs && leadTime < todayStartMs) {
        leadsYesterday.push(l);
        yesterdayStageCounts[st] = (yesterdayStageCounts[st] || 0) + 1;
      }

      const age = now - leadTime;
      if (age <= twoDaysMs) {
        repBreakdown[rep].newPast2Days += 1;
        if (repBreakdown[rep].newPast2DaysNames.length < 5) {
          repBreakdown[rep].newPast2DaysNames.push(l.name);
        }
      }
      if (age <= sevenDaysMs) {
        repBreakdown[rep].newPast7Days += 1;
        leadsPast7Days.push(l);
      }
    }
  });

  // Rep workload simple map
  const repWorkload = {};
  Object.entries(repBreakdown).forEach(([rep, data]) => {
    repWorkload[rep] = data.total;
  });

  // Top 5 highest value leads
  const topLeads = [...scopedLeads]
    .filter((l) => Number(l.value) > 0)
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
    .slice(0, 5);

  const isScopeAll = !currentUser || currentUser.role === 'admin' || getLeadScope(currentUser) === 'all';

  // Analyze Activities in the past 2 days & 7 days
  const activitiesPast2Days = [];
  const repActivities2Days = {};
  const repWorkedOnLeads2Days = {};

  activities.forEach((act) => {
    const actTime = new Date(act.created_at || 0).getTime();
    if (!actTime) return;

    const rep = (act.user_name || act.assigned_to || 'System').trim();
    const age = now - actTime;

    if (age <= twoDaysMs) {
      activitiesPast2Days.push(act);
      repActivities2Days[rep] = (repActivities2Days[rep] || 0) + 1;

      if (!repWorkedOnLeads2Days[rep]) {
        repWorkedOnLeads2Days[rep] = new Map();
      }
      const leadKey = act.lead_id || act.lead_name || 'unknown';
      repWorkedOnLeads2Days[rep].set(leadKey, {
        leadName: act.lead_name || 'Lead',
        type: act.type,
        fromStage: resolveStageName(act.from_stage, pipelinesList),
        toStage: resolveStageName(act.to_stage, pipelinesList),
        details: act.details,
        time: act.created_at
      });
    }
  });

  // Human-readable summary of rep workload & stage distribution
  const repBreakdownSummary = Object.entries(repBreakdown).map(([rep, d]) => {
    const stageSummary = Object.entries(d.stages).map(([st, count]) => `${st}: ${count}`).join(', ');
    const newArrivals = d.newPast2Days > 0 ? ` | ${d.newPast2Days} new leads arrived in last 48h (${d.newPast2DaysNames.join(', ')})` : '';
    return `• **${rep}**: ${d.total} leads total (${stageSummary})${newArrivals}`;
  }).join('\n');

  // Human-readable summary of leads worked on in the past 2 days
  const repWorkedOnSummary = Object.entries(repWorkedOnLeads2Days).map(([rep, leadMap]) => {
    const items = Array.from(leadMap.values()).map((item) => {
      if (item.type === 'stage_change' && item.fromStage && item.toStage) {
        return `"${item.leadName}" (moved from ${item.fromStage} to ${item.toStage})`;
      }
      return `"${item.leadName}" (${item.type})`;
    });
    return `• **${rep}**: worked on ${leadMap.size} lead(s) in past 48h: ${items.join('; ')}`;
  }).join('\n');

  return {
    isScopeAll,
    totalLeads,
    totalDeals,
    totalPipelineValue,
    stageCounts,
    pipelineCounts,
    pipelineMap,
    leadsToday,
    leadsTodayCount: leadsToday.length,
    todayStageCounts,
    leadsYesterday,
    leadsYesterdayCount: leadsYesterday.length,
    yesterdayStageCounts,
    leadsPast7Days,
    leadsPast7DaysCount: leadsPast7Days.length,
    staleLeadsCount: staleLeads.length,
    staleLeads: staleLeads.slice(0, 8),
    repWorkload,
    repBreakdown,
    repBreakdownSummary,
    repWorkedOnSummary,
    activitiesPast2DaysCount: activitiesPast2Days.length,
    activitiesPast2Days: activitiesPast2Days.slice(0, 20),
    topLeads,
    users: isScopeAll
      ? usersList.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
      : usersList.filter((u) => u.id === currentUser?.id).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    pipelines: pipelinesList.map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages || []).map((s) => s.label || s.name || s.id)
    }))
  };
}

/**
 * Intelligent Fallback & Rule-based CRM Analytics Engine
 * Provides instant responses respecting user RBAC if OpenRouter is unreachable.
 * Includes conversational context memory to resolve pronouns (he/she/they/him/her).
 */
export function queryLocalCrmEngine(userQuery, { leads = [], deals = [], pipelinesList = [], usersList = [], currentUser = {}, activities = [], chatHistory = [] }) {
  const q = userQuery.toLowerCase().trim();
  const scopedLeads = getScopedLeads(leads, currentUser);
  const context = buildCrmContext({ leads, deals, pipelinesList, usersList, currentUser, activities });
  const scopeNotice = context.isScopeAll ? '' : ` *(Scoped to your assigned leads)*`;

  // Check if query is targeting a specific representative (e.g. Dipak, Nikita, etc.)
  const repNames = Object.keys(context.repBreakdown);
  let matchedRep = repNames.find((r) => {
    const rLower = r.toLowerCase();
    const firstWord = rLower.split(' ')[0];
    return q.includes(rLower) || (firstWord.length > 2 && q.includes(firstWord));
  });

  // Multi-turn conversational context resolution: resolve pronouns like "he", "she", "him", "his", "her"
  if (!matchedRep && chatHistory && chatHistory.length > 0) {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const prevText = (chatHistory[i].text || '').toLowerCase();
      const prevRep = repNames.find((r) => {
        const rLower = r.toLowerCase();
        const firstWord = rLower.split(' ')[0];
        return prevText.includes(rLower) || (firstWord.length > 2 && prevText.includes(firstWord));
      });
      if (prevRep) {
        matchedRep = prevRep;
        break;
      }
    }
  }

  if (matchedRep) {
    const repData = context.repBreakdown[matchedRep];
    const stagesText = Object.entries(repData.stages)
      .map(([s, c]) => `• **${s.charAt(0).toUpperCase() + s.slice(1)}**: ${c}`)
      .join('\n');

    // Did user ask about contacted / worked on / activity in past 2 days / past week?
    if (
      q.includes('contacted') ||
      q.includes('worked on') ||
      q.includes('past 2 days') ||
      q.includes('activity') ||
      q.includes('worked') ||
      q.includes('he') ||
      q.includes('his') ||
      q.includes('him')
    ) {
      const workedSummary = context.repWorkedOnSummary || '';
      const repSpecificWork = workedSummary
        .split('\n')
        .find((line) => line.toLowerCase().includes(matchedRep.toLowerCase()));

      let responseText = `### 👤 Rep Activity: ${matchedRep}\n\n`;
      if (repSpecificWork) {
        responseText += `📊 **Past 48 Hours Activity:**\n${repSpecificWork.replace(/^• \*\*/, '**')}\n\n`;
      } else {
        responseText += `📊 In the past 2 days, no stage movements or direct call logs were recorded by ${matchedRep}.\n\n`;
      }

      if (repData.newPast2Days > 0) {
        responseText += `📥 **New Leads Assigned (Past 48 Hours)**: ${repData.newPast2Days} (${repData.newPast2DaysNames.join(', ')})\n\n`;
      }

      responseText += `#### Current Pipeline for ${matchedRep} (${repData.total} Total Leads):\n${stagesText}`;

      return {
        text: responseText,
        action: null
      };
    }

    // Did user ask how many new leads or total leads this rep has?
    if (q.includes('new') || q.includes('how many') || q.includes('leads')) {
      const newCount = repData.stages['new'] || repData.stages['new leads'] || 0;
      return {
        text: `### 👤 Leads for ${matchedRep}\n\n` +
          `• **New Leads**: **${newCount}**\n` +
          `• **Total Assigned Leads**: **${repData.total}**\n\n` +
          `#### Complete Stage Breakdown:\n${stagesText}` +
          (repData.newPast2Days > 0 ? `\n\n*Note: ${repData.newPast2Days} new leads were received in the past 48 hours.*` : ''),
        action: null
      };
    }
  }

  // 1. Time-Based Inflow & Distribution Engine (Today, Yesterday, This Week, General Distribution)
  const isAskingToday = /\b(today|today's)\b/i.test(q);
  const isAskingYesterday = /\b(yesterday|yesterday's)\b/i.test(q);
  const isAskingThisWeek = /\b(this week|past week|past 7 days|last 7 days|weekly)\b/i.test(q);
  const isAskingDistribution = /\b(distribution|breakdown|split|ratio|by stage|spread|funnel)\b/i.test(q);
  const isAskingInflowCount = /\b(how many|count|total|number of|inflow|came|arrived|received|incoming|new)\b/i.test(q) && /\b(lead|leads)\b/i.test(q);

  if (
    (isAskingToday || isAskingYesterday || isAskingThisWeek || isAskingDistribution) &&
    (isAskingInflowCount || isAskingDistribution || /\b(lead|leads|came|new)\b/i.test(q))
  ) {
    let targetLeads = [];
    let periodTitle = '';
    let periodSubtitle = '';

    if (isAskingToday) {
      targetLeads = context.leadsToday || [];
      periodTitle = "Today's Lead Inflow & Distribution";
      periodSubtitle = new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    } else if (isAskingYesterday) {
      targetLeads = context.leadsYesterday || [];
      periodTitle = "Yesterday's Lead Inflow & Distribution";
      const yDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      periodSubtitle = yDate.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    } else if (isAskingThisWeek) {
      targetLeads = context.leadsPast7Days || [];
      periodTitle = "Past 7 Days Lead Inflow & Distribution";
      periodSubtitle = "Rolling 7-day window";
    } else {
      // General all-time distribution
      targetLeads = scopedLeads;
      periodTitle = "CRM Lead & Stage Distribution";
      periodSubtitle = `All ${scopedLeads.length} accessible leads`;
    }

    const totalInPeriod = targetLeads.length;

    // Stage Distribution (resolving raw stage IDs e.g. "stage 1792581059922")
    const periodStageMap = {};
    targetLeads.forEach((l) => {
      const st = resolveStageName(l.stage, pipelinesList);
      periodStageMap[st] = (periodStageMap[st] || 0) + 1;
    });

    const stageLines = Object.entries(periodStageMap)
      .sort((a, b) => b[1] - a[1])
      .map(([st, cnt]) => {
        const pct = totalInPeriod > 0 ? Math.round((cnt / totalInPeriod) * 100) : 0;
        return `• **${st}**: ${cnt} ${cnt === 1 ? 'lead' : 'leads'} (${pct}%)`;
      })
      .join('\n');

    // Rep Distribution
    const periodRepMap = {};
    targetLeads.forEach((l) => {
      const rep = (l.assigned_to || l.assignedTo || 'Unassigned').trim();
      periodRepMap[rep] = (periodRepMap[rep] || 0) + 1;
    });

    const repLines = Object.entries(periodRepMap)
      .sort((a, b) => b[1] - a[1])
      .map(([r, cnt]) => `• **${r}**: ${cnt} ${cnt === 1 ? 'lead' : 'leads'}`)
      .join('\n');

    // Pipeline Distribution (if multiple pipelines)
    const periodPipeMap = {};
    targetLeads.forEach((l) => {
      const pName = context.pipelineMap?.get(l.pipeline_id) || 'Default Pipeline';
      periodPipeMap[pName] = (periodPipeMap[pName] || 0) + 1;
    });
    const pipeLines = Object.entries(periodPipeMap)
      .sort((a, b) => b[1] - a[1])
      .map(([p, cnt]) => `• **${p}**: ${cnt} ${cnt === 1 ? 'lead' : 'leads'}`)
      .join('\n');

    if (totalInPeriod === 0) {
      const overallStageLines = Object.entries(context.stageCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([st, cnt]) => `• **${st}**: ${cnt} leads`)
        .join('\n');

      return {
        text: `### 📥 ${periodTitle} *(${periodSubtitle})*${scopeNotice}\n\n` +
          `• **Leads Received**: **0 leads**\n` +
          (isAskingToday ? `• **Yesterday's Inflow**: **${context.leadsYesterdayCount} leads**\n• **Past 7 Days**: **${context.leadsPast7DaysCount} leads**\n\n` : '\n') +
          `#### 📊 Current Overall Pipeline Stages (${context.totalLeads} Total Leads):\n${overallStageLines || 'No leads in pipeline.'}\n\n` +
          `💡 *Tip: New incoming leads via Meta Lead Forms or Webhooks will appear here in real time.*`,
        action: null
      };
    }

    // Recent 5 leads table
    const sampleRows = targetLeads.slice(0, 5).map((l) => {
      const st = resolveStageName(l.stage, pipelinesList);
      const rep = l.assigned_to || 'Unassigned';
      const city = l.city || 'N/A';
      const phone = l.phone || 'N/A';
      return `| **${l.name || 'Unnamed'}** | ${st} | ${rep} | ${city} | ${phone} |`;
    }).join('\n');

    let responseText = `### 📥 ${periodTitle} *(${periodSubtitle})*${scopeNotice}\n\n` +
      `• **Total Leads Received**: **${totalInPeriod} leads**\n` +
      `• **Total CRM Leads**: ${context.totalLeads}\n\n` +
      `#### 📊 Stage Distribution\n${stageLines || 'No stages recorded'}\n\n` +
      `#### 👤 Sales Rep Allocation\n${repLines || 'No assignments'}\n\n`;

    if (Object.keys(periodPipeMap).length > 1) {
      responseText += `#### 📁 Pipeline Breakdown\n${pipeLines}\n\n`;
    }

    responseText += `#### 🕒 Recent Inflow Sample (${Math.min(totalInPeriod, 5)} of ${totalInPeriod}):\n` +
      `| Lead Name | Stage | Rep | City | Phone |\n|---|---|---|---|---|\n${sampleRows}\n\n` +
      `💡 *Tip: You can ask for full details on any lead or ask me to draft a follow-up anytime.*`;

    return {
      text: responseText,
      action: null
    };
  }

  // 2. Pipeline Summary / Status
  if (q.includes('pipeline') || q.includes('summary') || q.includes('overview') || q.includes('status')) {
    const pipeList = Object.entries(context.pipelineCounts)
      .map(([name, count]) => `• **${name}**: ${count} leads`)
      .join('\n');

    const stageList = Object.entries(context.stageCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([stage, count]) => `• **${stage.charAt(0).toUpperCase() + stage.slice(1)}**: ${count} leads`)
      .join('\n');

    return {
      text: `### 📊 Live CRM Pipeline Overview${scopeNotice}\n\n` +
        `• **Total Leads**: ${context.totalLeads}\n` +
        `• **Pipeline Value**: ₹${Number(context.totalPipelineValue).toLocaleString('en-IN')}\n` +
        `• **Stale Leads (> 5 days)**: ${context.staleLeadsCount}\n\n` +
        `#### Pipeline Breakdown\n${pipeList || 'No pipelines defined'}\n\n` +
        `#### Stages Distribution\n${stageList || 'No stages'}\n\n` +
        `💡 *Tip: Ask me to "draft follow-up for stale leads" or "create a task" anytime.*`,
      action: null
    };
  }

  // 3. Stale Leads / Attention Needed
  if (q.includes('stale') || q.includes('inactive') || q.includes('attention') || q.includes('neglected')) {
    if (context.staleLeads.length === 0) {
      return {
        text: `✅ **Great news!** No leads in your scope are currently stalled beyond 5 days in early stages. All leads are active and moving forward.`,
        action: null
      };
    }

    const leadItems = context.staleLeads.map((l) => {
      const days = Math.floor((now - (getLeadTimestamp(l) || now)) / (24 * 60 * 60 * 1000));
      return `• **${l.name || 'Unnamed'}** (${l.phone || 'No phone'}) - ${days} days old in *${resolveStageName(l.stage, pipelinesList)}* [Rep: ${l.assigned_to || 'Unassigned'}]`;
    }).join('\n');

    return {
      text: `⚠️ Found **${context.staleLeadsCount} leads** requiring attention (uncontacted > 5 days)${scopeNotice}:\n\n${leadItems}\n\nWould you like me to create follow-up tasks for these leads?`,
      action: {
        type: 'batch_task',
        title: 'Create Follow-up Tasks for Stale Leads',
        description: `Create reminder sticky notes for ${Math.min(context.staleLeads.length, 5)} stalled leads.`,
        payload: context.staleLeads.slice(0, 5).map((l) => ({
          title: `Follow up with ${l.name || 'Lead'}`,
          description: `Lead stalled for >5 days in ${resolveStageName(l.stage, pipelinesList)}. Phone: ${l.phone || 'N/A'}`
        }))
      }
    };
  }

  // 4. Top Deals / Revenue
  if (q.includes('deal') || q.includes('revenue') || q.includes('value') || q.includes('top leads')) {
    const list = context.topLeads.map((l) =>
      `• **${l.name || 'Lead'}**: ₹${Number(l.value || 0).toLocaleString('en-IN')} (Stage: *${resolveStageName(l.stage, pipelinesList)}*, Rep: *${l.assigned_to || 'Unassigned'}*)`
    ).join('\n');

    return {
      text: `### 💰 Revenue & Top Valued Leads${scopeNotice}\n\n` +
        `• **Estimated Pipeline Value**: ₹${Number(context.totalPipelineValue).toLocaleString('en-IN')}\n` +
        `• **Total Recorded Deals**: ${context.totalDeals}\n\n` +
        `#### Top Leads by Value\n${list || 'No lead values recorded yet.'}`,
      action: null
    };
  }

  // 5. Team Workload / Reps
  if (q.includes('team') || q.includes('rep') || q.includes('workload') || q.includes('assign')) {
    if (!context.isScopeAll) {
      return {
        text: `🔒 **Permission Notice**: Detailed team-wide rep workload is only accessible to Administrators. Your account currently has access to your own **${context.totalLeads} assigned leads**.`,
        action: null
      };
    }

    return {
      text: `### 👥 Sales Team Workload & Pipeline Breakdown\n\n${context.repBreakdownSummary || 'No assignments found.'}\n\n` +
        (context.repWorkedOnSummary ? `#### 🕒 Actions in the Past 48 Hours:\n${context.repWorkedOnSummary}\n\n` : '') +
        `Total active team members: ${context.users.length}`,
      action: null
    };
  }

  // 6. Draft Follow-up Message
  if (q.includes('draft') || q.includes('message') || q.includes('whatsapp') || q.includes('sms') || q.includes('email')) {
    const foundLead = scopedLeads.find((l) => l.name && q.includes(l.name.toLowerCase())) || scopedLeads[0];
    const leadName = foundLead?.name || 'Valued Client';
    const repName = currentUser?.name || 'CapOasis Team';

    const draftText = `Hi ${leadName},\n\nI hope you're having a productive week! I'm following up on our recent discussion regarding your franchise inquiry with CapOasis.\n\nWe have prepared the detailed feasibility insights and investment overview for you. Would you be available for a brief 10-minute catchup tomorrow to walk through any questions?\n\nBest regards,\n${repName}\nCapOasis`;

    return {
      text: `### 📝 Personalized Follow-up Draft\n\nHere is a tailored follow-up message for **${leadName}**:\n\n\`\`\`\n${draftText}\n\`\`\``,
      draftContent: draftText,
      action: {
        type: 'copy_draft',
        title: `Copy Message for ${leadName}`,
        draftText,
        leadPhone: foundLead?.phone
      }
    };
  }

  // 7. Create Task / Follow-up Request
  if (q.includes('task') || q.includes('remind') || q.includes('todo')) {
    const titleMatch = userQuery.replace(/create task|add task|remind me to|create a task/gi, '').trim();
    const taskTitle = titleMatch ? titleMatch.charAt(0).toUpperCase() + titleMatch.slice(1) : 'Follow up with priority leads';

    return {
      text: `I've prepared a follow-up task:\n\n📌 **Task**: ${taskTitle}\n👤 **Assigned To**: ${currentUser?.name || 'Me'}\n📅 **Scheduled**: Today\n\nClick **Confirm Action** below to save this directly to your CRM Sticky Notes board.`,
      action: {
        type: 'create_task',
        title: taskTitle,
        description: `Created via AI Assistant for ${currentUser?.name || 'CRM User'}.`,
        assignedTo: currentUser?.name || 'Me'
      }
    };
  }

  // 8. Search for a specific lead in user's permitted scope
  const searchMatchedLeads = findRelevantLeads(userQuery, scopedLeads);
  if (searchMatchedLeads.length > 0) {
    // Check if one of them is an exact full name match
    const exactMatch = searchMatchedLeads.find((l) => {
      const name = (l.name || '').toLowerCase().trim();
      return q === name || q.includes(name);
    });

    // If multiple leads match and user didn't specify a full name, ask to disambiguate
    if (searchMatchedLeads.length > 1 && !exactMatch) {
      const listRows = searchMatchedLeads.slice(0, 5).map((l) => {
        return `| **${l.name}** | ${resolveStageName(l.stage, pipelinesList)} | ${l.assigned_to || 'Unassigned'} | ${l.city || 'N/A'} | ${l.phone || 'N/A'} |`;
      }).join('\n');

      const options = searchMatchedLeads.slice(0, 3).map((l) => `**${l.name}**`).join(' or ');

      return {
        text: `🔍 I found **${searchMatchedLeads.length} leads** matching "**${userQuery.trim()}**":\n\n` +
          `| Lead Name | Stage | Rep | City | Phone |\n|---|---|---|---|---|\n${listRows}\n\n` +
          `Which one would you like details for: ${options}?`,
        action: null
      };
    }

    const lead = exactMatch || searchMatchedLeads[0];
    const customFieldsText = lead.custom_fields && typeof lead.custom_fields === 'object'
      ? Object.entries(lead.custom_fields)
          .map(([k, v]) => `• **${k}**: ${String(v).replace(/_/g, ' ')}`)
          .join('\n')
      : '';

    return {
      text: `### 👤 Lead Information: ${lead.name}\n\n` +
        `• **Phone**: ${lead.phone || 'N/A'}\n` +
        `• **Email**: ${lead.email || 'N/A'}\n` +
        `• **City**: ${lead.city || 'N/A'}\n` +
        `• **Stage**: **${resolveStageName(lead.stage, pipelinesList).toUpperCase()}**\n` +
        `• **Assigned Representative**: **${lead.assigned_to || 'Unassigned'}**\n` +
        `• **Date Created**: ${new Date(lead.created_at || lead.date).toLocaleDateString()}\n\n` +
        (customFieldsText ? `#### 📋 Franchise Inquiry Details:\n${customFieldsText}\n\n` : '') +
        (lead.notes ? `📝 **Notes**: ${lead.notes}\n\n` : '') +
        `Would you like me to draft a follow-up WhatsApp message or update their stage?`,
      action: {
        type: 'lead_actions',
        lead
      }
    };
  }

  // Default helpful overview
  return {
    text: `I am your **CRM AI Assistant**. I have live access to your **${context.totalLeads} leads**, **${context.totalDeals} deals**, and sales pipeline metrics${scopeNotice}.\n\n` +
      `Here are things you can ask me:\n` +
      `• *"How many new leads does Dipak have?"*\n` +
      `• *"What has Dipak worked on in the past 2 days?"*\n` +
      `• *"Summarize pipeline performance"*\n` +
      `• *"Show stale leads needing attention"*\n` +
      (context.isScopeAll ? `• *"Who has the highest workload?"*\n` : '') +
      `• *"Draft a follow-up WhatsApp message for [Lead Name]"*\n` +
      `• *"Create a task to call franchise leads tomorrow"*`,
    action: null
  };
}

/**
 * Execute Authorized CRM Action directly into Supabase and local cache
 * Enforces strict user permissions before executing changes
 */
export async function executeCrmAction(action, { currentUser = {} }) {
  if (!action) return { success: false, message: 'No action provided' };

  try {
    // 1. Create Sticky Note Task
    if (action.type === 'create_task') {
      createStickyNote({
        title: action.title,
        description: action.description || '',
        color: 'yellow',
        isPinned: false,
        createdBy: currentUser?.name || 'AI Assistant'
      });
      return {
        success: true,
        message: `Task "${action.title}" created successfully on your Sticky Notes board!`
      };
    }

    // 2. Batch Follow-up Tasks
    if (action.type === 'batch_task' && Array.isArray(action.payload)) {
      for (const item of action.payload) {
        createStickyNote({
          title: item.title,
          description: item.description || '',
          color: 'blue',
          createdBy: currentUser?.name || 'AI Assistant'
        });
      }
      return {
        success: true,
        message: `Created ${action.payload.length} follow-up tasks on your Sticky Notes board!`
      };
    }

    // 3. Update Lead Stage (Strict Permission Check)
    if (action.type === 'update_lead_stage' && action.leadId && action.newStage) {
      if (!hasPermission(currentUser, 'leads', 'edit')) {
        return {
          success: false,
          message: 'Permission denied: Your account does not have permission to edit leads.'
        };
      }

      // If scope is assigned, verify the lead is assigned to this user
      const leadScope = getLeadScope(currentUser);
      if (leadScope === 'assigned' && currentUser.role !== 'admin') {
        const { data: leadRecord } = await supabase
          .from('leads')
          .select('assigned_to')
          .eq('id', action.leadId)
          .single();

        if (leadRecord && !isLeadAssignedToUser(leadRecord, currentUser)) {
          return {
            success: false,
            message: 'Permission denied: You can only edit leads assigned to you.'
          };
        }
      }

      const { error } = await supabase
        .from('leads')
        .update({ stage: action.newStage })
        .eq('id', action.leadId);

      if (error) throw error;

      await recordActivity({
        type: 'stage_change',
        leadId: action.leadId,
        leadName: action.leadName,
        toStage: action.newStage,
        userName: currentUser?.name || 'AI Assistant',
        details: `Stage updated to ${action.newStage} by AI Assistant`
      });

      return {
        success: true,
        message: `Updated ${action.leadName || 'Lead'} to stage "${action.newStage}"!`
      };
    }

    return { success: false, message: 'Unsupported action type' };
  } catch (err) {
    console.error('Error executing CRM action:', err);
    return { success: false, message: `Failed to execute action: ${err.message}` };
  }
}

/**
 * Call OpenRouter Chat Completions API with Model Fallbacks, Timeouts, and Streaming
 */
async function callOpenRouter(messages, apiKey, onChunk = null) {
  let lastError = null;

  for (const model of OPENROUTER_MODELS) {
    const controller = new AbortController();
    let receivedAnyData = false;

    // 7.5s connection / queue timeout: if model is backlogged, fail over to next model immediately
    const timeoutId = setTimeout(() => {
      if (!receivedAnyData) {
        controller.abort();
      }
    }, 7500);

    try {
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
          messages,
          temperature: 0.3,
          max_tokens: 1000,
          stream: Boolean(onChunk)
        })
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        const errText = await response.text();
        console.warn(`OpenRouter model ${model} returned ${response.status}: ${errText}`);
        lastError = new Error(`OpenRouter ${model} error: ${response.status}`);
        continue; // Try next model in fallback list
      }

      // Handle streaming SSE
      if (onChunk && response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          receivedAnyData = true;
          clearTimeout(timeoutId);

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullText += content;
                  onChunk(fullText);
                }
              } catch {}
            }
          }
        }

        clearTimeout(timeoutId);
        if (fullText.trim()) {
          return { text: fullText, model };
        }
      } else {
        // Non-streaming fallback
        receivedAnyData = true;
        clearTimeout(timeoutId);
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text) {
          if (onChunk) onChunk(text);
          return { text, model };
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err.name === 'AbortError' || controller.signal.aborted;
      console.warn(`Model ${model} ${isAbort ? 'timed out after 7.5s queue wait' : 'failed'}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All OpenRouter models failed to respond.');
}

/**
 * Main AI Assistant Entry Point
 * 1. Checks OpenRouter API Key
 * 2. Fetches complete activities & filters CRM context strictly by currentUser RBAC permissions
 * 3. Prompts OpenRouter models (primary & fallback) with rich rep breakdown and past-48h activity timeline
 * 4. Gracefully falls back to local engine with conversational memory
 */
export async function askAiAssistant(userMessage, { leads = [], deals = [], pipelinesList = [], usersList = [], currentUser = {}, chatHistory = [], activities = [], onChunk = null }) {
  const apiKey = getOpenRouterApiKey();
  const scopedLeads = getScopedLeads(leads, currentUser);
  const scopedDeals = getScopedDeals(deals, scopedLeads, currentUser);

  // Fetch complete activities from DB + localStorage
  const completeActivities = await fetchFullActivities(activities);

  // If no OpenRouter API key configured, use local analytical intelligence engine with conversational memory
  if (!apiKey) {
    await new Promise((r) => setTimeout(r, 200));
    const localRes = queryLocalCrmEngine(userMessage, {
      leads,
      deals,
      pipelinesList,
      usersList,
      currentUser,
      activities: completeActivities,
      chatHistory
    });
    if (onChunk && localRes.text) onChunk(localRes.text);
    return localRes;
  }

  try {
    const context = buildCrmContext({ leads, deals, pipelinesList, usersList, currentUser, activities: completeActivities });

    const userRole = currentUser?.role || 'member';
    const userName = currentUser?.name || 'CRM User';
    const canEditLeads = hasPermission(currentUser, 'leads', 'edit');
    const canDeleteLeads = hasPermission(currentUser, 'leads', 'delete');
    const isScopeAll = context.isScopeAll;

    // Search for specifically queried leads (e.g. "Kaushik", "Koushik Dutta", phone, email)
    let searchMatchedLeads = findRelevantLeads(userMessage, scopedLeads);
    if (searchMatchedLeads.length === 0 && chatHistory && chatHistory.length > 0) {
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        const prevText = chatHistory[i].text || '';
        const prevMatches = findRelevantLeads(prevText, scopedLeads);
        if (prevMatches.length > 0) {
          searchMatchedLeads = prevMatches;
          break;
        }
      }
    }

    const targetLeadContext = searchMatchedLeads.length > 0
      ? `\n🎯 SPECIFICALLY MATCHED LEADS FOR THIS INQUIRY:\n${JSON.stringify(searchMatchedLeads.map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          city: l.city,
          stage: resolveStageName(l.stage, pipelinesList),
          assigned_to: l.assigned_to,
          created_at: l.created_at || l.date,
          custom_fields: l.custom_fields,
          notes: l.notes,
          form_name: l.form_name
        })), null, 2)}\n`
      : '';

    // Compact token compression: ~70% fewer tokens than heavy JSON
    const compactActivities = (context.activitiesPast2Days || [])
      .slice(0, 30)
      .map((a) => `${a.created_at?.slice(0, 16) || ''} | ${a.user_name || a.assigned_to || '-'} | ${a.lead_name || '-'} | ${a.type || '-'} | ${a.from_stage || ''}->${a.to_stage || ''} | ${a.details || ''}`)
      .join('\n');

    const compactLeadsRoster = scopedLeads
      .map((l) => `${l.id} | ${l.name || 'Unknown'} | ${resolveStageName(l.stage, pipelinesList)} | ${l.assigned_to || '-'} | ${l.city || '-'} | ${l.phone || '-'} | ${l.email || '-'}`)
      .join('\n');

    const systemPrompt = `You are the executive AI Sales & Operations Assistant for SimpleCRM (CapOasis).
You are currently assisting: ${userName} (Role: ${userRole}, Data Scope: ${isScopeAll ? 'All CRM Data (Admin/Full)' : 'Assigned Leads Only'}).

STRICT ROLE-BASED ACCESS CONTROL (RBAC) RULES:
- You must STRICTLY respect the permissions and data scope of the current user (${userName}).
- The metrics and leads provided below have ALREADY been strictly filtered by the CRM permissions engine.
- If data scope is 'Assigned Leads Only', only discuss the leads and numbers provided. Do NOT fabricate or claim access to unassigned or other reps' leads.
- The user ${canEditLeads ? 'HAS' : 'DOES NOT HAVE'} permission to edit or change lead stages. ${canEditLeads ? '' : 'If they ask to move or edit leads, politely inform them their account does not have lead editing permissions.'}
- The user ${canDeleteLeads ? 'HAS' : 'DOES NOT HAVE'} permission to delete leads.
${targetLeadContext}
EXACT REPRESENTATIVE LEAD & ACTIVITY BREAKDOWN:
${context.repBreakdownSummary || 'No representatives recorded.'}

ACTIVITIES & ACTIONS IN PAST 48 HOURS (PAST 2 DAYS):
${context.repWorkedOnSummary || 'No stage movements or direct call logs recorded in the past 48 hours.'}

RECENT RAW ACTIVITIES (Time | Rep | Lead | Type | Stage Move | Details):
${compactActivities || 'No recent events recorded.'}

LIVE OVERALL CRM METRICS:
- Total Accessible Leads: ${context.totalLeads}
- Leads Received Today: ${context.leadsTodayCount} (${JSON.stringify(context.todayStageCounts)})
- Leads Received Yesterday: ${context.leadsYesterdayCount} (${JSON.stringify(context.yesterdayStageCounts)})
- Leads Received Past 7 Days: ${context.leadsPast7DaysCount}
- Accessible Pipeline Value: ₹${context.totalPipelineValue.toLocaleString('en-IN')}
- Stale Leads (>5 days in early stages): ${context.staleLeadsCount}
- Overall Stage Breakdown: ${JSON.stringify(context.stageCounts)}
- Pipelines: ${context.pipelines.map((p) => `${p.name} (stages: ${p.stages.join(' -> ')})`).join('; ')}
- COMPLETE ACCESSIBLE LEADS ROSTER (${scopedLeads.length} Total Leads) (ID | Name | Stage | Rep | City | Phone | Email):
${compactLeadsRoster}

CRITICAL RESPONSE GUIDELINES:
1. LEAD INFLOW & DISTRIBUTION QUERIES:
   - When asked how many leads arrived or came today, yesterday, or this week, or asked about stage/pipeline distribution:
     * State the EXACT count of leads received in that period using the live metrics above.
     * Break down the stage distribution clearly with counts and percentages.
     * Mention sales rep assignment and pipeline breakdown.
     * NEVER confuse an analytical question (e.g. "how many leads came today ? and what was the distribution ?") with searching for an individual lead.
2. DISAMBIGUATION RULE FOR MULTIPLE MATCHES (CRITICAL):
   - When the user's inquiry matches MULTIPLE distinct leads (e.g., asking "Kaushik" matches both "Vinay Kaushik" and "Koushik Dutta") and the user did NOT specify the full name:
     DO NOT pick or present full details for only one of them arbitrarily!
     You MUST present both matching candidates in a clean summary table:
     | Lead Name | Stage | Assigned Rep | City | Phone |
     and ask the user to clarify: "Which one would you like details for: **Vinay Kaushik** or **Koushik Dutta**?"
   - Only provide the full individual breakdown directly if:
     a) Only ONE lead matches the query, OR
     b) The user specifically asked for a full name (e.g. "Vinay Kaushik" or "Koushik Dutta").
   - When providing a full breakdown for a single lead, present their details in clean Markdown tables (Name, Phone, Email, City, Stage, Assigned Rep, Date, and franchise custom fields).
3. When asked about a specific representative (e.g. Dipak Rajhans, Nikita, etc.):
   - Use the EXACT numbers from 'EXACT REPRESENTATIVE LEAD & ACTIVITY BREAKDOWN'. For instance, if asked "how many new leads does Dipak have?", state the exact number of leads in the 'new' stage from his breakdown.
   - When asked what they worked on or contacted in the past 2 days (or follow-up questions referencing "he/she/they"), look at 'ACTIVITIES & ACTIONS IN PAST 48 HOURS' and 'RECENT RAW ACTIVITIES'. Name the specific leads they moved stages or logged activities for, along with newly arrived leads assigned to them.
4. Answer questions concisely, executive, helpful, and formatted in clean GitHub Markdown with emojis, tables, and bold key numbers.
5. When drafting messages, write them ready to send.
6. If stage changes are requested and the user has edit permissions, suggest an action block:
\`\`\`action:update_lead_stage
{"leadId": "uuid", "leadName": "Name", "newStage": "Contacted"}
\`\`\`
7. If the user asks to create a task, include an action block at the bottom:
\`\`\`action:create_task
{"title": "Task title", "description": "Details"}
\`\`\``;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Append last 4 messages from chat history for multi-turn conversation context
    chatHistory.slice(-4).forEach((m) => {
      messages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
      });
    });

    messages.push({
      role: 'user',
      content: userMessage
    });

    const replyResult = await callOpenRouter(messages, apiKey, onChunk);
    const replyText = typeof replyResult === 'object' ? replyResult.text : replyResult;
    const usedModel = typeof replyResult === 'object' ? replyResult.model : 'openrouter';

    // Check if the reply includes an action block
    let action = null;
    let cleanText = replyText;

    const taskMatch = replyText.match(/```action:create_task\s*([\s\S]*?)```/);
    if (taskMatch) {
      try {
        const parsed = JSON.parse(taskMatch[1].trim());
        action = {
          type: 'create_task',
          title: parsed.title || 'Follow up with lead',
          description: parsed.description || ''
        };
        cleanText = cleanText.replace(/```action:create_task\s*[\s\S]*?```/, '').trim();
      } catch (e) {
        console.warn('Error parsing AI task block:', e);
      }
    }

    const stageMatch = replyText.match(/```action:update_lead_stage\s*([\s\S]*?)```/);
    if (stageMatch && !action) {
      try {
        const parsed = JSON.parse(stageMatch[1].trim());
        if (canEditLeads && parsed.leadId && parsed.newStage) {
          action = {
            type: 'update_lead_stage',
            leadId: parsed.leadId,
            leadName: parsed.leadName || 'Lead',
            newStage: parsed.newStage
          };
          cleanText = cleanText.replace(/```action:update_lead_stage\s*[\s\S]*?```/, '').trim();
        }
      } catch (e) {
        console.warn('Error parsing AI stage block:', e);
      }
    }

    return {
      text: cleanText || replyText,
      action,
      model: usedModel
    };
  } catch (err) {
    console.warn('OpenRouter API error, falling back to local engine:', err);
    const localRes = queryLocalCrmEngine(userMessage, {
      leads,
      deals,
      pipelinesList,
      usersList,
      currentUser,
      activities: completeActivities,
      chatHistory
    });
    return {
      ...localRes,
      model: 'local-crm-engine'
    };
  }
}
