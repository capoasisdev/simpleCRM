import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { processBackButton } from './backButton';

export const initCapacitor = async () => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const applyStatusBarTheme = async () => {
    try {
      const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      await StatusBar.setOverlaysWebView({ overlay: false });
      if (isDark) {
        // Device is in Dark Mode: Dark bar with crisp white icons
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#18181b' });
      } else {
        // Device is in Light Mode: Light chrome bar with dark icons
        await StatusBar.setStyle({ style: Style.Light });
        await StatusBar.setBackgroundColor({ color: '#f3f4f4' });
      }
    } catch (err) {
      console.warn('StatusBar theme update error:', err);
    }
  };

  await applyStatusBarTheme();

  // Listen for dynamic changes in OS theme (e.g. auto day/night switch)
  if (typeof window !== 'undefined' && window.matchMedia) {
    const darkMatcher = window.matchMedia('(prefers-color-scheme: dark)');
    if (darkMatcher.addEventListener) {
      darkMatcher.addEventListener('change', applyStatusBarTheme);
    } else if (darkMatcher.addListener) {
      darkMatcher.addListener(applyStatusBarTheme);
    }
  }

  try {
    // Hide splash screen after initialization
    await SplashScreen.hide();
  } catch (err) {
    console.warn('SplashScreen hide skipped:', err);
  }

  try {
    // Handle hardware & gesture back button on Android
    CapApp.addListener('backButton', () => {
      processBackButton();
    });
  } catch (err) {
    console.warn('App backButton listener setup skipped:', err);
  }
};
