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
  const hasGranularPipeline = raw.pipeline && typeof raw.pipeline === 'object';
  const hasGranularDashboard = raw.dashboard && typeof raw.dashboard === 'object';
  const hasGranularAdmin = raw.admin && typeof raw.admin === 'object';

  if (hasGranularLeads || hasGranularPipeline || hasGranularDashboard || hasGranularAdmin) {
    return {
      leads: {
        scope: raw.leads?.scope === 'all' ? 'all' : 'assigned',
        view: raw.leads?.view !== false,
        edit: raw.leads?.edit !== false,
        delete: raw.leads?.delete === true
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
 * @param {string} section - 'leads' | 'pipeline' | 'dashboard' | 'admin'
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

  if (section === 'pipeline') {
    return perms.pipeline?.[action] === true;
  }

  if (section === 'dashboard') {
    if (action === 'all_data') return perms.dashboard?.scope === 'all';
    return perms.dashboard?.[action] !== false;
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
 * Get dashboard visibility scope: 'assigned' or 'all'
 */
export function getDashboardScope(user) {
  if (!user) return 'assigned';
  if (user.role === 'admin') return 'all';
  const perms = normalizePermissions(user);
  return perms.dashboard?.scope || 'assigned';
}
