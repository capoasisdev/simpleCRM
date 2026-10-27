package com.capoasis.crm;

import android.os.Bundle;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeVibrationPlugin.class);
        super.onCreate(savedInstanceState);

        // Fix: Android stacks keyboard insets at both parent layout AND WebView levels,
        // collapsing WebView to near-zero height on every keystroke → IME blur/dismiss loop.
        // Zero the parent padding so insets are only applied once (at the WebView level).
        getBridge().getWebView().post(() -> {
            View parent = (View) getBridge().getWebView().getParent();
            ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
                v.setPadding(0, 0, 0, 0);
                return insets;
            });
            getBridge().getWebView().requestApplyInsets();
        });
    }
}
