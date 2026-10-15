/**
 * notifications.js - In-app notification center & event bus
 */

const STORAGE_KEY = 'simplecrm_notifications';

export function getStoredNotifications() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Failed to parse notifications from storage', e);
    return [];
  }
}

export function saveNotifications(notifications) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)));
  } catch (e) {
    console.warn('Failed to save notifications to storage', e);
  }
}

/**
 * Dispatches a notification to the system and saves it in storage.
 * @param {object} item - { id, type: 'warning'|'info'|'success', title, message, lead, leadId, action }
 */
export function addNotification(item) {
  const current = getStoredNotifications();
  const newNotification = {
    id: item.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: item.type || 'info', // 'warning', 'info', 'success', 'error'
    title: item.title || 'Notification',
    message: item.message || '',
    lead: item.lead || null,
    leadId: item.leadId || (item.lead ? item.lead.id : null),
    timestamp: item.timestamp || new Date().toISOString(),
    read: false,
    ...item
  };

  const updated = [newNotification, ...current].slice(0, 50);
  saveNotifications(updated);

  // Dispatch custom browser event for real-time drawer update and auto-opening
  window.dispatchEvent(
    new CustomEvent('crm-notification-added', {
      detail: { notification: newNotification, openDrawer: item.openDrawer !== false }
    })
  );

  return newNotification;
}

export function markAllNotificationsRead() {
  const current = getStoredNotifications();
  const updated = current.map((n) => ({ ...n, read: true }));
  saveNotifications(updated);
  window.dispatchEvent(new CustomEvent('crm-notifications-updated', { detail: updated }));
  return updated;
}

export function clearAllNotifications() {
  saveNotifications([]);
  window.dispatchEvent(new CustomEvent('crm-notifications-updated', { detail: [] }));
  return [];
}
