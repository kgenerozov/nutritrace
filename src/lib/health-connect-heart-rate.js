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

/**
 * Parse BPM samples from plugin readRecords results without logging values.
 * HeartRateRecord is converted via Kotlin toString() in the pinned plugin.
 */
export function heartRateFromRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return undefined;
  const bpms = [];
  for (const record of records) {
    if (typeof record === 'string') {
      for (const match of record.matchAll(/beatsPerMinute\s*=\s*(\d+(?:\.\d+)?)/gi)) {
        const bpm = Number(match[1]);
        if (Number.isFinite(bpm) && bpm > 0) bpms.push(bpm);
      }
      continue;
    }
    const samples = Array.isArray(record?.samples) ? record.samples : [record];
    for (const sample of samples) {
      const bpm = Number(sample?.beatsPerMinute ?? sample?.bpm ?? sample?.value);
      if (Number.isFinite(bpm) && bpm > 0) bpms.push(bpm);
    }
  }
  if (!bpms.length) return undefined;
  return Math.round(bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length);
}

export function sanitizeHealthConnectError(err) {
  const raw = err?.message ? String(err.message) : String(err || 'unknown error');
  return raw
    .replace(/\b\d{1,3}(?:\.\d+)?\s*bpm\b/gi, '[redacted]')
    .replace(/\b(?:avg|min|max)\s*[:=]\s*\d+(?:\.\d+)?/gi, '[redacted]')
    .slice(0, 200);
}

export function classifyHeartRateRead({ permissionGranted, error, aggregates, records } = {}) {
  if (!permissionGranted) return 'permission_denied';
  if (error) return 'read_error';
  if (heartRateFromAggregates(aggregates) != null) return 'available';
  if (heartRateFromRecords(records) != null) return 'available';
  return 'no_records';
}

export function localMetricPresence(groupedByDate, dateStr, metricType) {
  const day = groupedByDate?.[dateStr] || groupedByDate?.[Object.keys(groupedByDate || {})[0]] || {};
  const value = day?.[metricType];
  if (value == null) return 'absent';
  if (Number(value) === 0) return 'absent';
  return 'present';
}
