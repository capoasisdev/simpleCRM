/**
 * permissions.js - Granular Role-Based Access Control (RBAC) helpers
 */

export const DEFAULT_MEMBER_PERMISSIONS = {
  leads: {
    scope: 'assigned', // 'assigned' | 'all'
    view: true,
    edit: true,
    delete: false
  },
  messages: {
    scope: 'assigned', // 'assigned' | 'all'
    view: true
  },
  pipeline: {
    view: false,
    edit: false,
    delete: false
  },
  dashboard: {
    scope: 'assigned', // 'assigned' | 'all'
    view: true,
    view_deals: true,
    view_activity: true
  },
  analytics: {
    scope: 'assigned', // 'assigned' | 'all'
    view: true
  },
  followups: {
    scope: 'self', // 'self' | 'all'
    view: true,
    delete: true
  },
  admin: {
    manage_users: false,
    manage_routing: false,
    manage_meta: false
  }
};

export const DEFAULT_ADMIN_PERMISSIONS = {
  leads: {
    scope: 'all',
    view: true,
    edit: true,
    delete: true
  },
  messages: {
    scope: 'all',
    view: true
  },
  pipeline: {
    view: true,
    edit: true,
    delete: true
  },
  dashboard: {
    scope: 'all',
    view: true,
    view_deals: true,
    view_activity: true
  },
  analytics: {
    scope: 'all',
    view: true
  },
  followups: {
    scope: 'all',
    view: true,
    delete: true
  },
  admin: {
    manage_users: true,
    manage_routing: true,
    manage_meta: true
  }
};

/**
 * Normalizes permissions from legacy or partial shapes into the granular schema
 */
export function normalizePermissions(user) {
  if (!user) return DEFAULT_MEMBER_PERMISSIONS;

  // Admins always have full permissions
  if (user.role === 'admin') {
    return DEFAULT_ADMIN_PERMISSIONS;
  }

  const raw = user.permissions || {};

  // Check if raw already has the granular nested structure
  const hasGranularLeads = raw.leads && typeof raw.leads === 'object';
  const hasGranularMessages = raw.messages && typeof raw.messages === 'object';
  const hasGranularPipeline = raw.pipeline && typeof raw.pipeline === 'object';
  const hasGranularDashboard = raw.dashboard && typeof raw.dashboard === 'object';
  const hasGranularFollowups = raw.followups && typeof raw.followups === 'object';
  const hasGranularAdmin = raw.admin && typeof raw.admin === 'object';

  if (hasGranularLeads || hasGranularMessages || hasGranularPipeline || hasGranularDashboard || hasGranularFollowups || hasGranularAdmin) {
    return {
      leads: {
        scope: raw.leads?.scope === 'all' ? 'all' : 'assigned',
        view: raw.leads?.view !== false,
        edit: raw.leads?.edit !== false,
        delete: raw.leads?.delete === true
      },
      messages: {
        scope: raw.messages?.scope === 'all' ? 'all' : (raw.leads?.scope === 'all' ? 'all' : 'assigned'),
        view: raw.messages?.view !== false
      },
      pipeline: {
        view: raw.pipeline?.view === true,
        edit: raw.pipeline?.edit === true,
        delete: raw.pipeline?.delete === true
      },
      dashboard: {
        scope: raw.dashboard?.scope === 'all' ? 'all' : (raw.leads?.scope === 'all' ? 'all' : 'assigned'),
        view: raw.dashboard?.view !== false,
        view_deals: raw.dashboard?.view_deals !== false,
        view_activity: raw.dashboard?.view_activity !== false
      },
      analytics: {
        scope: raw.analytics?.scope === 'all' ? 'all' : (raw.dashboard?.scope === 'all' ? 'all' : (raw.leads?.scope === 'all' ? 'all' : 'assigned')),
        view: raw.analytics?.view !== false
      },
      followups: {
        scope: raw.followups?.scope === 'all' ? 'all' : 'self',
        view: raw.followups?.view !== false,
        delete: raw.followups?.delete !== undefined
          ? raw.followups.delete === true
          : (raw.followups?.delete_all !== undefined ? raw.followups.delete_all === true : true)
      },
      admin: {
        manage_users: raw.admin?.manage_users === true || raw.manage_users === true,
        manage_routing: raw.admin?.manage_routing === true,
        manage_meta: raw.admin?.manage_meta === true
      }
    };
  }

  // Fallback migration for legacy flat permissions:
  return {
    leads: {
      scope: 'assigned',
      view: raw.manage_leads !== false,
      edit: raw.manage_leads !== false,
      delete: false
    },
    messages: {
      scope: 'assigned',
      view: raw.manage_leads !== false
    },
    pipeline: {
      view: false,
      edit: false,
      delete: false
    },
    dashboard: {
      scope: 'assigned',
      view: raw.view_dashboard !== false,
      view_deals: true,
      view_activity: true
    },
    analytics: {
      scope: 'assigned',
      view: raw.view_dashboard !== false
    },
    followups: {
      scope: 'self',
      view: true,
      delete: true
    },
    admin: {
      manage_users: raw.manage_users === true,
      manage_routing: raw.manage_users === true,
      manage_meta: raw.manage_users === true
    }
  };
}

