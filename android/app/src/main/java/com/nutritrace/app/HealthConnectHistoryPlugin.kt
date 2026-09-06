package com.nutritrace.app

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.runBlocking

/**
 * Smallest native bridge for Health Connect historical access.
 * Does not replace @devmaxime/capacitor-health-connect record reads.
 */
@CapacitorPlugin(name = "HealthConnectHistory")
class HealthConnectHistoryPlugin : Plugin() {

    @PluginMethod
    fun getStatus(call: PluginCall) {
        try {
            val ret = JSObject()
            val sdk = HealthConnectClient.getSdkStatus(context)
            if (sdk != HealthConnectClient.SDK_AVAILABLE) {
                ret.put("feature", "unavailable")
                ret.put("permission", "unavailable")
                ret.put("sdk", sdk)
                call.resolve(ret)
                return
            }
            val client = HealthConnectClient.getOrCreate(context)
            val featureStatus = client.features.getFeatureStatus(
                HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY
            )
            val available = featureStatus == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
            val granted = runBlocking {
                client.permissionController.getGrantedPermissions()
            }
            val historyGranted = granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
            ret.put("feature", if (available) "available" else "unavailable")
            ret.put("permission", if (historyGranted) "granted" else "denied")
            ret.put("sdk", sdk)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject(e.message ?: "history status failed")
        }
    }

    @PluginMethod
    fun requestAccess(call: PluginCall) {
        try {
            val client = HealthConnectClient.getOrCreate(context)
            val featureStatus = client.features.getFeatureStatus(
                HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY
            )
            if (featureStatus != HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) {
                call.reject("HISTORY_UNAVAILABLE")
                return
            }
            val contract = PermissionController.createRequestPermissionResultContract()
            val intent = contract.createIntent(
                activity,
                setOf(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
            )
            startActivityForResult(call, intent, "onHistoryResult")
        } catch (e: Exception) {
            call.reject(e.message ?: "history request failed")
        }
    }

    @ActivityCallback
    private fun onHistoryResult(call: PluginCall, result: ActivityResult) {
        val contract = PermissionController.createRequestPermissionResultContract()
        val granted = contract.parseResult(result.resultCode, result.data)
        val ret = JSObject()
        ret.put("granted", granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY))
        call.resolve(ret)
    }
}
