/**
 * One-time Health Connect historical import helpers.
 *
 * Daily metrics are queried over exact device-local midnight boundaries and
 * assigned to the requested YYYY-MM-DD. Never use UTC ISO substring dates.
 *
 * This module does not import ExerciseSession as workouts.
 */

export const SOURCE = 'health_connect';
export const HISTORY_WINDOW_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const METRIC_FAMILIES = {
  steps: {
    defaultOn: true,
    metrics: [{ metricType: 'steps', kind: 'aggregate', hcType: 'Steps', zeroValid: true }],
  },
  distance: {
    defaultOn: true,
    metrics: [{
      metricType: 'distance_km', kind: 'aggregate', hcType: 'Distance',
      scale: 0.001, digits: 2, zeroValid: true,
    }],
  },
  heart: {
    defaultOn: true,
    metrics: [{ metricType: 'avg_heart_rate', kind: 'aggregate', hcType: 'HeartRate', round: true, zeroValid: false }],
  },
  resting_hr: {
    defaultOn: true,
    metrics: [{ metricType: 'resting_hr', kind: 'records', hcType: 'RestingHeartRate', parser: 'restingHr', zeroValid: false }],
  },
  sleep: {
    defaultOn: true,
    metrics: [{ metricType: 'sleep_duration_min', kind: 'sleep', hcType: 'SleepSession' }],
  },
  body: {
    defaultOn: true,
    metrics: [
      { metricType: 'weight_kg', kind: 'records', hcType: 'Weight', parser: 'weightKg', zeroValid: false },
      { metricType: 'body_fat_pct', kind: 'records', hcType: 'BodyFat', parser: 'percent', zeroValid: false },
      { metricType: 'lean_mass_kg', kind: 'records', hcType: 'LeanBodyMass', parser: 'massKg', digits: 1, zeroValid: false },
      { metricType: 'bone_mass_kg', kind: 'records', hcType: 'BoneMass', parser: 'massKg', digits: 2, zeroValid: false },
    ],
  },
  spo2: {
    defaultOn: true,
    metrics: [{ metricType: 'spo2_avg', kind: 'records', hcType: 'OxygenSaturation', parser: 'percent', zeroValid: false }],
  },
  bmr: {
    defaultOn: true,
    metrics: [{ metricType: 'basal_metabolic_rate', kind: 'records', hcType: 'BasalMetabolicRate', parser: 'bmr', zeroValid: false }],
  },
  vitals: {
    defaultOn: true,
    metrics: [
      { metricType: 'blood_pressure', kind: 'records', hcType: 'BloodPressure', parser: 'bloodPressure' },
      { metricType: 'respiratory_rate', kind: 'records', hcType: 'RespiratoryRate', parser: 'rate', digits: 1, zeroValid: false },
      { metricType: 'body_temperature', kind: 'records', hcType: 'BodyTemperature', parser: 'celsius', digits: 1, zeroValid: false },
      { metricType: 'vo2_max', kind: 'records', hcType: 'Vo2Max', parser: 'vo2', digits: 1, zeroValid: false },
    ],
  },
  activity_extra: {
    defaultOn: true,
    metrics: [
      { metricType: 'floors', kind: 'aggregate', hcType: 'FloorsClimbed', round: true, zeroValid: true },
      { metricType: 'water_ml', kind: 'aggregate', hcType: 'Hydration', scale: 1000, round: true, zeroValid: true },
    ],
  },
  calories: {
    defaultOn: false,
    observational: true,
    metrics: [
      { metricType: 'calories_out', kind: 'aggregate', hcType: 'TotalCaloriesBurned', round: true, zeroValid: true, observational: true },
      { metricType: 'active_calories', kind: 'aggregate', hcType: 'ActiveCaloriesBurned', round: true, zeroValid: true, observational: true },
    ],
  },
};

export const EXERCISE_FAMILY = 'exercise';

export function defaultFamilySelection() {
  const selected = {};
  for (const [id, family] of Object.entries(METRIC_FAMILIES)) {
    selected[id] = !!family.defaultOn;
  }
  selected[EXERCISE_FAMILY] = false;
  return selected;
}

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return value;
}

