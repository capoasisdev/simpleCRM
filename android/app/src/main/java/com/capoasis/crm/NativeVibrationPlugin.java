package com.capoasis.crm;

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
        vibrateInternal(call, duration);
    }

    @PluginMethod
    public void impact(PluginCall call) {
        // Light=80ms, Medium=160ms, Heavy=300ms
        String style = call.getString("style", "MEDIUM");
        int duration;
        switch (style != null ? style.toUpperCase() : "MEDIUM") {
            case "LIGHT":  duration = 80;  break;
            case "HEAVY":  duration = 300; break;
            default:       duration = 160; break;
        }
        vibrateInternal(call, duration);
    }

    // Internal helper so impact() can reuse vibrate logic
    private void vibrateInternal(PluginCall call, int duration) {
        try {
            Vibrator v = getVibrator();
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(duration);
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Vibrate failed: " + e.getMessage());
        }
    }
}
