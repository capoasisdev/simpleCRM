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
    // Configure Status Bar for modern dark theme
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#09090b' });
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
