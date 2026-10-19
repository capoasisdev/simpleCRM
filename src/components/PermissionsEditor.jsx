import {
  UserCheck,
  GitFork,
  LayoutDashboard,
  BarChart3,
  CalendarClock,
  Shield,
  Info,
  Check,
  MessageSquare
} from 'lucide-react';
import { normalizePermissions } from '../lib/permissions';
import CustomSelect from './common/CustomSelect';

const LEADS_SCOPE_OPTIONS = [
  { value: 'assigned', label: 'Only Assigned' },
  { value: 'all', label: 'All Leads' }
];

const MESSAGES_SCOPE_OPTIONS = [
  { value: 'assigned', label: 'Only Assigned' },
  { value: 'all', label: 'All Contacts' }
];

const DASHBOARD_SCOPE_OPTIONS = [
  { value: 'assigned', label: 'Only Assigned' },
  { value: 'all', label: 'Company-wide' }
];

const ANALYTICS_SCOPE_OPTIONS = [
  { value: 'assigned', label: 'Only Assigned' },
  { value: 'all', label: 'Company-wide' }
];

const FOLLOWUPS_SCOPE_OPTIONS = [
  { value: 'self', label: 'Only Self' },
  { value: 'all', label: 'All Follow-ups' }
];

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
          <Info size={14} className="banner-info-icon" />
          <span>Administrators have unrestricted access to all modules and system settings.</span>
        </div>
      )}

      {/* 3-Column Header */}
      <div className="perm-grid-head">
        <span>Section</span>
        <span>Scope</span>
        <span style={{ textAlign: 'right' }}>Permissions</span>
      </div>

      <div className={`perm-sections-stack ${isAdmin ? 'disabled-view' : ''}`}>
        {/* Row 1: Leads */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <UserCheck size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Leads</span>
          </div>
          <div className="perm-col-scope">
            <CustomSelect
              value={perms.leads.scope}
              onChange={(val) => updateSection('leads', { scope: val })}
              options={LEADS_SCOPE_OPTIONS}
              disabled={isAdmin}
              className="admin-scope-select"
            />
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.leads.view ? 'active' : ''}`}
              onClick={() => updateSection('leads', { view: !perms.leads.view })}
              disabled={isAdmin}
            >
              {perms.leads.view && <Check size={11} strokeWidth={2.5} />}
              <span>View</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.leads.edit ? 'active' : ''}`}
              onClick={() => updateSection('leads', { edit: !perms.leads.edit })}
              disabled={isAdmin}
            >
              {perms.leads.edit && <Check size={11} strokeWidth={2.5} />}
              <span>Edit</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.leads.delete ? 'active' : ''}`}
              onClick={() => updateSection('leads', { delete: !perms.leads.delete })}
              disabled={isAdmin}
            >
              {perms.leads.delete && <Check size={11} strokeWidth={2.5} />}
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Row 2: Messages */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <MessageSquare size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Messages</span>
          </div>
          <div className="perm-col-scope">
            <CustomSelect
              value={perms.messages?.scope || 'assigned'}
              onChange={(val) => updateSection('messages', { scope: val })}
              options={MESSAGES_SCOPE_OPTIONS}
              disabled={isAdmin}
              className="admin-scope-select"
            />
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.messages?.view ? 'active' : ''}`}
              onClick={() => updateSection('messages', { view: !perms.messages?.view })}
              disabled={isAdmin}
            >
              {perms.messages?.view && <Check size={11} strokeWidth={2.5} />}
              <span>View</span>
            </button>
          </div>
        </div>

        {/* Row 3: Pipelines */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <GitFork size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Pipelines</span>
          </div>
          <div className="perm-col-scope">
            <span className="perm-scope-na">—</span>
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.pipeline.view ? 'active' : ''}`}
              onClick={() => updateSection('pipeline', { view: !perms.pipeline.view })}
              disabled={isAdmin}
            >
              {perms.pipeline.view && <Check size={11} strokeWidth={2.5} />}
              <span>View</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.pipeline.edit ? 'active' : ''}`}
              onClick={() => updateSection('pipeline', { edit: !perms.pipeline.edit })}
              disabled={isAdmin}
            >
              {perms.pipeline.edit && <Check size={11} strokeWidth={2.5} />}
              <span>Edit</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.pipeline.delete ? 'active' : ''}`}
              onClick={() => updateSection('pipeline', { delete: !perms.pipeline.delete })}
              disabled={isAdmin}
            >
              {perms.pipeline.delete && <Check size={11} strokeWidth={2.5} />}
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Row 3: Dashboard */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <LayoutDashboard size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Dashboard</span>
          </div>
          <div className="perm-col-scope">
            <CustomSelect
              value={perms.dashboard.scope || 'assigned'}
              onChange={(val) => updateSection('dashboard', { scope: val })}
              options={DASHBOARD_SCOPE_OPTIONS}
              disabled={isAdmin}
              className="admin-scope-select"
            />
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.dashboard.view ? 'active' : ''}`}
              onClick={() => updateSection('dashboard', { view: !perms.dashboard.view })}
              disabled={isAdmin}
            >
              {perms.dashboard.view && <Check size={11} strokeWidth={2.5} />}
              <span>View</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.dashboard.view_deals !== false ? 'active' : ''}`}
              onClick={() => updateSection('dashboard', { view_deals: !(perms.dashboard.view_deals !== false) })}
              disabled={isAdmin}
            >
              {perms.dashboard.view_deals !== false && <Check size={11} strokeWidth={2.5} />}
              <span>Deals</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.dashboard.view_activity !== false ? 'active' : ''}`}
              onClick={() => updateSection('dashboard', { view_activity: !(perms.dashboard.view_activity !== false) })}
              disabled={isAdmin}
            >
              {perms.dashboard.view_activity !== false && <Check size={11} strokeWidth={2.5} />}
              <span>Activity</span>
            </button>
          </div>
        </div>

        {/* Row: Analytics */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <BarChart3 size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Analytics</span>
          </div>
          <div className="perm-col-scope">
            <CustomSelect
              value={perms.analytics?.scope || 'assigned'}
              onChange={(val) => updateSection('analytics', { scope: val })}
              options={ANALYTICS_SCOPE_OPTIONS}
              disabled={isAdmin}
              className="admin-scope-select"
            />
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.analytics?.view !== false ? 'active' : ''}`}
              onClick={() => updateSection('analytics', { view: !(perms.analytics?.view !== false) })}
              disabled={isAdmin}
            >
              {perms.analytics?.view !== false && <Check size={11} strokeWidth={2.5} />}
              <span>View</span>
            </button>
          </div>
        </div>

        {/* Row 4: Follow-ups */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <CalendarClock size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Follow-ups</span>
          </div>
          <div className="perm-col-scope">
            <CustomSelect
              value={perms.followups?.scope || 'self'}
              onChange={(val) => updateSection('followups', { scope: val })}
              options={FOLLOWUPS_SCOPE_OPTIONS}
              disabled={isAdmin}
              className="admin-scope-select"
            />
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.followups?.view !== false ? 'active' : ''}`}
              onClick={() => updateSection('followups', { view: !(perms.followups?.view !== false) })}
              disabled={isAdmin}
            >
              {perms.followups?.view !== false && <Check size={11} strokeWidth={2.5} />}
              <span>View</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.followups?.delete !== false ? 'active' : ''}`}
              onClick={() => updateSection('followups', { delete: !(perms.followups?.delete !== false) })}
              disabled={isAdmin}
            >
              {perms.followups?.delete !== false && <Check size={11} strokeWidth={2.5} />}
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Row 5: Admin */}
        <div className="perm-section-row">
          <div className="perm-col-module">
            <Shield size={15} strokeWidth={1.8} className="perm-section-icon" />
            <span className="perm-section-name">Admin</span>
          </div>
          <div className="perm-col-scope">
            <span className="perm-scope-na">—</span>
          </div>
          <div className="perm-col-actions">
            <button
              type="button"
              className={`perm-pill-toggle ${perms.admin.manage_users ? 'active' : ''}`}
              onClick={() => updateAdminField('manage_users', !perms.admin.manage_users)}
              disabled={isAdmin}
            >
              {perms.admin.manage_users && <Check size={11} strokeWidth={2.5} />}
              <span>Users</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.admin.manage_routing ? 'active' : ''}`}
              onClick={() => updateAdminField('manage_routing', !perms.admin.manage_routing)}
              disabled={isAdmin}
            >
              {perms.admin.manage_routing && <Check size={11} strokeWidth={2.5} />}
              <span>Routing</span>
            </button>
            <button
              type="button"
              className={`perm-pill-toggle ${perms.admin.manage_meta ? 'active' : ''}`}
              onClick={() => updateAdminField('manage_meta', !perms.admin.manage_meta)}
              disabled={isAdmin}
            >
              {perms.admin.manage_meta && <Check size={11} strokeWidth={2.5} />}
              <span>Meta Ads</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
