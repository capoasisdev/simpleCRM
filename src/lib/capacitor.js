import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { processBackButton } from './backButton';

export const initCapacitor = async () => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    // Configure Status Bar to match light chrome header and avoid cutout collisions
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#f3f4f4' });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (err) {
    console.warn('StatusBar initialization skipped:', err);
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
