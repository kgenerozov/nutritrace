/**
 * HeartRate aggregate interpretation for the pinned Health Connect plugin.
 *
 * aggregateRecords(HeartRate) always returns a bucket whose value/min/max
 * default to 0 when Health Connect has no BPM samples. A 0 bpm average is
 * not a real measurement — missing must stay missing.
 */

export function heartRateFromAggregates(aggregates) {
  if (!Array.isArray(aggregates) || aggregates.length === 0) return undefined;
  const bucket = aggregates[0];
  if (!bucket || typeof bucket !== 'object') return undefined;
  const value = Number(bucket.value);
  const min = bucket.min == null ? NaN : Number(bucket.min);
  const max = bucket.max == null ? NaN : Number(bucket.max);
  const hasEvidence =
    (Number.isFinite(value) && value > 0) ||
    (Number.isFinite(min) && min > 0) ||
    (Number.isFinite(max) && max > 0);
  if (!hasEvidence) return undefined;
  return Math.round(value);
}

export function sanitizeHealthConnectError(err) {
  const raw = err?.message ? String(err.message) : String(err || 'unknown error');
  return raw
    .replace(/\b\d{1,3}(?:\.\d+)?\s*bpm\b/gi, '[redacted]')
    .replace(/\b(?:avg|min|max)\s*[:=]\s*\d+(?:\.\d+)?/gi, '[redacted]')
    .slice(0, 200);
}

export function classifyHeartRateRead({ permissionGranted, error, aggregates } = {}) {
  if (!permissionGranted) return 'permission_denied';
  if (error) return 'read_error';
  if (heartRateFromAggregates(aggregates) != null) return 'available';
  return 'no_records';
}

export function localMetricPresence(groupedByDate, dateStr, metricType) {
  const day = groupedByDate?.[dateStr] || groupedByDate?.[Object.keys(groupedByDate || {})[0]] || {};
  const value = day?.[metricType];
  if (value == null) return 'absent';
  if (Number(value) === 0) return 'absent';
  return 'present';
}
