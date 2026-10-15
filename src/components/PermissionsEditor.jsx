import React from 'react';
import {
  UserCheck,
  GitFork,
  LayoutDashboard,
  CalendarClock,
  Shield,
  Info
} from 'lucide-react';
import { normalizePermissions } from '../lib/permissions';

export default function PermissionsEditor({ permissions, onChange, role = 'member' }) {
  const isAdmin = role === 'admin';
  const perms = normalizePermissions({ role, permissions });

  const updateSection = (section, updates) => {
    if (isAdmin) return;
    onChange({
      ...perms,
      [section]: {
        ...perms[section],
        ...updates
      }
    });
  };

  const updateAdminField = (field, value) => {
    if (isAdmin) return;
    onChange({
      ...perms,
      admin: {
        ...perms.admin,
        [field]: value
      }
    });
  };

  return (
    <div className="perm-matrix-container">
      {isAdmin && (
        <div className="admin-unrestricted-banner">
          <Info size={13} className="banner-info-icon" />
          <span>Administrators have full access to all sections and settings.</span>
        </div>
      )}

      <div className={`perm-table-card ${isAdmin ? 'disabled-view' : ''}`}>
        {/* Table Head */}
        <div className="perm-table-head">
          <div className="perm-th-module">Section</div>
          <div className="perm-th-scope">Scope</div>
          <div className="perm-th-actions">Permissions</div>
        </div>

        {/* Row 1: Leads */}
        <div className="perm-table-row">
          <div className="perm-td-module">
            <UserCheck size={14} strokeWidth={2} />
            <span className="perm-module-name">Leads</span>
          </div>
          <div className="perm-td-scope">
            <select
              value={perms.leads.scope}
              onChange={(e) => updateSection('leads', { scope: e.target.value })}
              disabled={isAdmin}
              className="perm-scope-select"
            >
              <option value="assigned">Only Assigned</option>
              <option value="all">All Leads</option>
            </select>
          </div>
          <div className="perm-td-actions">
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.leads.view}
                onChange={(e) => updateSection('leads', { view: e.target.checked })}
                disabled={isAdmin}
              />
              <span>View</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.leads.edit}
                onChange={(e) => updateSection('leads', { edit: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Edit</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.leads.delete}
                onChange={(e) => updateSection('leads', { delete: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Delete</span>
            </label>
          </div>
        </div>

        {/* Row 2: Pipeline */}
        <div className="perm-table-row">
          <div className="perm-td-module">
            <GitFork size={14} strokeWidth={2} />
            <span className="perm-module-name">Pipelines</span>
          </div>
          <div className="perm-td-scope">
            <span className="perm-scope-na">—</span>
          </div>
          <div className="perm-td-actions">
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.pipeline.view}
                onChange={(e) => updateSection('pipeline', { view: e.target.checked })}
                disabled={isAdmin}
              />
              <span>View</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.pipeline.edit}
                onChange={(e) => updateSection('pipeline', { edit: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Edit</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.pipeline.delete}
                onChange={(e) => updateSection('pipeline', { delete: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Delete</span>
            </label>
          </div>
        </div>

        {/* Row 3: Dashboard */}
        <div className="perm-table-row">
          <div className="perm-td-module">
            <LayoutDashboard size={14} strokeWidth={2} />
            <span className="perm-module-name">Dashboard</span>
          </div>
          <div className="perm-td-scope">
            <select
              value={perms.dashboard.scope || 'assigned'}
              onChange={(e) => updateSection('dashboard', { scope: e.target.value })}
              disabled={isAdmin}
              className="perm-scope-select"
            >
              <option value="assigned">Only Assigned</option>
              <option value="all">Company-wide</option>
            </select>
          </div>
          <div className="perm-td-actions">
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.dashboard.view}
                onChange={(e) => updateSection('dashboard', { view: e.target.checked })}
                disabled={isAdmin}
              />
              <span>View</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.dashboard.view_deals !== false}
                onChange={(e) => updateSection('dashboard', { view_deals: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Deals</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.dashboard.view_activity !== false}
                onChange={(e) => updateSection('dashboard', { view_activity: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Activity</span>
            </label>
          </div>
        </div>

        {/* Row 4: Follow-ups */}
        <div className="perm-table-row">
          <div className="perm-td-module">
            <CalendarClock size={14} strokeWidth={2} />
            <span className="perm-module-name">Follow-ups</span>
          </div>
          <div className="perm-td-scope">
            <select
              value={perms.followups?.scope || 'self'}
              onChange={(e) => updateSection('followups', { scope: e.target.value })}
              disabled={isAdmin}
              className="perm-scope-select"
            >
              <option value="self">Only Self</option>
              <option value="all">All Follow-ups</option>
            </select>
          </div>
          <div className="perm-td-actions">
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.followups?.view !== false}
                onChange={(e) => updateSection('followups', { view: e.target.checked })}
                disabled={isAdmin}
              />
              <span>View</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.followups?.delete !== false}
                onChange={(e) => updateSection('followups', { delete: e.target.checked })}
                disabled={isAdmin}
              />
              <span>Delete</span>
            </label>
          </div>
        </div>

        {/* Row 5: Admin */}
        <div className="perm-table-row">
          <div className="perm-td-module">
            <Shield size={14} strokeWidth={2} />
            <span className="perm-module-name">Admin</span>
          </div>
          <div className="perm-td-scope">
            <span className="perm-scope-na">—</span>
          </div>
          <div className="perm-td-actions">
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.admin.manage_users}
                onChange={(e) => updateAdminField('manage_users', e.target.checked)}
                disabled={isAdmin}
              />
              <span>Users</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.admin.manage_routing}
                onChange={(e) => updateAdminField('manage_routing', e.target.checked)}
                disabled={isAdmin}
              />
              <span>Routing</span>
            </label>
            <label className="perm-pill-checkbox">
              <input
                type="checkbox"
                checked={perms.admin.manage_meta}
                onChange={(e) => updateAdminField('manage_meta', e.target.checked)}
                disabled={isAdmin}
              />
              <span>Meta Ads</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
