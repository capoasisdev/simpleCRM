import { Capacitor, registerPlugin } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// Reference custom native Android plugin
const NativeVibration = registerPlugin('NativeVibration');

const isNative = () => Capacitor.isNativePlatform();

const vibrateNative = async (duration) => {
  if (!isNative()) return;
  try {
    if (NativeVibration && NativeVibration.vibrate) {
      await NativeVibration.vibrate({ duration });
      return;
    }
  } catch (e) {
    console.warn('[Haptics] vibrateNative fallback', e);
  }
};

/**
 * Native phone haptics service.
 * Direct Android Vibrator / VibratorManager hardware access via NativeVibration plugin.
 */
export const haptic = {
  selection: async () => {
    if (!isNative()) return;
    try {
      if (NativeVibration && NativeVibration.vibrate) {
        await NativeVibration.vibrate({ duration: 40 });
        return;
      }
      await Haptics.selectionChanged();
    } catch {}
  },

  light: async () => {
    if (!isNative()) return;
    try {
      if (NativeVibration && NativeVibration.impact) {
        await NativeVibration.impact({ style: 'LIGHT' });
        return;
      }
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {}
  },

  medium: async () => {
    if (!isNative()) return;
    try {
      if (NativeVibration && NativeVibration.impact) {
        await NativeVibration.impact({ style: 'MEDIUM' });
        return;
      }
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {}
  },

  success: async () => {
    if (!isNative()) return;
    try {
      if (NativeVibration && NativeVibration.vibrate) {
        await NativeVibration.vibrate({ duration: 120 });
        return;
      }
      await Haptics.notification({ type: NotificationType.Success });
    } catch {}
  },

  error: async () => {
    if (!isNative()) return;
    try {
      if (NativeVibration && NativeVibration.vibrate) {
        await NativeVibration.vibrate({ duration: 250 });
        return;
      }
      await Haptics.notification({ type: NotificationType.Error });
    } catch {}
  }
};

// Also export standalone helper functions from heptic-plugin.md
export const triggerLight = () => vibrateNative(80);
export const triggerMedium = () => vibrateNative(150);
export const triggerHeavy = () => vibrateNative(300);
export const triggerSuccess = () => vibrateNative(120);
export const triggerError = () => vibrateNative(250);
export const triggerSelection = () => vibrateNative(40);

export default haptic;
