On some Android devices and Capacitor environments, the default @capacitor/haptics plugin fails to interact properly with the device's hardware vibration services due to permission handling or API deprecations in newer Android versions.

To fix this, we can implement a custom native Capacitor plugin (NativeVibration) that accesses the Android Vibrator and VibratorManager services directly.

Step-by-Step Implementation Guide
1. Android Manifest Permission
Ensure that your Android application has permission to trigger the vibration motor. Add this permission to your 

AndroidManifest.xml
 (inside the <manifest> tag, alongside other <uses-permission> tags):
<uses-permission android:name="android.permission.VIBRATE" />

2. Native Android Plugin Code
Create a new file named NativeVibrationPlugin.java in your Android project package directory (e.g. android/app/src/main/java/com/yourpackage/app/NativeVibrationPlugin.java):

package com.lateron.app; // Change to match your app package (e.g. com.yourcompany.app)

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeVibration")
public class NativeVibrationPlugin extends Plugin {

    private Vibrator getVibrator() {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm.getDefaultVibrator();
        } else {
            return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        }
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        int duration = call.getInt("duration", 300);
        try {
            Vibrator v = getVibrator();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(duration);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Vibrate failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void impact(PluginCall call) {
        // Light=80ms, Medium=160ms, Heavy=300ms
        String style = call.getString("style", "MEDIUM");
        int duration;
        switch (style) {
            case "LIGHT":  duration = 80;  break;
            case "HEAVY":  duration = 300; break;
            default:       duration = 160; break;
        }
        vibrate(call, duration);
    }

    // Internal helper so impact() can reuse vibrate logic
    private void vibrate(PluginCall call, int duration) {
        try {
            Vibrator v = getVibrator();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(duration);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Vibrate failed: " + e.getMessage());
        }
    }
}

3. Register the Plugin in MainActivity
Open your 

MainActivity.java
 and register the plugin inside onCreate:
package com.lateron.app; // Change to match your app package

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom NativeVibrationPlugin before calling super.onCreate
        registerPlugin(NativeVibrationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

4. Frontend Javascript/Typescript Bridge
Create a helper utility (e.g., 

haptics.js
) to call the custom plugin in your frontend:

import { registerPlugin, Capacitor } from '@capacitor/core';

// Reference the custom native plugin
const NativeVibration = registerPlugin('NativeVibration');

const isNative = () => Capacitor.isNativePlatform();

const vibrate = async (duration) => {
  if (!isNative()) return;
  try {
    await NativeVibration.vibrate({ duration });
  } catch (e) {
    console.warn('[Haptics] vibrate failed', e);
  }
};

// Light tap - navigation, small buttons
export const triggerLight = () => vibrate(80);

// Medium tap - standard button presses
export const triggerMedium = () => vibrate(150);

// Heavy - major actions
export const triggerHeavy = () => vibrate(300);

// Success - double short pulses
export const triggerSuccess = () => vibrate(120);

// Error - longer buzz
export const triggerError = () => vibrate(250);

// Selection - very short tick
export const triggerSelection = () => vibrate(40);