export function iterateLocalDates(from, to) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) throw Object.assign(new Error('invalid dates'), { code: 'INVALID_DATE' });
  if (start > end) throw Object.assign(new Error('from > to'), { code: 'FROM_AFTER_TO' });
  const dates = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addLocalCalendarDays(cur, 1);
    if (dates.length > MAX_RANGE_DAYS + 1) break;
  }
  return dates;
}

export function addLocalCalendarDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 0, 0, 0, 0);
  return formatLocalYmd(dt);
}

export function formatLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localDayBounds(dateStr) {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) throw Object.assign(new Error('invalid dates'), { code: 'INVALID_DATE' });
  const [y, m, d] = parsed.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}

export function localCalendarDateFromInstant(instant, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const dt = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

export function utcSubstringDate(iso) {
  return String(iso || '').slice(0, 10);
}

export function countInclusiveDays(from, to) {
  return iterateLocalDates(from, to).length;
}

export function earliestWithoutHistory(today) {
  return addLocalCalendarDays(today, -HISTORY_WINDOW_DAYS);
}

export function validateRange({ from, to, today }) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const todayDate = parseIsoDate(today);
  if (!start || !end || !todayDate) {
    return { ok: false, code: 'INVALID_DATE' };
  }
  if (start > end) return { ok: false, code: 'FROM_AFTER_TO' };
  if (start > todayDate || end > todayDate) return { ok: false, code: 'FUTURE_RANGE' };
  const days = countInclusiveDays(start, end);
  if (days > MAX_RANGE_DAYS) return { ok: false, code: 'RANGE_TOO_LONG', days };
  return { ok: true, from: start, to: end, days };
}

/**
 * History permission is required when any requested local day is older than
 * the default Health Connect 30-day window. Do not silently clip the range.
 */
export function evaluateHistoryAccess({
  featureAvailable,
  permissionGranted,
  from,
  to,
  today,
}) {
  const range = validateRange({ from, to, today });
  if (!range.ok) return { ...range, historyRequired: false };
  const cutoff = earliestWithoutHistory(today);
  const historyRequired = range.from < cutoff;
  if (!historyRequired) {
    return {
      ok: true,
      historyRequired: false,
      feature: featureAvailable ? 'available' : 'unavailable',
      permission: permissionGranted ? 'granted' : 'denied',
      earliestReadable: range.from,
    };
  }
  if (!featureAvailable) {
    return {
      ok: false,
      code: 'HISTORY_UNAVAILABLE',
      historyRequired: true,
      feature: 'unavailable',
      permission: permissionGranted ? 'granted' : 'denied',
      earliestReadable: cutoff,
    };
  }
  if (!permissionGranted) {
    return {
      ok: false,
      code: 'HISTORY_DENIED',
      historyRequired: true,
      feature: 'available',
      permission: 'denied',
      earliestReadable: cutoff,
    };
  }
  return {
    ok: true,
    historyRequired: true,
    feature: 'available',
    permission: 'granted',
    earliestReadable: range.from,
  };
}

export function selectedMetrics(familySelection) {
  const out = [];
  for (const [id, family] of Object.entries(METRIC_FAMILIES)) {
    if (!familySelection?.[id]) continue;
    for (const metric of family.metrics) out.push({ family: id, ...metric, observational: !!family.observational || !!metric.observational });
  }
  return out;
}

