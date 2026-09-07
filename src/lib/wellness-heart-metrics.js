/**
 * Daily average heart rate as shown on the Wellness Heart tab.
 *
 * Distinct from resting_hr (RestingHeartRateRecord) and max_hr (Garmin peak).
 * Health Connect stores this as wellness_data.metric_type = avg_heart_rate
 * under source health_connect; the UI `fitbit` source bucket covers that
 * family via $fitbitFamilyEnabled.
 */

export const AVG_HEART_RATE_METRIC = Object.freeze({
  id: 'avg_heart_rate',
  label: 'Average Heart Rate',
  unit: 'bpm',
  group: 'heart',
  icon: 'monitor_heart',
  sources: Object.freeze(['fitbit']),
  desc: 'Average heart rate measured across the selected day.',
});

export function formatAvgHeartRate(rawValue) {
  if (rawValue == null) return null;
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { value: String(Math.round(n)), unit: 'bpm' };
}

export function isWellnessMetricVisible(metricId, wellnessMetrics) {
  return wellnessMetrics == null || (Array.isArray(wellnessMetrics) && wellnessMetrics.includes(metricId));
}

/**
 * Whether a Health Connect / fitbit-family avg_heart_rate row would render
 * a Heart-tab card value. Missing and non-positive values stay missing.
 */
export function avgHeartRateCardFromLocalRow(displayData, {
  wellnessMetrics = null,
  fitbitFamilyEnabled = true,
} = {}) {
  const visible = isWellnessMetricVisible(AVG_HEART_RATE_METRIC.id, wellnessMetrics) && !!fitbitFamilyEnabled;
  const formatted = formatAvgHeartRate(displayData?.[AVG_HEART_RATE_METRIC.id]);
  const restingFormatted = formatAvgHeartRate(displayData?.resting_hr);
  return {
    id: AVG_HEART_RATE_METRIC.id,
    group: AVG_HEART_RATE_METRIC.group,
    unit: AVG_HEART_RATE_METRIC.unit,
    distinctFromRestingHr: AVG_HEART_RATE_METRIC.id !== 'resting_hr',
    visible,
    showsValue: visible && formatted != null,
    formatted,
    restingShowsValue: visible && restingFormatted != null,
  };
}
