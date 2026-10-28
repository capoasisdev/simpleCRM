package com.capoasis.crm;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.autofill.AutofillManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeVibrationPlugin.class);
        super.onCreate(savedInstanceState);

        // Disable Android OS Autofill framework on DecorView.
        // Android Autofill's suggestion overlay steals window focus and repeatedly fires restartInput()
        // on partial credential matches during the first 1-4 keystrokes, causing the keyboard to open/close.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getWindow().getDecorView().setImportantForAutofill(
                View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            );
        }

        // Fix: Android stacks keyboard insets at both parent layout AND WebView levels,
        // collapsing WebView to near-zero height on every keystroke → IME blur/dismiss loop.
        // Zero the parent padding so insets are only applied once (at the WebView level).
        getBridge().getWebView().post(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getBridge().getWebView().setImportantForAutofill(
                    View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
                );
            }
            getBridge().getWebView().getSettings().setSaveFormData(false);
            getBridge().getWebView().clearCache(true);

            View parent = (View) getBridge().getWebView().getParent();
            if (parent != null) {
                ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
                    v.setPadding(0, 0, 0, 0);
                    return insets;
                });
            }
            getBridge().getWebView().requestApplyInsets();
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AutofillManager afm = getSystemService(AutofillManager.class);
            if (afm != null && afm.isEnabled()) {
                afm.cancel();
            }
        }
    }
}