export function recordTimestamp(record) {
  if (!record || typeof record !== 'object') return null;
  const raw = record.endTime || record.time || record.startTime || record.timestamp;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function pickLatestRecord(records) {
  const valid = (records || []).filter(r => recordTimestamp(r) != null);
  if (!valid.length) return null;
  valid.sort((a, b) => recordTimestamp(a) - recordTimestamp(b));
  return valid[valid.length - 1];
}

function num(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function parseRecordValue(record, parser) {
  if (record == null) return null;
  if (parser === 'bloodPressure') return parseBloodPressure(record);
  if (typeof record === 'string') return parseStringRecord(record, parser);

  switch (parser) {
    case 'weightKg': {
      let wkg = record.weight?.inKilograms ?? record.mass?.inKilograms ?? record.value;
      if (typeof wkg === 'object') wkg = wkg?.inKilograms ?? wkg?.value;
      return num(wkg);
    }
    case 'massKg': {
      let kg = record.mass?.inKilograms ?? record.value;
      if (typeof kg === 'object') kg = kg?.inKilograms ?? kg?.value;
      return num(kg);
    }
    case 'percent': {
      let pct = record.percentage?.value ?? record.percentage ?? record.value;
      if (typeof pct === 'object') pct = pct?.value;
      return num(pct);
    }
    case 'restingHr':
      return num(record.beatsPerMinute ?? record.value);
    case 'rate':
      return num(record.rate ?? record.value);
    case 'celsius': {
      let c = record.temperature?.inCelsius ?? record.value;
      if (typeof c === 'object') c = c?.inCelsius ?? c?.value;
      return num(c);
    }
    case 'bmr':
      return num(record.basalMetabolicRate?.inKilocaloriesPerDay ?? record.value);
    case 'vo2':
      return num(record.vo2MillilitersPerMinuteKilogram ?? record.value);
    default:
      return num(record.value);
  }
}

function parseStringRecord(text, parser) {
  if (parser === 'weightKg' || parser === 'massKg') {
    const match = text.match(/value=([\d.]+)/);
    return match ? num(match[1]) : null;
  }
  if (parser === 'percent') {
    const match = text.match(/percentage=([\d.]+)%/);
    return match ? num(match[1]) : null;
  }
  if (parser === 'bloodPressure') {
    const sys = text.match(/systolic=([\d.]+)/);
    const dia = text.match(/diastolic=([\d.]+)/);
    if (!sys && !dia) return null;
    return {
      systolic: sys ? Math.round(parseFloat(sys[1])) : null,
      diastolic: dia ? Math.round(parseFloat(dia[1])) : null,
    };
  }
  return null;
}

function parseBloodPressure(record) {
  if (typeof record === 'string') return parseStringRecord(record, 'bloodPressure');
  const systolic = num(record.systolic?.inMillimetersOfMercury ?? record.systolic);
  const diastolic = num(record.diastolic?.inMillimetersOfMercury ?? record.diastolic);
  if (systolic == null && diastolic == null) return null;
  return {
    systolic: systolic == null ? null : Math.round(systolic),
    diastolic: diastolic == null ? null : Math.round(diastolic),
  };
}

export function applyNumericPolicy(value, spec) {
  if (value == null || Number.isNaN(value)) return null;
  let n = value;
  if (spec.scale) n = n * spec.scale;
  if (spec.round) n = Math.round(n);
  else if (spec.digits != null) n = +n.toFixed(spec.digits);
  if (!spec.zeroValid && n <= 0) return null;
  return n;
}

export function extractSleepMetrics(session) {
  if (!session?.startTime || !session?.endTime) return null;
  const startMs = new Date(session.startTime).getTime();
  const endMs = new Date(session.endTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const metrics = {
    sleep_duration_min: Math.round((endMs - startMs) / 60000),
  };
  if (!Array.isArray(session.stages) || session.stages.length === 0) {
    return { metrics, endTime: session.endTime, startTime: session.startTime };
  }
  let deep = 0, rem = 0, light = 0, awake = 0;
  const segs = [...session.stages]
    .map(s => {
      const durMin = s.duration ? Math.round(s.duration / 60000)
        : (s.startTime && s.endTime ? Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000) : 0);
      const t = String(s.stage || '').toLowerCase();
      return { type: t, durMin, startTime: s.startTime || null };
    })
    .sort((a, b) => (a.startTime && b.startTime) ? new Date(a.startTime) - new Date(b.startTime) : 0);
  for (const s of segs) {
    if (s.type === 'deep') deep += s.durMin;
    else if (s.type === 'rem') rem += s.durMin;
    else if (s.type === 'light') light += s.durMin;
    else if (s.type === 'awake') awake += s.durMin;
  }
  if (deep) metrics.sleep_deep_min = deep;
  if (rem) metrics.sleep_rem_min = rem;
  if (light) metrics.sleep_light_min = light;
  if (awake) metrics.sleep_awake_min = awake;
  let ttss = 0;
  for (const s of segs) {
    if (s.type === 'deep' || s.type === 'rem') break;
    ttss += s.durMin;
  }
  if (segs.some(s => s.type === 'deep' || s.type === 'rem')) {
    metrics.sleep_time_to_sound_min = ttss;
  }
  let sound = deep + rem;
  for (const s of segs) {
    if (s.type === 'light' && s.durMin < 5) sound += s.durMin;
  }
  if (sound > 0) metrics.sleep_sound_min = sound;
  let restlessness = 0;
  let interruptions = 0;
  for (const s of segs) {
    if (s.type !== 'awake') continue;
    if (s.durMin < 5) restlessness += s.durMin;
    else interruptions++;
  }
  if (restlessness > 0) metrics.sleep_restlessness_min = restlessness;
  if (segs.some(s => s.type === 'awake')) metrics.sleep_interruptions = interruptions;
  return { metrics, endTime: session.endTime, startTime: session.startTime };
}

export function sleepAssignedDate(session, timeZone) {
  if (!session?.endTime) return null;
  return localCalendarDateFromInstant(session.endTime, timeZone);
}

export function selectSleepForLocalDate(records, dateStr, timeZone) {
  const matching = (records || []).filter(s => sleepAssignedDate(s, timeZone) === dateStr);
  if (!matching.length) return null;
  matching.sort((a, b) => new Date(a.endTime) - new Date(b.endTime));
  return matching[matching.length - 1];
}

export function provenanceMetadata(record, recordType) {
  if (!record || typeof record !== 'object') {
    return recordType ? { record_type: recordType } : {};
  }
  const origin = record.metadata?.dataOrigin
    || record.metadata?.clientAppPackageName
    || record.dataOrigin
    || null;
  const recordedAt = record.endTime || record.time || record.startTime || null;
  const out = {};
  if (origin && typeof origin === 'string' && origin.length < 200) out.origin = origin;
  if (recordedAt && typeof recordedAt === 'string') out.recorded_at = recordedAt;
  if (recordType) out.record_type = recordType;
  return out;
}

export function naturalKey(date, metricType) {
  return `${date}|${SOURCE}|${metricType}`;
}

export function emptyScan(from, to, metrics) {
  const byMetric = {};
  for (const spec of metrics) {
    if (spec.parser === 'bloodPressure') {
      byMetric.blood_pressure_systolic = { dates: [] };
      byMetric.blood_pressure_diastolic = { dates: [] };
    } else if (spec.kind === 'sleep') {
      byMetric.sleep_duration_min = { dates: [] };
    } else {
      byMetric[spec.metricType] = { dates: [] };
    }
  }
  return { from, to, byMetric, rows: [], workoutsWritten: 0 };
}

function addScanDate(scan, metricType, date) {
  if (!scan.byMetric[metricType]) scan.byMetric[metricType] = { dates: [] };
  if (!scan.byMetric[metricType].dates.includes(date)) scan.byMetric[metricType].dates.push(date);
}

export function summarizeScan(scan) {
  const metrics = {};
  for (const [metricType, info] of Object.entries(scan.byMetric)) {
    const dates = [...info.dates].sort();
    metrics[metricType] = {
      dates_with_data: dates.length,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
    };
  }
  return {
    from: scan.from,
    to: scan.to,
    metrics,
    row_count: scan.rows.length,
    workouts_written: scan.workoutsWritten,
  };
}

async function readAggregates(hc, spec, dateStr) {
  const { startIso, endIso } = localDayBounds(dateStr);
  const { aggregates } = await hc.aggregateRecords({
    start: startIso,
    end: endIso,
    type: spec.hcType,
    groupBy: 'day',
  });
  if (!aggregates || aggregates.length === 0) return null;
  const raw = aggregates[0]?.value;
  if (raw == null) return null;
  return applyNumericPolicy(num(raw), spec);
}

async function readPoint(hc, spec, dateStr) {
  const { startIso, endIso } = localDayBounds(dateStr);
  const { records } = await hc.readRecords({
    start: startIso,
    end: endIso,
    type: spec.hcType,
  });
  const latest = pickLatestRecord(records || []);
  if (!latest) return null;
  if (spec.parser === 'bloodPressure') {
    const bp = parseRecordValue(latest, 'bloodPressure');
    if (!bp) return null;
    const rows = [];
    if (bp.systolic != null) {
      rows.push({ metricType: 'blood_pressure_systolic', value: bp.systolic, metadata: provenanceMetadata(latest, spec.hcType) });
    }
    if (bp.diastolic != null) {
      rows.push({ metricType: 'blood_pressure_diastolic', value: bp.diastolic, metadata: provenanceMetadata(latest, spec.hcType) });
    }
    return rows;
  }
  const parsed = parseRecordValue(latest, spec.parser);
  const value = applyNumericPolicy(parsed, spec);
  if (value == null) return null;
  return [{ metricType: spec.metricType, value, metadata: provenanceMetadata(latest, spec.hcType) }];
}

async function readSleep(hc, dateStr, timeZone) {
  const prev = addLocalCalendarDays(dateStr, -1);
  const { startIso } = localDayBounds(prev);
  const { endIso } = localDayBounds(dateStr);
  const { records } = await hc.readRecords({
    start: startIso,
    end: endIso,
    type: 'SleepSession',
  });
  const session = selectSleepForLocalDate(records || [], dateStr, timeZone);
  if (!session) return [];
  const extracted = extractSleepMetrics(session);
  if (!extracted) return [];
  const meta = provenanceMetadata(session, 'SleepSession');
  return Object.entries(extracted.metrics)
    .filter(([, value]) => value != null)
    .map(([metricType, value]) => ({ metricType, value, metadata: meta }));
}

export async function scanRange({
  hc,
  from,
  to,
  today,
  familySelection,
  history,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}) {
  const range = validateRange({ from, to, today });
  if (!range.ok) throw Object.assign(new Error(range.code), range);
  const access = evaluateHistoryAccess({
    featureAvailable: !!history?.featureAvailable,
    permissionGranted: !!history?.permissionGranted,
    from: range.from,
    to: range.to,
    today,
  });
  if (!access.ok) throw Object.assign(new Error(access.code), access);
  const metrics = selectedMetrics(familySelection);
  const scan = emptyScan(range.from, range.to, metrics);
  scan.history = access;
  scan.exercise_family_selected = !!familySelection?.[EXERCISE_FAMILY];
  if (scan.exercise_family_selected) {
    throw Object.assign(new Error('EXERCISE_IMPORT_FORBIDDEN'), { code: 'EXERCISE_IMPORT_FORBIDDEN' });
  }
  const dates = iterateLocalDates(range.from, range.to);
  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];
    if (i > 0 && i % 10 === 0) await Promise.resolve();
    for (const spec of metrics) {
      try {
        if (spec.kind === 'aggregate') {
          const value = await readAggregates(hc, spec, dateStr);
          if (value == null) continue;
          addScanDate(scan, spec.metricType, dateStr);
          scan.rows.push({ date: dateStr, source: SOURCE, metric_type: spec.metricType, value, metadata: { record_type: spec.hcType } });
        } else if (spec.kind === 'records') {
          const rows = await readPoint(hc, spec, dateStr);
          if (!rows) continue;
          for (const row of rows) {
            addScanDate(scan, row.metricType, dateStr);
            scan.rows.push({ date: dateStr, source: SOURCE, metric_type: row.metricType, value: row.value, metadata: row.metadata });
          }
        } else if (spec.kind === 'sleep') {
          const rows = await readSleep(hc, dateStr, timeZone);
          for (const row of rows) {
            addScanDate(scan, row.metricType, dateStr);
            scan.rows.push({ date: dateStr, source: SOURCE, metric_type: row.metricType, value: row.value, metadata: row.metadata });
          }
        }
      } catch {
        // Missing permission/type for one metric is absence, not a fake zero.
      }
    }
  }
  return scan;
}

export async function importScan(scan, upsertWellness) {
  const keys = [];
  for (const row of scan.rows) {
    if (row.source !== SOURCE) continue;
    await upsertWellness(row.date, SOURCE, row.metric_type, row.value, row.metadata || {});
    keys.push(naturalKey(row.date, row.metric_type));
  }
  return {
    written: keys.length,
    unique_keys: new Set(keys).size,
    workouts_written: 0,
  };
}
