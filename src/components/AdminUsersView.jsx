import { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  Search,
  Key,
  Shield,
  Trash2,
  X,
  Check,
  Eye,
  EyeOff,
  UserCheck,
  Edit2,
  Sliders
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import PermissionsEditor from './PermissionsEditor';
import {
  normalizePermissions,
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS
} from '../lib/permissions';
import Skeleton from './common/Skeleton';
import CustomSelect from './common/CustomSelect';
import '../styles/admin.css';
import '../styles/pipeline.css';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Team Member' },
  { value: 'admin', label: 'Administrator' }
];

export default function AdminUsersView({ currentUser, onLogout }) {
  const [users, setUsers] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_users');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPins, setShowPins] = useState({}); // { [userId]: boolean }

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  // Add User Form state
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPin, setAddPin] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [addPerms, setAddPerms] = useState(DEFAULT_MEMBER_PERMISSIONS);

  // Change PIN state
  const [newPin, setNewPin] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete User Confirmation state
  const [deletePin, setDeletePin] = useState('');
  const [deletePinError, setDeletePinError] = useState('');

  // Fetch users & setup realtime
  useEffect(() => {
    let isMounted = true;

    const fetchUsers = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('crm_users')
          .select('*')
          .order('created_at', { ascending: true });

        if (!error && isMounted) {
          setUsers(data || []);
          try {
            localStorage.setItem('crm_cached_users', JSON.stringify(data || []));
          } catch (e) {}
        }
      } catch (err) {
        console.warn('Could not fetch crm_users from Supabase:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchUsers();

    const channel = supabase
      .channel('crm_users-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_users' },
        (payload) => {
          if (!isMounted) return;
          if (payload.eventType === 'INSERT') {
            setUsers((prev) => {
              if (prev.some((u) => u.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          } else if (payload.eventType === 'DELETE') {
            setUsers((prev) => prev.filter((u) => u.id !== payload.old.id));
            if (
              currentUser &&
              currentUser.id === payload.old.id &&
              typeof onLogout === 'function'
            ) {
              onLogout();
            }
          } else if (payload.eventType === 'UPDATE') {
            setUsers((prev) =>
              prev.map((u) => (u.id === payload.new.id ? payload.new : u))
            );
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Sync users to localStorage cache
  useEffect(() => {
    if (users && users.length > 0) {
      try {
        localStorage.setItem('crm_cached_users', JSON.stringify(users));
      } catch (e) {}
    }
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  const toggleShowPin = (userId) => {
    setShowPins((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  // Handle Add User
  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!addName.trim() || !addEmail.trim()) {
      setFormError('Please enter user name and email.');
      return;
    }

    if (!/^\d{4}$/.test(addPin)) {
      setFormError('PIN must be exactly 4 digits (e.g. 1234).');
      return;
    }

    setIsSubmitting(true);
    const userPayload = {
      name: addName.trim(),
      email: addEmail.trim().toLowerCase(),
      pin: addPin,
      role: addRole,
      permissions: addPerms
    };

    const tempId = `temp-${Date.now()}`;
    setUsers((prev) => [...prev, { id: tempId, ...userPayload }]);
    setIsAddModalOpen(false);
    setAddName('');
    setAddEmail('');
    setAddPin('');
    setAddRole('member');
    setAddPerms(DEFAULT_MEMBER_PERMISSIONS);

    try {
      const { data, error } = await supabase
        .from('crm_users')
        .insert([userPayload])
        .select()
        .single();

      if (data) {
        setUsers((prev) => prev.map((u) => (u.id === tempId ? data : u)));
      } else if (error) {
        console.warn('Note adding user to Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Error inserting user:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Change PIN
  const handleChangePin = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!/^\d{4}$/.test(newPin)) {
      setFormError('PIN must be exactly 4 digits (e.g. 5678).');
      return;
    }

    if (!selectedUser) return;

    setIsSubmitting(true);
    const updatedUserId = selectedUser.id;
    const pinToSet = newPin;

    setUsers((prev) =>
      prev.map((u) => (u.id === updatedUserId ? { ...u, pin: pinToSet } : u))
    );
    setIsPinModalOpen(false);
    setNewPin('');

    try {
      const { error } = await supabase
        .from('crm_users')
        .update({ pin: pinToSet })
        .eq('id', updatedUserId);

      if (error) {
        console.warn('Note updating PIN in Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Error updating PIN:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Edit Permissions
  const handleUpdatePermissions = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;

    setIsSubmitting(true);
    const updatedUserId = selectedUser.id;
    const updatedPerms = selectedUser.permissions;
    const updatedRole = selectedUser.role;

    setUsers((prev) =>
      prev.map((u) =>
        u.id === updatedUserId
          ? { ...u, permissions: updatedPerms, role: updatedRole }
          : u
      )
    );
    setIsEditModalOpen(false);

    try {
      const { error } = await supabase
        .from('crm_users')
        .update({ permissions: updatedPerms, role: updatedRole })
        .eq('id', updatedUserId);

      if (error) {
        console.warn('Note updating permissions in Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Error updating permissions:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Trigger Delete Confirmation Modal
  const handlePromptDelete = (user) => {
    if (users.length <= 1) {
      alert('Cannot delete the last remaining user.');
      return;
    }
    setUserToDelete(user);
    setDeletePin('');
    setDeletePinError('');
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isSubmitting) return;
    setIsDeleteModalOpen(false);
    setUserToDelete(null);
    setDeletePin('');
    setDeletePinError('');
  };

  // Perform Delete after user confirmation
  const handleConfirmDelete = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!userToDelete) return;
    setDeletePinError('');

    // Active logged-in administrator PIN check
    const activeAdmin = users.find(
      (u) =>
        (currentUser?.id && u.id === currentUser.id) ||
        (currentUser?.email && u.email?.toLowerCase() === currentUser.email?.toLowerCase())
    ) || currentUser;

    const currentAdminPin = (activeAdmin?.pin || currentUser?.pin || '').trim();

    if (!deletePin || deletePin.trim() !== currentAdminPin) {
      setDeletePinError('Incorrect PIN. Please re-enter your admin PIN.');
      return;
    }

    const userId = userToDelete.id;
    const targetUser = userToDelete;

    setIsSubmitting(true);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setIsDeleteModalOpen(false);
    setUserToDelete(null);
    setDeletePin('');
    setDeletePinError('');

    try {
      const { error } = await supabase.from('crm_users').delete().eq('id', userId);
      if (error) {
        console.warn('Note deleting user in Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Error deleting user:', err);
    } finally {
      setIsSubmitting(false);
    }

    // If the deleted user is the currently logged in user, logout immediately
    if (
      currentUser &&
      (currentUser.id === userId ||
        (targetUser &&
          currentUser.email?.toLowerCase() === targetUser.email?.toLowerCase()))
    ) {
      if (typeof onLogout === 'function') {
        onLogout();
      }
    }
  };

  return (
    <div className="admin-view-container">
      <div className="admin-view-inner">
        {/* Master Header matching pipeline-master-header */}
        <div className="admin-master-header">
          <div className="admin-master-title-group">
            <h1 className="admin-master-title">Users</h1>
            <span className="admin-master-count" style={{ minWidth: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {isLoading ? <Skeleton width="18px" height="14px" borderRadius="4px" /> : users.length}
            </span>
          </div>

          <div className="admin-actions-group">
            <div className="admin-search-wrapper">
              <Search size={15} strokeWidth={1.75} className="admin-search-icon" />
              <input
                type="text"
                className="admin-search-input"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="admin-add-user-btn"
              onClick={() => {
                setFormError('');
                setIsAddModalOpen(true);
              }}
            >
              <Plus size={15} strokeWidth={2} />
              <span>Add User</span>
            </button>
          </div>
        </div>

        {/* Users Numbered List */}
        <div className="admin-users-numbered-list">
          {isLoading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="admin-user-numbered-item" style={{ pointerEvents: 'none' }}>
                <span className="pipeline-number-index" style={{ opacity: 0.35 }}>{i}</span>
                <div className="admin-user-details-col">
                  <Skeleton width={i === 1 ? '140px' : i === 2 ? '175px' : i === 3 ? '125px' : '155px'} height="17px" borderRadius="4px" />
                  <Skeleton width={i === 1 ? '165px' : i === 2 ? '195px' : i === 3 ? '145px' : '175px'} height="12px" borderRadius="3px" style={{ marginTop: 4 }} />
                </div>
                <div className="admin-col-role">
                  <Skeleton width="58px" height="22px" borderRadius="999px" />
                </div>
                <div className="admin-col-pin">
                  <Skeleton width="82px" height="26px" borderRadius="6px" />
                </div>
                <div className="admin-col-perm">
                  <Skeleton width="110px" height="24px" borderRadius="6px" />
                </div>
                <div className="admin-col-actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Skeleton width="28px" height="28px" borderRadius="6px" />
                  <Skeleton width="28px" height="28px" borderRadius="6px" />
                </div>
              </div>
            ))
          ) : filteredUsers.length > 0 ? (
            filteredUsers.map((user, idx) => {
              const isMasked = !showPins[user.id];
              const p = normalizePermissions(user);
              const activeModules = [
                p.leads.view && `Leads (${p.leads.scope === 'all' ? 'All' : 'Assigned'})`,
                p.pipeline.view && 'Pipeline',
                p.dashboard.view && `Dashboard (${p.dashboard.scope === 'all' ? 'All' : 'Assigned'})`,
                (p.admin.manage_users || p.admin.manage_routing || p.admin.manage_meta) && 'Admin'
              ].filter(Boolean);

              return (
                <div key={user.id} className="admin-user-numbered-item">
                  {/* Col 1: Index Number */}
                  <span className="pipeline-number-index">{idx + 1}</span>

                  {/* Col 2: Member Info (Name & Email) */}
                  <div className="admin-user-details-col">
                    <span className="admin-user-title">{user.name}</span>
                    <span className="admin-user-subtext">{user.email}</span>
                  </div>

                  {/* Col 3: Role Pill */}
                  <div className="admin-col-role">
                    <span className={`admin-role-pill ${user.role || 'member'}`}>
                      {user.role === 'admin' ? 'Admin' : 'Member'}
                    </span>
                  </div>

                  {/* Col 4: PIN Pill with Reveal Toggle */}
                  <div className="admin-col-pin">
                    <div className="admin-pin-pill" title="4-digit Login PIN">
                      <span
                        className="admin-pin-text"
                        onClick={() => {
                          setSelectedUser(user);
                          setNewPin('');
                          setFormError('');
                          setIsPinModalOpen(true);
                        }}
                        title="Click to change PIN"
                      >
                        {isMasked ? '••••' : user.pin}
                      </span>
                      <button
                        type="button"
                        className="admin-pin-toggle-btn"
                        onClick={() => toggleShowPin(user.id)}
                        data-tooltip={isMasked ? 'Reveal PIN' : 'Hide PIN'}
                        aria-label={isMasked ? 'Reveal PIN' : 'Hide PIN'}
                      >
                        {isMasked ? (
                          <Eye size={13} strokeWidth={1.75} />
                        ) : (
                          <EyeOff size={13} strokeWidth={1.75} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Col 5: Permissions Badge */}
                  <div className="admin-col-perm">
                    {user.role === 'admin' ? (
                      <span className="admin-perm-pill admin">Full Access</span>
                    ) : (
                      <button
                        type="button"
                        className="admin-perm-pill member"
                        onClick={() => {
                          setSelectedUser({
                            ...user,
                            permissions: p
                          });
                          setIsEditModalOpen(true);
                        }}
                        data-tooltip={activeModules.length > 0 ? activeModules.join(' · ') : 'Restricted'}
                      >
                        Custom Access
                      </button>
                    )}
                  </div>

                  {/* Col 6: Actions: Change PIN, Edit Permissions, Delete User */}
                  <div className="admin-col-actions">
                    <div className="admin-action-icons-cluster">
                      <button
                        type="button"
                        className="btn-admin-action"
                        data-tooltip="Change PIN"
                        onClick={() => {
                          setSelectedUser(user);
                          setNewPin('');
                          setFormError('');
                          setIsPinModalOpen(true);
                        }}
                        aria-label="Change PIN"
                      >
                        <Key size={15} strokeWidth={1.75} />
                      </button>

                      <button
                        type="button"
                        className="btn-admin-action"
                        data-tooltip="Edit Permissions"
                        onClick={() => {
                          setSelectedUser({
                            ...user,
                            permissions: p
                          });
                          setIsEditModalOpen(true);
                        }}
                        aria-label="Edit Permissions"
                      >
                        <Sliders size={15} strokeWidth={1.75} />
                      </button>

                      {users.length > 1 && (
                        <button
                          type="button"
                          className="btn-admin-action danger"
                          data-tooltip="Delete User"
                          onClick={() => handlePromptDelete(user)}
                          aria-label="Delete User"
                        >
                          <Trash2 size={15} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="admin-empty-wrap">
              <span className="admin-empty-text">No users found matching "{searchQuery}"</span>
            </div>
          )}
        </div>
      </div>

      {/* 1. Modal: Add User */}
      {isAddModalOpen && (
        <div className="admin-modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div
            className="admin-modal-card admin-modal-perms"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="admin-modal-header">
              <div className="admin-modal-title-group">
                <h2 className="admin-modal-title">Add Team Member</h2>
                <span className="admin-modal-subtitle">Invite a new user with specific role and module access</span>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <form onSubmit={handleAddUser}>
              <div className="admin-modal-body">
                {formError && (
                  <div className="admin-modal-error-banner">
                    {formError}
                  </div>
                )}

                <div className="admin-form-grid">
                  <div className="admin-field-group">
                    <label className="admin-field-label">Full Name</label>
                    <input
                      type="text"
                      className="admin-field-input"
                      placeholder="e.g. Ramesh Patel"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>

                  <div className="admin-field-group">
                    <label className="admin-field-label">Email Address</label>
                    <input
                      type="email"
                      className="admin-field-input"
                      placeholder="e.g. ramesh@company.com"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="admin-field-group" style={{ marginTop: '12px' }}>
                  <label className="admin-field-label">4-Digit Access PIN</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    className="admin-field-input"
                    placeholder="e.g. 5678"
                    value={addPin}
                    onChange={(e) =>
                      setAddPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    style={{ maxWidth: '160px', fontFamily: 'monospace', letterSpacing: '0.15em', fontWeight: 600 }}
                    required
                  />
                  <span className="admin-field-helper">
                    Numeric 4-digit code used to sign in instantly.
                  </span>
                </div>

                {/* Role Dropdown */}
                <div className="admin-modal-role-row">
                  <span className="admin-modal-role-label">Role</span>
                  <CustomSelect
                    value={addRole}
                    onChange={(role) => {
                      setAddRole(role);
                      if (role === 'admin') {
                        setAddPerms(DEFAULT_ADMIN_PERMISSIONS);
                      } else {
                        setAddPerms(DEFAULT_MEMBER_PERMISSIONS);
                      }
                    }}
                    options={ROLE_OPTIONS}
                    className="admin-role-select"
                  />
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label className="admin-field-label" style={{ marginBottom: '8px', display: 'block' }}>Permissions</label>
                  <PermissionsEditor
                    permissions={addPerms}
                    onChange={setAddPerms}
                    role={addRole}
                  />
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="btn-minimal"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-minimal-save"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adding...' : 'Add Team Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Change PIN */}
      {isPinModalOpen && selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setIsPinModalOpen(false)}>
          <div
            className="admin-modal-card admin-modal-pin"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="admin-modal-header">
              <div className="admin-modal-title-group">
                <h2 className="admin-modal-title">Change PIN</h2>
                <div className="admin-modal-user-pill">
                  <span className="admin-modal-user-name">{selectedUser.name}</span>
                  <span className="admin-modal-user-dot">·</span>
                  <span className="admin-modal-user-email">{selectedUser.email}</span>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsPinModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <form onSubmit={handleChangePin}>
              <div className="admin-modal-body">
                {formError && (
                  <div className="admin-modal-error-banner">
                    {formError}
                  </div>
                )}

                <div className="admin-pin-display-wrapper">
                  <label className="admin-pin-large-label">New 4-Digit Access PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    className="admin-pin-large-input"
                    placeholder="••••"
                    value={newPin}
                    onChange={(e) =>
                      setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    autoFocus
                    required
                  />
                  <span className="admin-pin-large-helper">
                    Numeric code immediately active for login
                  </span>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="btn-minimal"
                  onClick={() => setIsPinModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-minimal-save"
                  disabled={isSubmitting || newPin.length !== 4}
                >
                  {isSubmitting ? 'Saving...' : 'Update PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal: Edit Permissions */}
      {isEditModalOpen && selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setIsEditModalOpen(false)}>
          <div
            className="admin-modal-card admin-modal-perms"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="admin-modal-header">
              <div className="admin-modal-title-group">
                <h2 className="admin-modal-title">Edit Permissions</h2>
                <div className="admin-modal-user-pill">
                  <span className="admin-modal-user-name">{selectedUser.name}</span>
                  <span className={`admin-role-pill ${selectedUser.role || 'member'}`}>
                    {selectedUser.role === 'admin' ? 'Admin' : 'Member'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <form onSubmit={handleUpdatePermissions}>
              <div className="admin-modal-body">
                {/* Role Dropdown */}
                <div className="admin-modal-role-row">
                  <span className="admin-modal-role-label">Member Role</span>
                  <CustomSelect
                    value={selectedUser.role || 'member'}
                    onChange={(newRole) => {
                      setSelectedUser({
                        ...selectedUser,
                        role: newRole,
                        permissions:
                          newRole === 'admin'
                            ? DEFAULT_ADMIN_PERMISSIONS
                            : selectedUser.permissions
                      });
                    }}
                    options={ROLE_OPTIONS}
                    className="admin-role-select"
                  />
                </div>

                <PermissionsEditor
                  permissions={selectedUser.permissions}
                  onChange={(updated) =>
                    setSelectedUser({ ...selectedUser, permissions: updated })
                  }
                  role={selectedUser.role || 'member'}
                />
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="btn-minimal"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-minimal-save"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Modal: Delete User Confirmation */}
      {isDeleteModalOpen && userToDelete && (
        <div
          className="admin-modal-backdrop"
          onClick={handleCloseDeleteModal}
        >
          <div
            className="admin-modal-card admin-modal-delete"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <form onSubmit={handleConfirmDelete} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div className="admin-modal-header">
                <div className="admin-modal-title-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
                  <div className="admin-delete-icon-badge">
                    <Trash2 size={16} strokeWidth={2} />
                  </div>
                  <div>
                    <h2 className="admin-modal-title">Delete Team Member</h2>
                    <span className="admin-modal-subtitle">Confirm permanent removal</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="admin-modal-close-btn"
                  onClick={handleCloseDeleteModal}
                  aria-label="Close"
                  disabled={isSubmitting}
                >
                  <X size={16} strokeWidth={1.8} />
                </button>
              </div>

              <div className="admin-modal-body">
                <p className="admin-delete-prompt">
                  Are you sure you want to remove this user from your team?
                </p>

                <div className="admin-delete-user-card">
                  <div className="admin-user-details-col">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="admin-user-title" style={{ fontSize: '15px' }}>{userToDelete.name}</span>
                      <span className={`admin-role-pill ${userToDelete.role || 'member'}`}>
                        {userToDelete.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                    </div>
                    <span className="admin-user-subtext">{userToDelete.email}</span>
                  </div>
                </div>

                <div className="admin-delete-warning-banner">
                  <span>This action cannot be undone. The user will immediately lose sign-in access to the CRM.</span>
                </div>

                <div className="admin-delete-pin-group">
                  <label htmlFor="delete-pin-input" className="admin-delete-pin-label">
                    Re-enter your PIN to confirm
                  </label>
                  <div className="admin-delete-pin-wrapper">
                    <input
                      id="delete-pin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      autoFocus
                      placeholder="••••"
                      value={deletePin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setDeletePin(val);
                        if (deletePinError) setDeletePinError('');
                      }}
                      className={`admin-delete-pin-input ${deletePinError ? 'has-error' : ''}`}
                      disabled={isSubmitting}
                      autoComplete="off"
                    />
                  </div>
                  {deletePinError ? (
                    <span className="admin-delete-pin-error">{deletePinError}</span>
                  ) : (
                    <span className="admin-delete-pin-hint">Enter your 4-digit admin PIN to authorize permanent deletion</span>
                  )}
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="btn-minimal"
                  onClick={handleCloseDeleteModal}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-danger-confirm"
                  disabled={isSubmitting || deletePin.length !== 4}
                >
                  {isSubmitting ? 'Deleting...' : 'Delete Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
