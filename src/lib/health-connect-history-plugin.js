import { registerPlugin } from '@capacitor/core';

const HealthConnectHistory = registerPlugin('HealthConnectHistory', {
  web: {
    getStatus: async () => ({ feature: 'unavailable', permission: 'unavailable', sdk: 0 }),
    requestAccess: async () => ({ granted: false }),
  },
});

export async function getHistoryAccessStatus() {
  const status = await HealthConnectHistory.getStatus();
  return {
    featureAvailable: status.feature === 'available',
    permissionGranted: status.permission === 'granted',
    feature: status.feature,
    permission: status.permission,
    sdk: status.sdk,
  };
}

export async function requestHistoryAccess() {
  return HealthConnectHistory.requestAccess();
}
