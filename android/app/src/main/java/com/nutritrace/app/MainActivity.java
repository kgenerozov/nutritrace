package com.nutritrace.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthConnectHistoryPlugin.class);
        super.onCreate(savedInstanceState);
        WorkerScheduler.reschedule(getApplicationContext());
    }
}
