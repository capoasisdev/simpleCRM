import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * True native phone haptics service.
 * Uses native OS vibration effects (VibrationEffect.EFFECT_CLICK / EFFECT_TICK on Android,
 * UIImpactFeedbackGenerator / UISelectionFeedbackGenerator on iOS).
 * Never uses raw timed vibrations.
 */
export const haptic = {
  /**
   * Native selection tick - ideal for tabs, subnav items, and segmented controls
   */
  selection: async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Haptics.selectionChanged();
      }
    } catch {
      // Safe no-op on unsupported platforms
    }
  },

  /**
   * Native light impact - ideal for buttons, card clicks, drawer/sheet toggles
   */
  light: async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Haptics.impact({ style: ImpactStyle.Light });
      }
    } catch {
      // Safe no-op
    }
  },

  /**
   * Native medium impact - ideal for confirmations, saves, and main action CTA clicks
   */
  medium: async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Haptics.impact({ style: ImpactStyle.Medium });
      }
    } catch {
      // Safe no-op
    }
  },

  /**
   * Native success notification haptic
   */
  success: async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Haptics.notification({ type: NotificationType.Success });
      }
    } catch {
      // Safe no-op
    }
  },

  /**
   * Native error notification haptic
   */
  error: async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Haptics.notification({ type: NotificationType.Error });
      }
    } catch {
      // Safe no-op
    }
  }
};

export default haptic;
