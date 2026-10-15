import React from 'react';
import {
  X,
  Bell,
  AlertTriangle,
  Info,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Clock,
  UserCheck
} from 'lucide-react';

export default function NotificationDrawer({
  isOpen,
  onClose,
  notifications = [],
  onClearAll,
  onViewLead
}) {
  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Just now';
    try {
      const diffMs = Date.now() - new Date(timestamp).getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      return `${diffDays}d ago`;
    } catch {
      return 'Recently';
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle size={16} className="notif-icon-warning" />;
      case 'success':
        return <CheckCircle2 size={16} className="notif-icon-success" />;
      case 'error':
        return <AlertTriangle size={16} className="notif-icon-error" />;
      default:
        return <Info size={16} className="notif-icon-info" />;
    }
  };

  return (
    <>
      <div className="notif-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="notif-drawer-panel" role="dialog" aria-label="Notifications Panel">
        {/* Header */}
        <div className="notif-drawer-header">
          <div className="notif-header-title-row">
            <div className="notif-title-group">
              <Bell size={18} strokeWidth={2} />
              <h2>Notifications</h2>
              {unreadCount > 0 && (
                <span className="notif-unread-badge">{unreadCount}</span>
              )}
            </div>
            <button
              type="button"
              className="notif-close-btn"
              onClick={onClose}
              aria-label="Close notifications"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {notifications.length > 0 && (
            <div className="notif-header-actions-row">
              <span className="notif-count-subtitle">{notifications.length} alerts & updates</span>
              <button
                type="button"
                className="notif-clear-all-btn"
                onClick={onClearAll}
                title="Clear all notifications"
              >
                <Trash2 size={13} strokeWidth={1.75} />
                <span>Clear All</span>
              </button>
            </div>
          )}
        </div>

        {/* Content list */}
        <div className="notif-drawer-body">
          {notifications.length === 0 ? (
            <div className="notif-empty-state">
              <div className="notif-empty-icon-wrap">
                <Bell size={28} strokeWidth={1.5} />
              </div>
              <h3>All Caught Up</h3>
              <p>No new notifications, duplicate warnings, or updates right now.</p>
            </div>
          ) : (
            <div className="notif-list">
              {notifications.map((item) => {
                const isWarning = item.type === 'warning';
                return (
                  <div
                    key={item.id}
                    className={`notif-card ${item.type || 'info'} ${!item.read ? 'is-unread' : ''}`}
                  >
                    <div className="notif-card-header">
                      <div className="notif-card-type-icon">
                        {getNotificationIcon(item.type)}
                      </div>
                      <div className="notif-card-header-meta">
                        <span className="notif-card-title">{item.title}</span>
                        <span className="notif-card-time">
                          <Clock size={11} strokeWidth={1.75} />
                          {formatTimeAgo(item.timestamp)}
                        </span>
                      </div>
                    </div>

                    <div className="notif-card-body">
                      <p className="notif-card-message">{item.message}</p>

                      {/* Lead Details preview if present */}
                      {item.lead && (
                        <div className="notif-lead-preview-box">
                          <div className="notif-lead-preview-name">
                            <strong>{item.lead.name || 'Prospect'}</strong>
                            {item.lead.stage && (
                              <span className="notif-lead-preview-stage">
                                {item.lead.stage.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="notif-lead-preview-details">
                            {item.lead.phone && <span>📞 {item.lead.phone}</span>}
                            {item.lead.email && <span>✉️ {item.lead.email}</span>}
                            {(item.lead.assigned_to || item.lead.assignedTo) && (
                              <span>👤 {item.lead.assigned_to || item.lead.assignedTo}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions if linked to a lead */}
                    {item.leadId && onViewLead && (
                      <div className="notif-card-footer">
                        <button
                          type="button"
                          className="notif-view-lead-btn"
                          onClick={() => {
                            onViewLead(item.leadId, item.lead);
                            onClose();
                          }}
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          <span>View Existing Lead</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
