package com.nutritrace.app;

import android.content.Context;
import android.util.Log;

import androidx.work.WorkManager;

/**
 * Temporary Health Connect history backfill APK.
 * Workers are disabled: no background HC sync and no reminder timers.
 */
public class WorkerScheduler {
    private static final String TAG = "WorkerScheduler";
    public static final String REMINDER_WORK = "nutritrace_reminders";
    public static final String HC_SYNC_WORK = "nutritrace_hc_sync";

    public static void reschedule(Context context) {
        Log.i(TAG, "backfill APK: workers disabled");
        WorkManager.getInstance(context).cancelUniqueWork(REMINDER_WORK);
        WorkManager.getInstance(context).cancelUniqueWork(HC_SYNC_WORK);
    }
}