/**
 * Check if user has permission for a specific section and action
 * @param {object} user
 * @param {string} section - 'leads' | 'pipeline' | 'dashboard' | 'followups' | 'admin'
 * @param {string} action - 'view' | 'edit' | 'delete' | 'manage_users' | etc.
 */
export function hasPermission(user, section, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const perms = normalizePermissions(user);

  if (section === 'leads') {
    if (action === 'all_leads') return perms.leads?.scope === 'all';
    return perms.leads?.[action] === true;
  }

  if (section === 'messages') {
    if (action === 'all_messages' || action === 'all') return perms.messages?.scope === 'all';
    return perms.messages?.[action] !== false;
  }

  if (section === 'pipeline') {
    return perms.pipeline?.[action] === true;
  }

  if (section === 'dashboard') {
    if (action === 'all_data') return perms.dashboard?.scope === 'all';
    return perms.dashboard?.[action] !== false;
  }

  if (section === 'analytics') {
    if (action === 'all_data' || action === 'all') return perms.analytics?.scope === 'all';
    return perms.analytics?.[action] !== false;
  }

  if (section === 'followups') {
    if (action === 'all') return perms.followups?.scope === 'all';
    if (action === 'delete' || action === 'delete_all') return perms.followups?.delete === true;
    return perms.followups?.[action] !== false;
  }

  if (section === 'admin') {
    return perms.admin?.[action] === true;
  }

  return false;
}

/**
 * Get lead visibility scope: 'assigned' or 'all'
 */
export function getLeadScope(user) {
  if (!user) return 'assigned';
  if (user.role === 'admin') return 'all';
  const perms = normalizePermissions(user);
  return perms.leads?.scope || 'assigned';
}

/**
 * Get messages visibility scope: 'assigned' or 'all'
 */
export function getMessagesScope(user) {
  if (!user) return 'assigned';
  if (user.role === 'admin') return 'all';
  const perms = normalizePermissions(user);
  return perms.messages?.scope || 'assigned';
}

/**
 * Get dashboard visibility scope: 'assigned' or 'all'
 */
export function getDashboardScope(user) {
  if (!user) return 'assigned';
  if (user.role === 'admin') return 'all';
  const perms = normalizePermissions(user);
  return perms.dashboard?.scope || 'assigned';
}

/**
 * Get analytics visibility scope: 'assigned' or 'all'
 */
export function getAnalyticsScope(user) {
  if (!user) return 'assigned';
  if (user.role === 'admin') return 'all';
  const perms = normalizePermissions(user);
  return perms.analytics?.scope || 'assigned';
}

/**
 * Get follow-up visibility scope: 'self' or 'all'
 */
export function getFollowUpScope(user) {
  if (!user) return 'self';
  if (user.role === 'admin') return 'all';
  const perms = normalizePermissions(user);
  return perms.followups?.scope || 'self';
}

/**
 * Strict check whether a lead is assigned to a specific user
 */
