package com.capoasis.crm;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeVibrationPlugin.class);
        super.onCreate(savedInstanceState);
        applyAutofillSuppression();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyAutofillSuppression();
    }

    private void applyAutofillSuppression() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getWindow().getDecorView().setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }

        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            }
            webView.getSettings().setSaveFormData(false);
        }
    }
}
