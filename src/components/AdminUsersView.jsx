import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Search,
  Key,
  Trash2,
  X,
  Check,
  Eye,
  EyeOff,
  Sliders,
  ChevronRight,
  Lock,
  Sparkles,
  Mail,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompany, getActiveCompanyId, readTenantCache, writeTenantCache } from '../lib/tenant';
import { fetchCompanyBillingSnapshot, syncSubscriptionSeats } from '../lib/billing';
import PermissionsEditor from './PermissionsEditor';
import {
  normalizePermissions,
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  isUserInSalesLeaderboard,
  canUserManageBilling,
  isWorkspaceBillingOwner
} from '../lib/permissions';
import {
  hashPassword,
  verifyUserCredentials,
  setUserPassword,
  generateRandomPassword,
  generateHumanPassword,
  sendUserInviteEmail,
  validatePasswordStrength
} from '../lib/auth.js';
import Skeleton from './common/Skeleton';
import CustomSelect from './common/CustomSelect';
import { haptic } from '../lib/haptics';
import { registerBackHandler } from '../lib/backButton';
import '../styles/admin.css';
import '../styles/pipeline.css';
import '../styles/securityModal.css';
import '../styles/billing.css';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Team Member' },
  { value: 'admin', label: 'Administrator' }
];

export default function AdminUsersView({
  currentUser,
  onLogout,
  onNavigateToBilling,
  onCurrentUserUpdated
}) {
  const [companyMeta, setCompanyMeta] = useState(() => getActiveCompany());
  const effectiveCompany = companyMeta || getActiveCompany();
  const callerCanManageBilling = canUserManageBilling(currentUser, effectiveCompany);
  const callerIsAdmin = currentUser?.role === 'admin';
  const availableRoleOptions = callerIsAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((opt) => opt.value !== 'admin');
  const [users, setUsers] = useState(() => {
    const parsed = readTenantCache('crm_cached_users', []);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [];
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPins, setShowPins] = useState({}); // { [userId]: boolean }
  const [activeMobileUser, setActiveMobileUser] = useState(null);

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
  const [addRole, setAddRole] = useState('member');
  const [addPerms, setAddPerms] = useState(DEFAULT_MEMBER_PERMISSIONS);
  const [createdInviteInfo, setCreatedInviteInfo] = useState(null);
  const [copiedTempPwd, setCopiedTempPwd] = useState(false);

  // Set / Reset Password state (replaces legacy Change PIN)
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete User Confirmation state
  const [deleteSecret, setDeleteSecret] = useState('');
  const [deleteSecretError, setDeleteSecretError] = useState('');

  // Native back button handling for modals & mobile sheet
  useEffect(() => {
    if (activeMobileUser) {
      return registerBackHandler(() => {
        setActiveMobileUser(null);
        return true;
      });
    }
  }, [activeMobileUser]);

  useEffect(() => {
    if (isAddModalOpen) {
      return registerBackHandler(() => {
        setIsAddModalOpen(false);
        return true;
      });
    }
  }, [isAddModalOpen]);

  useEffect(() => {
    if (isEditModalOpen) {
      return registerBackHandler(() => {
        setIsEditModalOpen(false);
        return true;
      });
    }
  }, [isEditModalOpen]);

  useEffect(() => {
    if (isPinModalOpen) {
      return registerBackHandler(() => {
        setIsPinModalOpen(false);
        return true;
      });
    }
  }, [isPinModalOpen]);

  useEffect(() => {
    if (isDeleteModalOpen) {
      return registerBackHandler(() => {
        setIsDeleteModalOpen(false);
        return true;
      });
    }
  }, [isDeleteModalOpen]);

  // Fetch users & setup realtime
  const activeCompanyId = getActiveCompanyId() || currentUser?.company_id || null;

  useEffect(() => {
    let isMounted = true;
    const companyId = activeCompanyId;
    if (!companyId) {
      setIsLoading(false);
      return;
    }

    const fetchUsers = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('crm_users')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true });

        if (isMounted && !error) {
          setUsers(data || []);
          try {
            // Strip raw password hashes and PINs from localStorage cache
            const safeCache = (data || []).map(({ password_hash, pin, ...u }) => ({
              ...u,
              has_password: Boolean(password_hash),
              has_legacy_pin: Boolean(pin)
            }));
            writeTenantCache('crm_cached_users', safeCache, companyId);
          } catch (e) {}
        }

        const snap = await fetchCompanyBillingSnapshot(companyId);
        if (isMounted && snap?.company) {
          setCompanyMeta(snap.company);
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
        { event: '*', schema: 'public', table: 'crm_users', filter: `company_id=eq.${companyId}` },
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
  }, [activeCompanyId]);

  // Sync users to localStorage cache (sanitized)
  useEffect(() => {
    if (users && users.length > 0 && activeCompanyId) {
      try {
        const safeCache = users.map(({ password_hash, pin, ...u }) => ({
          ...u,
          has_password: Boolean(password_hash),
          has_legacy_pin: Boolean(pin)
        }));
        writeTenantCache('crm_cached_users', safeCache, activeCompanyId);
      } catch (e) {}
    }
  }, [users, activeCompanyId]);

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

  // Handle Add User (automated human temporary password + invitation dispatch)
  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormError('');

    const trimmedName = addName.trim();
    const trimmedEmail = addEmail.trim().toLowerCase();

    if (!trimmedName || !trimmedEmail) {
      setFormError('Please enter user name and work email.');
      return;
    }

    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setFormError('Please enter a valid work email address.');
      return;
    }

    if (users.some((u) => u.email?.toLowerCase() === trimmedEmail)) {
      setFormError('A user with this email address already exists.');
      return;
    }

    const effectiveCompany = companyMeta || getActiveCompany();
    const companyId = effectiveCompany?.id || activeCompanyId;
    if (!companyId) {
      setFormError('Workspace context missing. Please sign in again.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Generate human-friendly temporary initial password based on name (e.g. "Rahul@4892")
      const tempPassword = generateHumanPassword(trimmedName);
      const passwordHash = await hashPassword(tempPassword);

      const userPayload = {
        company_id: companyId,
        name: trimmedName,
        email: trimmedEmail,
        password_hash: passwordHash,
        password_updated_at: new Date().toISOString(),
        must_change_password: true, // Forces permanent password setup on first login
        role: addRole,
        permissions: addPerms
      };

      // Insert to Supabase BEFORE closing modal or emailing credentials (enforces Postgres seat trigger & global email uniqueness)
      const { data, error } = await supabase
        .from('crm_users')
        .insert([userPayload])
        .select()
        .single();

      if (error || !data) {
        const msg = String(error?.message || '');
        const code = String(error?.code || '');
        if (/23505|duplicate|unique/i.test(`${code} ${msg}`)) {
          setFormError('This work email is already registered on simplecrm.');
        } else {
          setFormError(msg || 'Could not add team member. Please try again.');
        }
        return;
      }

      setUsers((prev) => (prev.some((u) => u.id === data.id) ? prev : [...prev, data]));
      setIsAddModalOpen(false);
      setAddName('');
      setAddEmail('');
      setAddRole('member');
      setAddPerms(DEFAULT_MEMBER_PERMISSIONS);

      // Dynamically sync Razorpay Subscription seat quantity if Autopay is active
      if (activeCompanyId) {
        syncSubscriptionSeats(activeCompanyId);
      }

      // Dispatch automated Welcome & Invite Email via Resend only after persisted
      const inviteRes = await sendUserInviteEmail({
        name: trimmedName,
        email: trimmedEmail,
        tempPassword,
        role: addRole
      });

      // Display invitation confirmation dialog with copy fallback
      setCreatedInviteInfo({
        name: trimmedName,
        email: trimmedEmail,
        tempPassword,
        emailSent: inviteRes.emailSent,
        reason: inviteRes.reason
      });
      setCopiedTempPwd(false);
    } catch (err) {
      setFormError(err?.message || 'Unexpected error while creating team member.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Set / Reset Password (upgrades legacy PIN or updates password)
  const handleSetPassword = async (e) => {
    e.preventDefault();
    setFormError('');

    const val = validatePasswordStrength(newPassword);
    if (!val.isValid) {
      setFormError(val.message);
      return;
    }

    if (!selectedUser) return;

    setIsSubmitting(true);
    const updatedUserId = selectedUser.id;

    try {
      const res = await setUserPassword(updatedUserId, newPassword.trim());
      if (!res.success) {
        setFormError(res.error || 'Failed to update password.');
        setIsSubmitting(false);
        return;
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === updatedUserId
            ? {
                ...u,
                password_hash: res.user.password_hash ?? (res.user.is_secured ? 'secured' : null),
                is_secured: Boolean(res.user.is_secured || res.user.password_hash),
                password_updated_at: res.user.password_updated_at
              }
            : u
        )
      );
      setIsPinModalOpen(false);
      setNewPassword('');
      setShowNewPassword(false);
    } catch (err) {
      console.warn('Error updating password:', err);
      setFormError('Failed to update password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Edit Permissions
  const handleUpdatePermissions = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;

    setFormError('');
    setIsSubmitting(true);
    const updatedUserId = selectedUser.id;
    const updatedPerms = selectedUser.permissions;
    const updatedRole = selectedUser.role;

    try {
      const companyId = activeCompanyId || currentUser?.company_id;
      if (!companyId) throw new Error('No active workspace selected.');

      const { error } = await supabase
        .from('crm_users')
        .update({ permissions: updatedPerms, role: updatedRole })
        .eq('id', updatedUserId)
        .eq('company_id', companyId);

      if (error) {
        setFormError(error.message || 'Could not update user permissions.');
        return;
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === updatedUserId
            ? { ...u, permissions: updatedPerms, role: updatedRole }
            : u
        )
      );

      if (updatedUserId === currentUser?.id && typeof onCurrentUserUpdated === 'function') {
        onCurrentUserUpdated({ permissions: updatedPerms, role: updatedRole });
      }

      setIsEditModalOpen(false);
    } catch (err) {
      console.warn('Error updating permissions:', err);
      setFormError(err?.message || 'Could not update user permissions.');
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
    if (isWorkspaceBillingOwner(user, effectiveCompany)) {
      alert('The workspace owner account cannot be deleted.');
      return;
    }
    setUserToDelete(user);
    setDeleteSecret('');
    setDeleteSecretError('');
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isSubmitting) return;
    setIsDeleteModalOpen(false);
    setUserToDelete(null);
    setDeleteSecret('');
    setDeleteSecretError('');
  };

  // Perform Delete after user confirmation
  const handleConfirmDelete = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!userToDelete) return;
    setDeleteSecretError('');

    // Active logged-in administrator credential check
    const activeAdmin = users.find(
      (u) =>
        (currentUser?.id && u.id === currentUser.id) ||
        (currentUser?.email && u.email?.toLowerCase() === currentUser.email?.toLowerCase())
    ) || currentUser;

    const trimmedSecret = (deleteSecret || '').trim();
    if (!trimmedSecret) {
      setDeleteSecretError('Please enter your password or PIN to confirm deletion.');
      return;
    }

    const adminEmail = currentUser?.email || activeAdmin?.email;
    const authCheck = await verifyUserCredentials(adminEmail, trimmedSecret, { attachSession: false });
    if (!authCheck.success) {
      setDeleteSecretError('Incorrect credentials. Please enter your valid admin password or PIN.');
      return;
    }

    const userId = userToDelete.id;
    const targetUser = userToDelete;

    setIsSubmitting(true);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setIsDeleteModalOpen(false);
    setUserToDelete(null);
    setDeleteSecret('');
    setDeleteSecretError('');

    try {
      if (!activeCompanyId) throw new Error('No active workspace selected.');
      const { error } = await supabase
        .from('crm_users')
        .delete()
        .eq('id', userId)
        .eq('company_id', activeCompanyId);
      if (error) {
        console.warn('Note deleting user in Supabase:', error.message);
      } else {
        // Dynamically sync Razorpay Subscription seat quantity if Autopay is active
        syncSubscriptionSeats(activeCompanyId);
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
            {!isLoading && (
              <span className="billing-seat-pill">
                {users.length} active {users.length === 1 ? 'user' : 'users'}
              </span>
            )}
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
              title="Invite a new team member"
              onClick={() => {
                    setFormError('');
                    setAddRole('member');
                    setAddPerms({
                      ...DEFAULT_MEMBER_PERMISSIONS,
                      analytics: { ...DEFAULT_MEMBER_PERMISSIONS.analytics, include_in_leaderboard: true }
                    });
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
                <ChevronRight size={18} strokeWidth={1.75} className="admin-mobile-chevron" />
              </div>
            ))
          ) : filteredUsers.length > 0 ? (
            filteredUsers.map((user, idx) => {
              const isMasked = !showPins[user.id];
              const p = normalizePermissions(user);
              const userHasBilling = canUserManageBilling(user, effectiveCompany);
              const userIsOwner = isWorkspaceBillingOwner(user, effectiveCompany);
              const canEditRow = callerIsAdmin || user.role !== 'admin';
              const activeModules = [
                p.leads.view && `Leads (${p.leads.scope === 'all' ? 'All' : 'Assigned'})`,
                p.pipeline.view && 'Pipeline',
                p.dashboard.view && `Dashboard (${p.dashboard.scope === 'all' ? 'All' : 'Assigned'})`,
                p.analytics?.view !== false && `Analytics (${p.analytics?.scope === 'all' ? 'All' : 'Assigned'})`,
                (p.admin.manage_users || p.admin.manage_routing || p.admin.manage_meta || p.admin.view_ad_budget) && 'Admin',
                userHasBilling && 'Billing'
              ].filter(Boolean);

              return (
                <div
                  key={user.id}
                  className="admin-user-numbered-item"
                  onClick={() => {
                    haptic.light();
                    setActiveMobileUser(user);
                  }}
                >
                  {/* Col 1: Index Number */}
                  <span className="pipeline-number-index">{idx + 1}</span>

                  {/* Col 2: Member Info (Name & Email) */}
                  <div className="admin-user-details-col">
                    <span className="admin-user-title">{user.name}</span>
                    <span className="admin-user-subtext">{user.email}</span>
                  </div>

                  {/* Col 3: Role Pill */}
                  <div className="admin-col-role">
                    {user.role === 'admin' ? (
                      <span className="admin-role-pill admin">
                        {isUserInSalesLeaderboard(user) ? 'Admin • Rep' : 'Admin'}
                      </span>
                    ) : (
                      <span className="admin-role-pill member">
                        {isUserInSalesLeaderboard(user) ? 'Sales Rep' : 'Member'}
                      </span>
                    )}
                  </div>

                  {/* Col 4: Authentication Security Badge */}
                  <div className="admin-col-pin">
                    {user.password_hash ? (
                      <div
                        className="admin-auth-badge is-secured"
                        title="Secured with password. Click to reset."
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedUser(user);
                          setNewPassword('');
                          setFormError('');
                          setIsPinModalOpen(true);
                        }}
                      >
                        <Lock size={12} strokeWidth={2.2} />
                        <span>Secured</span>
                      </div>
                    ) : (
                      <div
                        className="admin-auth-badge is-legacy"
                        title="Using legacy 4-digit PIN. Click to upgrade to password."
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedUser(user);
                          setNewPassword('');
                          setFormError('');
                          setIsPinModalOpen(true);
                        }}
                      >
                        <Key size={12} strokeWidth={2.2} />
                        <span>PIN: {isMasked ? '••••' : user.pin}</span>
                      </div>
                    )}
                  </div>

                  {/* Col 5: Permissions Badge */}
                  <div className="admin-col-perm">
                    {user.role === 'admin' ? (
                      <span
                        className="admin-perm-pill admin"
                        title={userHasBilling ? 'Full Admin Access + Billing' : 'Admin Access (Billing Restricted)'}
                      >
                        {userHasBilling ? 'Full + Billing' : 'Admin Access'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="admin-perm-pill member"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canEditRow) return;
                          setFormError('');
                          setSelectedUser({
                            ...user,
                            permissions: p
                          });
                          setIsEditModalOpen(true);
                        }}
                        data-tooltip={activeModules.length > 0 ? activeModules.join(' · ') : 'Restricted'}
                      >
                        {userHasBilling ? 'Custom · Billing' : 'Custom Access'}
                      </button>
                    )}
                  </div>

                  {/* Col 6: Actions: Set Password, Edit Permissions, Delete User */}
                  <div className="admin-col-actions">
                    <div className="admin-action-icons-cluster">
                      <button
                        type="button"
                        className="btn-admin-action"
                        data-tooltip={user.password_hash ? 'Reset Password' : 'Set Password'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedUser(user);
                          setNewPassword('');
                          setFormError('');
                          setIsPinModalOpen(true);
                        }}
                        aria-label="Set or Reset Password"
                      >
                        <Key size={15} strokeWidth={1.75} />
                      </button>

                      {canEditRow && (
                        <button
                          type="button"
                          className="btn-admin-action"
                          data-tooltip="Edit Permissions"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormError('');
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
                      )}

                      {users.length > 1 && callerIsAdmin && !userIsOwner && (
                        <button
                          type="button"
                          className="btn-admin-action danger"
                          data-tooltip="Delete User"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePromptDelete(user);
                          }}
                          aria-label="Delete User"
                        >
                          <Trash2 size={15} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Mobile Chevron */}
                  <ChevronRight size={18} strokeWidth={1.75} className="admin-mobile-chevron" />
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
      {isAddModalOpen && createPortal(
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
                    <span>{formError}</span>
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

                {/* Automated Initial Password Note */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px', marginTop: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                    <Sparkles size={14} color="#2563eb" />
                    <span>Automated Secure Onboarding</span>
                  </div>
                  <p style={{ fontSize: '12.5px', color: '#475569', margin: '0 0 6px', lineHeight: 1.5 }}>
                    A human-friendly temporary password based on their name (e.g. <strong>{generateHumanPassword(addName || 'Rahul')}</strong>) will be generated and dispatched to their email address.
                  </p>
                  <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>
                    🔒 <em>The user will be required to choose a new permanent password on their first sign-in.</em>
                  </span>
                </div>

                {/* Role Dropdown */}
                <div className="admin-modal-role-row">
                  <span className="admin-modal-role-label">Role</span>
                  <CustomSelect
                    value={addRole}
                    onChange={(role) => {
                      const prevBilling = Boolean(addPerms?.admin?.manage_billing);
                      setAddRole(role);
                      if (role === 'admin') {
                        setAddPerms({
                          ...DEFAULT_ADMIN_PERMISSIONS,
                          analytics: { ...DEFAULT_ADMIN_PERMISSIONS.analytics, include_in_leaderboard: false },
                          admin: { ...DEFAULT_ADMIN_PERMISSIONS.admin, manage_billing: prevBilling }
                        });
                      } else {
                        setAddPerms({
                          ...DEFAULT_MEMBER_PERMISSIONS,
                          analytics: { ...DEFAULT_MEMBER_PERMISSIONS.analytics, include_in_leaderboard: true },
                          admin: { ...DEFAULT_MEMBER_PERMISSIONS.admin, manage_billing: prevBilling }
                        });
                      }
                    }}
                    options={availableRoleOptions}
                    className="admin-role-select"
                  />
                </div>

                {/* Sales Representative Setting */}
                <div className="admin-modal-toggle-row">
                  <div className="admin-modal-toggle-left">
                    <span className="admin-modal-toggle-title">Sales Representative</span>
                    <span className="admin-modal-toggle-desc">
                      Include in Sales Leaderboard, SLA metrics, and Team Allocation.
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`admin-switch-btn ${(addPerms?.analytics?.include_in_leaderboard ?? (addRole !== 'admin')) ? 'active' : ''}`}
                    onClick={() => {
                      const currentVal = addPerms?.analytics?.include_in_leaderboard ?? (addRole !== 'admin');
                      setAddPerms((prev) => ({
                        ...prev,
                        analytics: {
                          ...(prev?.analytics || {}),
                          include_in_leaderboard: !currentVal
                        }
                      }));
                    }}
                    aria-label="Toggle Sales Representative"
                  >
                    <span className="admin-switch-thumb" />
                  </button>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label className="admin-field-label" style={{ marginBottom: '8px', display: 'block' }}>Permissions</label>
                  <PermissionsEditor
                    permissions={addPerms}
                    onChange={setAddPerms}
                    role={addRole}
                    canGrantBilling={callerCanManageBilling}
                    isBillingOwner={false}
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
                  {isSubmitting ? 'Inviting...' : 'Invite Team Member'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Invitation Sent Confirmation Modal */}
      {createdInviteInfo && createPortal(
        <div className="admin-modal-backdrop" onClick={() => setCreatedInviteInfo(null)}>
          <div
            className="admin-modal-card"
            style={{ maxWidth: '440px' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="admin-modal-header" style={{ paddingBottom: '14px' }}>
              <div className="admin-modal-title-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669' }}>
                  <CheckCircle2 size={20} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="admin-modal-title" style={{ fontSize: '16.5px' }}>Team Member Invited</h2>
                  <span className="admin-modal-subtitle">Account created & credentials generated</span>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setCreatedInviteInfo(null)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="admin-modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 600, display: 'block' }}>Member</span>
                  <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>{createdInviteInfo.name}</strong>
                  <span style={{ fontSize: '12.5px', color: '#475569', display: 'block' }}>{createdInviteInfo.email}</span>
                </div>

                <div>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Temporary Initial Password</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <code style={{ fontSize: '16px', fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dbeafe', letterSpacing: '0.04em' }}>
                      {createdInviteInfo.tempPassword}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(createdInviteInfo.tempPassword);
                          setCopiedTempPwd(true);
                          setTimeout(() => setCopiedTempPwd(false), 2000);
                        } catch {}
                      }}
                      style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#334155' }}
                    >
                      {copiedTempPwd ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      <span>{copiedTempPwd ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {createdInviteInfo.emailSent ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#065f46', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '10px 12px', borderRadius: '6px' }}>
                  <Mail size={15} />
                  <span>Invitation email with sign-in instructions has been sent to <strong>{createdInviteInfo.email}</strong>.</span>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '10px 12px', borderRadius: '6px', lineHeight: 1.4 }}>
                  ⚠️ {createdInviteInfo.reason || 'Email service is not connected. Please provide the temporary password to the team member directly.'}
                </div>
              )}

              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                The user will be required to change their temporary password to their own permanent password on their first sign-in.
              </p>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="btn-minimal-save"
                onClick={() => setCreatedInviteInfo(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 2. Modal: Set or Reset Password */}
      {isPinModalOpen && selectedUser && createPortal(
        <div className="admin-modal-backdrop" onClick={() => setIsPinModalOpen(false)}>
          <div
            className="admin-modal-card admin-modal-pin"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="admin-modal-header">
              <div className="admin-modal-title-group">
                <h2 className="admin-modal-title">
                  {selectedUser.password_hash ? 'Reset Password' : 'Set Password (Upgrade)'}
                </h2>
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

            <form onSubmit={handleSetPassword}>
              <div className="admin-modal-body">
                {formError && (
                  <div className="admin-modal-error-banner">
                    <span>{formError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
                  <label className="admin-field-label">New Password</label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      className="admin-field-input"
                      style={{ paddingRight: '40px' }}
                      placeholder="Enter at least 6 characters"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (formError) setFormError('');
                      }}
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className="admin-pin-toggle-btn"
                      style={{ position: 'absolute', right: '10px' }}
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  <div className="admin-pwd-generator-row">
                    <button
                      type="button"
                      className="admin-pwd-generate-btn"
                      onClick={() => {
                        const gen = generateRandomPassword(12);
                        setNewPassword(gen);
                        setShowNewPassword(true);
                      }}
                    >
                      <Sparkles size={12} />
                      <span>Generate Strong Password</span>
                    </button>
                    <span className="admin-field-helper">Min 6 characters</span>
                  </div>

                  {!selectedUser.password_hash && selectedUser.pin && (
                    <span style={{ fontSize: '12px', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: '6px', marginTop: '6px', lineHeight: 1.4 }}>
                      This member is currently using a legacy 4-digit PIN ({selectedUser.pin}). Setting a password will immediately upgrade their account to password security.
                    </span>
                  )}
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
                  disabled={isSubmitting || !newPassword}
                >
                  {isSubmitting ? 'Saving...' : selectedUser.password_hash ? 'Update Password' : 'Save & Upgrade to Password'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 3. Modal: Edit Permissions */}
      {isEditModalOpen && selectedUser && createPortal(
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
                {formError && (
                  <div className="admin-modal-error-banner" style={{ marginBottom: 12 }}>
                    <span>{formError}</span>
                  </div>
                )}

                {/* Role Dropdown */}
                <div className="admin-modal-role-row">
                  <span className="admin-modal-role-label">Member Role</span>
                  <CustomSelect
                    value={selectedUser.role || 'member'}
                    onChange={(newRole) => {
                      const prevBilling = Boolean(selectedUser.permissions?.admin?.manage_billing);
                      const base = newRole === 'admin' ? DEFAULT_ADMIN_PERMISSIONS : DEFAULT_MEMBER_PERMISSIONS;
                      setSelectedUser({
                        ...selectedUser,
                        role: newRole,
                        permissions: {
                          ...base,
                          analytics: {
                            ...base.analytics,
                            include_in_leaderboard: newRole !== 'admin'
                          },
                          admin: {
                            ...base.admin,
                            manage_billing: prevBilling
                          }
                        }
                      });
                    }}
                    options={availableRoleOptions}
                    className="admin-role-select"
                  />
                </div>

                {/* Sales Representative Setting */}
                <div className="admin-modal-toggle-row">
                  <div className="admin-modal-toggle-left">
                    <span className="admin-modal-toggle-title">Sales Representative</span>
                    <span className="admin-modal-toggle-desc">
                      Include in Sales Leaderboard, SLA metrics, and Team Allocation.
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`admin-switch-btn ${isUserInSalesLeaderboard(selectedUser) ? 'active' : ''}`}
                    onClick={() => {
                      const currentVal = isUserInSalesLeaderboard(selectedUser);
                      const currentPerms = selectedUser.permissions || {};
                      setSelectedUser({
                        ...selectedUser,
                        permissions: {
                          ...currentPerms,
                          analytics: {
                            ...(currentPerms.analytics || {}),
                            include_in_leaderboard: !currentVal
                          }
                        }
                      });
                    }}
                    aria-label="Toggle Sales Representative"
                  >
                    <span className="admin-switch-thumb" />
                  </button>
                </div>

                <PermissionsEditor
                  permissions={selectedUser.permissions}
                  onChange={(updated) =>
                    setSelectedUser({ ...selectedUser, permissions: updated })
                  }
                  role={selectedUser.role || 'member'}
                  canGrantBilling={callerCanManageBilling}
                  isBillingOwner={isWorkspaceBillingOwner(selectedUser, effectiveCompany)}
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
        </div>,
        document.body
      )}

      {/* 4. Modal: Delete User Confirmation */}
      {isDeleteModalOpen && userToDelete && createPortal(
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
                  <label htmlFor="delete-secret-input" className="admin-delete-pin-label">
                    Enter your admin password or PIN to confirm
                  </label>
                  <div className="admin-delete-pin-wrapper">
                    <input
                      id="delete-secret-input"
                      type="password"
                      autoFocus
                      placeholder="Admin password or PIN"
                      value={deleteSecret}
                      onChange={(e) => {
                        setDeleteSecret(e.target.value);
                        if (deleteSecretError) setDeleteSecretError('');
                      }}
                      className={`admin-delete-pin-input ${deleteSecretError ? 'has-error' : ''}`}
                      style={{ width: '220px', fontFamily: 'inherit', letterSpacing: '0.04em', fontSize: '14px' }}
                      disabled={isSubmitting}
                      autoComplete="current-password"
                    />
                  </div>
                  {deleteSecretError ? (
                    <span className="admin-delete-pin-error">{deleteSecretError}</span>
                  ) : (
                    <span className="admin-delete-pin-hint">Enter your admin credentials to authorize permanent deletion</span>
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
                  disabled={isSubmitting || !deleteSecret}
                >
                  {isSubmitting ? 'Deleting...' : 'Delete Member'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 5. Mobile Bottom Sheet: Member Details & Quick Management */}
      {activeMobileUser && (() => {
        const currentUserData = users.find((u) => u.id === activeMobileUser.id) || activeMobileUser;
        const isMasked = !showPins[currentUserData.id];
        const p = normalizePermissions(currentUserData);
        const mobileUserHasBilling = canUserManageBilling(currentUserData, effectiveCompany);
        const mobileUserIsOwner = isWorkspaceBillingOwner(currentUserData, effectiveCompany);
        const canEditMobileRow = callerIsAdmin || currentUserData.role !== 'admin';
        const activeModules = [
          p.leads?.view && `Leads (${p.leads?.scope === 'all' ? 'All' : 'Assigned'})`,
          p.pipeline?.view && 'Pipeline',
          p.dashboard?.view && `Dashboard (${p.dashboard?.scope === 'all' ? 'All' : 'Assigned'})`,
          p.analytics?.view !== false && `Analytics (${p.analytics?.scope === 'all' ? 'All' : 'Assigned'})`,
          (p.admin?.manage_users || p.admin?.manage_routing || p.admin?.manage_meta || p.admin?.view_ad_budget) && 'Admin',
          mobileUserHasBilling && 'Billing'
        ].filter(Boolean);

        return createPortal(
          <div className="admin-mobile-sheet-backdrop" onClick={() => setActiveMobileUser(null)}>
            <div
              className="admin-mobile-sheet-card"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="admin-sheet-handle-bar">
                <div className="admin-sheet-handle" />
              </div>

              <div className="admin-sheet-header">
                <div className="admin-sheet-user-info">
                  <div className="admin-sheet-title-row">
                    <h3 className="admin-sheet-user-name">{currentUserData.name}</h3>
                    <span className={`admin-role-pill ${currentUserData.role || 'member'}`}>
                      {currentUserData.role === 'admin' ? 'Admin' : 'Member'}
                    </span>
                  </div>
                  <p className="admin-sheet-user-email">{currentUserData.email}</p>
                </div>
                <button
                  type="button"
                  className="admin-sheet-close-btn"
                  onClick={() => setActiveMobileUser(null)}
                  aria-label="Close sheet"
                >
                  <X size={18} strokeWidth={2} />
                </button>
              </div>

              <div className="admin-sheet-body">
                {/* Account Security Card */}
                <div className="admin-sheet-tile">
                  <div className="admin-sheet-tile-left">
                    <span className="admin-sheet-tile-label">Account Security</span>
                    {currentUserData.password_hash ? (
                      <div className="admin-auth-badge is-secured" style={{ width: 'fit-content', marginTop: 4 }}>
                        <Lock size={12} strokeWidth={2.2} />
                        <span>Password Protected</span>
                      </div>
                    ) : (
                      <div className="admin-sheet-pin-display">
                        <span className="admin-sheet-pin-value">
                          Legacy PIN: {isMasked ? '••••' : currentUserData.pin}
                        </span>
                        <button
                          type="button"
                          className="admin-pin-toggle-btn"
                          onClick={() => toggleShowPin(currentUserData.id)}
                          aria-label={isMasked ? 'Reveal PIN' : 'Hide PIN'}
                        >
                          {isMasked ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="admin-sheet-tile-btn"
                    onClick={() => {
                      setSelectedUser(currentUserData);
                      setNewPassword('');
                      setFormError('');
                      setIsPinModalOpen(true);
                      setActiveMobileUser(null);
                    }}
                  >
                    <Key size={14} strokeWidth={2} />
                    <span>{currentUserData.password_hash ? 'Reset Password' : 'Set Password'}</span>
                  </button>
                </div>

                {/* Access Level Card */}
                <div className="admin-sheet-tile">
                  <div className="admin-sheet-tile-left">
                    <span className="admin-sheet-tile-label">Access Level</span>
                    <span className="admin-sheet-perm-status">
                      {currentUserData.role === 'admin'
                        ? (mobileUserHasBilling ? 'Full Administrator · Billing' : 'Administrator (Billing Restricted)')
                        : activeModules.length > 0
                        ? activeModules.join(' · ')
                        : 'Restricted Access'}
                    </span>
                  </div>
                  {canEditMobileRow && (
                    <button
                      type="button"
                      className="admin-sheet-tile-btn"
                      onClick={() => {
                        setFormError('');
                        setSelectedUser({
                          ...currentUserData,
                          permissions: p
                        });
                        setIsEditModalOpen(true);
                        setActiveMobileUser(null);
                      }}
                    >
                      <Sliders size={14} strokeWidth={2} />
                      <span>Configure</span>
                    </button>
                  )}
                </div>

                {/* Delete Member Option */}
                {users.length > 1 && callerIsAdmin && !mobileUserIsOwner && (
                  <div className="admin-sheet-danger-section">
                    <button
                      type="button"
                      className="admin-sheet-delete-btn"
                      onClick={() => {
                        const userToDel = currentUserData;
                        setActiveMobileUser(null);
                        handlePromptDelete(userToDel);
                      }}
                    >
                      <Trash2 size={16} strokeWidth={1.8} />
                      <span>Delete Member</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}