export function isLeadAssignedToUser(lead, user) {
  if (!lead || !user) return false;
  const assigned = (lead.assigned_to || lead.assignedTo || '').toLowerCase().trim();
  if (!assigned || assigned === 'unassigned' || assigned === 'none') return false;

  const userName = (user.name || '').toLowerCase().trim();
  const userFirst = userName.split(' ')[0] || '';
  const userEmail = (user.email || '').toLowerCase().trim();
  const userId = (user.id || '').toLowerCase().trim();

  return (
    assigned === userName ||
    assigned === userFirst ||
    (userEmail && assigned === userEmail) ||
    (userId && assigned === userId) ||
    (userName.includes('pranav') && assigned === 'pranav') ||
    (userName.includes('dipak') && (assigned.includes('dipak') || assigned === 'bd01@salado.in'))
  );
}

/**
 * Check if user can delete/manage a specific follow-up
 * @param {object} user - current user
 * @param {object} followUp - follow-up item
 * @param {object} [lead] - optional associated lead
 */
export function canDeleteFollowUp(user, followUp, lead) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const perms = normalizePermissions(user);
  if (perms.followups?.delete !== true) return false;

  const scope = perms.followups?.scope || 'self';
  if (scope === 'all') return true;

  // Check if followUp belongs to current user
  const isCreatedBySelf =
    followUp?.created_by &&
    user?.name &&
    followUp.created_by.trim().toLowerCase() === user.name.trim().toLowerCase();

  const isAssigned = lead ? isLeadAssignedToUser(lead, user) : false;
  return isCreatedBySelf || isAssigned;
}

/**
 * Checks whether a user has access/assignment to a pipeline.
 * Admins and users with lead scope 'all' have access to all pipelines.
 * Members with lead scope 'assigned' only have access if:
 * 1. The pipeline's lead_distribution assigns leads to them (in user_rules with enabled !== false, or mode === 'single' and default_assignee matches user).
 * 2. OR the user currently has at least one lead assigned to them in that pipeline.
 */
export function isUserAssignedToPipeline(pipe, user, leads = [], pipelineForms = []) {
  if (!pipe || !user) return false;
  if (user.role === 'admin') return true;

  // Check if user has permission to view all leads
  const perms = normalizePermissions(user);
  if (perms.leads?.scope === 'all') return true;

  const userName = (user.name || '').toLowerCase().trim();
  const userFirst = userName.split(' ')[0] || '';
  const userEmail = (user.email || '').toLowerCase().trim();
  const userId = (user.id || '').toLowerCase().trim();

  const isUserMatch = (identifier) => {
    if (!identifier) return false;
    const str = String(identifier).toLowerCase().trim();
    return (
      str === userName ||
      str === userFirst ||
      (userEmail && str === userEmail) ||
      (userId && str === userId) ||
      (userName.includes('pranav') && str === 'pranav') ||
      (userName.includes('dipak') && (str.includes('dipak') || str === 'bd01@salado.in'))
    );
  };

  // 1. Check pipeline lead distribution
  const pipeDist = pipe.lead_distribution;
  if (pipeDist && typeof pipeDist === 'object') {
    const mode = pipeDist.mode || 'round_robin';
    if (mode === 'single') {
      if (isUserMatch(pipeDist.default_assignee)) return true;
    } else {
      // round_robin or weighted
      if (Array.isArray(pipeDist.user_rules)) {
        const rule = pipeDist.user_rules.find((r) =>
          (r.id && isUserMatch(r.id)) ||
          (r.email && isUserMatch(r.email)) ||
          (r.name && isUserMatch(r.name))
        );
        if (rule && rule.enabled !== false && rule.active !== false) {
          return true;
        }
      }
    }
  }

  // 2. Check if user has any assigned leads in this pipeline
  if (Array.isArray(leads) && leads.length > 0) {
    const hasAssignedLead = leads.some((lead) => {
      if (!isLeadAssignedToUser(lead, user)) return false;

      let leadPipeId = lead.pipeline_id;
      if (!leadPipeId && lead.form_id && Array.isArray(pipelineForms) && pipelineForms.length > 0) {
        const matchedForm = pipelineForms.find((f) => String(f.form_id) === String(lead.form_id));
        if (matchedForm?.pipeline_id) {
          leadPipeId = matchedForm.pipeline_id;
        }
      }

      if (leadPipeId) {
        return leadPipeId === pipe.id;
      }
      return pipe.is_default;
    });

    if (hasAssignedLead) return true;
  }

  return false;
}


