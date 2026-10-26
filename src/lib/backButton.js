import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { haptic } from './haptics';

// LIFO stack of back handlers (for modals, sheets, drawers, dropdowns)
const backHandlers = [];

/**
 * Register a handler for the hardware/gesture back button.
 * Handlers are evaluated in LIFO (Last In, First Out) order.
 * @param {Function} handler - Function returning boolean (true if handled, false to delegate down)
 * @returns {Function} unregister - Cleanup function to call on unmount/close
 */
export const registerBackHandler = (handler) => {
  backHandlers.push(handler);
  return () => {
    const idx = backHandlers.lastIndexOf(handler);
    if (idx !== -1) {
      backHandlers.splice(idx, 1);
    }
  };
};

/**
 * Global back button processor.
 * 1. Checks if any open modal/sheet/drawer registered a handler.
 * 2. Checks if there is in-app navigation history to step back into.
 * 3. Only minimizes/exits if at root.
 */
export const processBackButton = async () => {
  // 1. Check registered modal/sheet/drawer handlers (LIFO)
  while (backHandlers.length > 0) {
    const handler = backHandlers.pop();
    try {
      const handled = handler();
      if (handled !== false) {
        // Successfully closed a modal/sheet/drawer
        await haptic.light();
        return;
      }
    } catch (e) {
      console.warn('Back button handler error:', e);
    }
  }

  // 2. Check if an in-app listener can step back (e.g. DashboardView tab stack)
  let appHandled = false;
  const backEvent = new CustomEvent('crm-in-app-back', {
    cancelable: true,
    detail: {
      handled: () => {
        appHandled = true;
      }
    }
  });
  window.dispatchEvent(backEvent);

  if (appHandled || backEvent.defaultPrevented) {
    await haptic.light();
    return;
  }

  // 3. Check browser history state
  if (window.history.length > 1 && window.location.pathname !== '/dashboard' && window.location.pathname !== '/') {
    await haptic.light();
    window.history.back();
    return;
  }

  // 4. At root with nothing open: safely minimize the app
  try {
    if (Capacitor.isNativePlatform()) {
      await CapApp.minimizeApp();
    }
  } catch (err) {
    console.warn('Could not minimize app:', err);
  }
};
