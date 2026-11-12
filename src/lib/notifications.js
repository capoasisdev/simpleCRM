/**
 * notifications.js - In-app notification center & event bus
 */

import { readTenantCache, writeTenantCache } from './tenant';

const STORAGE_KEY = 'simplecrm_notifications';

export function getStoredNotifications() {
  return readTenantCache(STORAGE_KEY, []);
}

export function saveNotifications(notifications) {
  writeTenantCache(STORAGE_KEY, notifications.slice(0, 50));
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

  // Dispatch custom browser event for real-time drawer list update (never auto-pop drawer overlay)
  window.dispatchEvent(
    new CustomEvent('crm-notification-added', {
      detail: { notification: newNotification, openDrawer: Boolean(item.openDrawer) }
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
