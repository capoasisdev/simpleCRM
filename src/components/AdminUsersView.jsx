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
  Edit2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import PermissionsEditor from './PermissionsEditor';
import {
  normalizePermissions,
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS
} from '../lib/permissions';
import Skeleton from './common/Skeleton';
import '../styles/admin.css';

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
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_users');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch (e) {}
    return true;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showPins, setShowPins] = useState({}); // { [userId]: boolean }

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
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

  // Fetch users & setup realtime
  useEffect(() => {
    let isMounted = true;

    const fetchUsers = async () => {
      try {
        if (!users || users.length === 0) {
          setIsLoading(true);
        }
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

  // Handle Delete User
  const handleDeleteUser = async (userId) => {
    if (users.length <= 1) {
      alert('Cannot delete the last remaining user.');
      return;
    }

    const userToDelete = users.find((u) => u.id === userId);
    setUsers((prev) => prev.filter((u) => u.id !== userId));

    try {
      const { error } = await supabase.from('crm_users').delete().eq('id', userId);
      if (error) {
        console.warn('Note deleting user in Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Error deleting user:', err);
    }

    // If the deleted user is the currently logged in user, logout immediately
    if (
      currentUser &&
      (currentUser.id === userId ||
        (userToDelete &&
          currentUser.email?.toLowerCase() === userToDelete.email?.toLowerCase()))
    ) {
      if (typeof onLogout === 'function') {
        onLogout();
      }
    }
  };

  return (
    <div className="admin-view-container">
      {/* Header Toolbar */}
      <div className="admin-toolbar">
        <div className="admin-header-titles">
          <h1 className="admin-main-title">User & Permission Management</h1>
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

      {/* Users Table */}
      <div className="admin-table-container">
        <table className="admin-users-table">
          <thead>
            <tr>
              <th>Team Member</th>
              <th>Role</th>
              <th>4-Digit PIN</th>
              <th>Permissions</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <tr key={i} className="table-row-skeleton">
                  <td>
                    <div className="admin-user-cell">
                      <Skeleton width="34px" height="34px" circle />
                      <div className="admin-user-info" style={{ gap: '6px' }}>
                        <Skeleton width="120px" height="14px" />
                        <Skeleton width="160px" height="11px" />
                      </div>
                    </div>
                  </td>
                  <td>
                    <Skeleton width="60px" height="20px" borderRadius="12px" />
                  </td>
                  <td>
                    <Skeleton width="48px" height="14px" />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <Skeleton width="55px" height="18px" borderRadius="4px" />
                      <Skeleton width="45px" height="18px" borderRadius="4px" />
                      <Skeleton width="45px" height="18px" borderRadius="4px" />
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Skeleton width="26px" height="26px" borderRadius="4px" />
                      <Skeleton width="26px" height="26px" borderRadius="4px" />
                    </div>
                  </td>
                </tr>
              ))
            ) : filteredUsers.length > 0 ? (
              filteredUsers.map((user) => {
                const isMasked = !showPins[user.id];
                const perms = user.permissions || {};
                const initials = (user.name || 'U')
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .substring(0, 2)
                  .toUpperCase();

                return (
                  <tr key={user.id} className="fade-in-row">
                    <td>
                      <div className="admin-user-cell">
                        <div className="admin-avatar">{initials}</div>
                        <div className="admin-user-info">
                          <span className="admin-user-name">{user.name}</span>
                          <span className="admin-user-email">{user.email}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className={`admin-role-badge ${user.role || 'member'}`}>
                        {user.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                    </td>

                    <td>
                      <div className="admin-pin-cell">
                        <span
                          className="admin-pin-code"
                          title="Click to change PIN"
                          onClick={() => {
                            setSelectedUser(user);
                            setNewPin('');
                            setFormError('');
                            setIsPinModalOpen(true);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {isMasked ? '••••' : user.pin}
                        </span>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title={isMasked ? 'Reveal PIN' : 'Hide PIN'}
                          onClick={() => toggleShowPin(user.id)}
                        >
                          {isMasked ? (
                            <Eye size={13} strokeWidth={1.75} />
                          ) : (
                            <EyeOff size={13} strokeWidth={1.75} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Change PIN"
                          onClick={() => {
                            setSelectedUser(user);
                            setNewPin('');
                            setFormError('');
                            setIsPinModalOpen(true);
                          }}
                        >
                          <Key size={13} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>

                    <td>
                      <div className="admin-perms-summary-cell">
                        {user.role === 'admin' ? (
                          <span className="admin-perm-badge admin">Full Access</span>
                        ) : (() => {
                          const p = normalizePermissions(user);
                          const activeModules = [
                            p.leads.view && `Leads (${p.leads.scope === 'all' ? 'All' : 'Assigned'})`,
                            p.pipeline.view && 'Pipeline',
                            p.dashboard.view && `Dashboard (${p.dashboard.scope === 'all' ? 'All' : 'Assigned'})`,
                            (p.admin.manage_users || p.admin.manage_routing || p.admin.manage_meta) && 'Admin'
                          ].filter(Boolean);

                          return (
                            <div
                              className="admin-perms-summary"
                              onClick={() => {
                                setSelectedUser({
                                  ...user,
                                  permissions: p
                                });
                                setIsEditModalOpen(true);
                              }}
                              title="Click to edit permissions"
                            >
                              <span className="admin-perm-badge member">Custom Access</span>
                              <span className="admin-perm-summary-text" title={activeModules.join(' • ')}>
                                {activeModules.length > 0 ? activeModules.join(' · ') : 'Restricted'}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div
                        className="admin-row-actions"
                        style={{ justifyContent: 'flex-end' }}
                      >
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Edit Permissions"
                          onClick={() => {
                            setSelectedUser({
                              ...user,
                              permissions: normalizePermissions(user)
                            });
                            setIsEditModalOpen(true);
                          }}
                        >
                          <Edit2 size={13} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          className="admin-icon-btn danger"
                          title="Delete User"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          <Trash2 size={13} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="5" className="admin-empty-state">
                  No users found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 1. Modal: Add User */}
      {isAddModalOpen && (
        <div className="lead-modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div
            className="lead-modal-container admin-permissions-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-modal-header">
              <h2 className="lead-modal-title">Add Team Member</h2>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setIsAddModalOpen(false)}
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleAddUser}>
              <div className="lead-modal-body">
                {formError && (
                  <div
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#fef2f2',
                      color: '#ef4444',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '12px'
                    }}
                  >
                    {formError}
                  </div>
                )}

                <div className="lead-field-group">
                  <label className="lead-field-label">Full Name</label>
                  <input
                    type="text"
                    className="lead-field-input"
                    placeholder="e.g. Ramesh Patel"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Email Address</label>
                  <input
                    type="email"
                    className="lead-field-input"
                    placeholder="e.g. ramesh@company.com"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">4-Digit Access PIN</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    className="lead-field-input"
                    placeholder="e.g. 5678"
                    value={addPin}
                    onChange={(e) =>
                      setAddPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    required
                  />
                  <span className="pin-input-helper">
                    User uses this 4-digit PIN to sign in instantly.
                  </span>
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Role</label>
                  <select
                    className="lead-field-input"
                    value={addRole}
                    onChange={(e) => {
                      const role = e.target.value;
                      setAddRole(role);
                      if (role === 'admin') {
                        setAddPerms(DEFAULT_ADMIN_PERMISSIONS);
                      } else {
                        setAddPerms(DEFAULT_MEMBER_PERMISSIONS);
                      }
                    }}
                  >
                    <option value="member">Team Member</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Permissions</label>
                  <PermissionsEditor
                    permissions={addPerms}
                    onChange={setAddPerms}
                    role={addRole}
                  />
                </div>
              </div>

              <div className="lead-modal-footer">
                <button
                  type="button"
                  className="lead-modal-cancel-btn"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lead-modal-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adding...' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Change PIN */}
      {isPinModalOpen && selectedUser && (
        <div className="lead-modal-backdrop" onClick={() => setIsPinModalOpen(false)}>
          <div
            className="lead-modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-modal-header">
              <h2 className="lead-modal-title">Change 4-Digit PIN</h2>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setIsPinModalOpen(false)}
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleChangePin}>
              <div className="lead-modal-body">
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '14px' }}>
                  Setting new access PIN for <strong>{selectedUser.name}</strong> ({selectedUser.email}).
                </p>

                {formError && (
                  <div
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#fef2f2',
                      color: '#ef4444',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '12px'
                    }}
                  >
                    {formError}
                  </div>
                )}

                <div className="lead-field-group">
                  <label className="lead-field-label">New 4-Digit PIN</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    className="lead-field-input"
                    placeholder="Enter 4 digits (e.g. 9876)"
                    value={newPin}
                    onChange={(e) =>
                      setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    autoFocus
                    required
                  />
                  <span className="pin-input-helper">
                    This PIN will be immediately active for logging in.
                  </span>
                </div>
              </div>

              <div className="lead-modal-footer">
                <button
                  type="button"
                  className="lead-modal-cancel-btn"
                  onClick={() => setIsPinModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lead-modal-submit-btn"
                  disabled={isSubmitting}
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
        <div className="lead-modal-backdrop" onClick={() => setIsEditModalOpen(false)}>
          <div
            className="lead-modal-container admin-permissions-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="lead-modal-header">
              <h2 className="lead-modal-title">Edit Permissions</h2>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleUpdatePermissions}>
              <div className="lead-modal-body">
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '14px' }}>
                  Managing access rights for <strong>{selectedUser.name}</strong>
                </p>

                <div className="lead-field-group">
                  <label className="lead-field-label">Role</label>
                  <select
                    className="lead-field-input"
                    value={selectedUser.role || 'member'}
                    onChange={(e) => {
                      const newRole = e.target.value;
                      setSelectedUser({
                        ...selectedUser,
                        role: newRole,
                        permissions:
                          newRole === 'admin'
                            ? DEFAULT_ADMIN_PERMISSIONS
                            : selectedUser.permissions
                      });
                    }}
                  >
                    <option value="member">Team Member</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div className="lead-field-group">
                  <label className="lead-field-label">Permissions</label>
                  <PermissionsEditor
                    permissions={selectedUser.permissions}
                    onChange={(updated) =>
                      setSelectedUser({ ...selectedUser, permissions: updated })
                    }
                    role={selectedUser.role || 'member'}
                  />
                </div>
              </div>

              <div className="lead-modal-footer">
                <button
                  type="button"
                  className="lead-modal-cancel-btn"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lead-modal-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
