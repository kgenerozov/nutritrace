import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  HISTORY_WINDOW_DAYS,
  MAX_RANGE_DAYS,
  SOURCE,
  addLocalCalendarDays,
  applyNumericPolicy,
  countInclusiveDays,
  defaultFamilySelection,
  earliestWithoutHistory,
  evaluateHistoryAccess,
  extractSleepMetrics,
  importScan,
  iterateLocalDates,
  localCalendarDateFromInstant,
  localDayBounds,
  naturalKey,
  parseIsoDate,
  pickLatestRecord,
  scanRange,
  selectSleepForLocalDate,
  selectedMetrics,
  summarizeScan,
  utcSubstringDate,
  validateRange,
} from '../src/lib/health-connect-history.js';

test('invalid dates, from>to, future range, local-day iteration', () => {
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('26-09-06'), null);
  assert.equal(validateRange({ from: 'nope', to: '2026-09-01', today: '2026-09-06' }).code, 'INVALID_DATE');
  assert.equal(validateRange({ from: '2026-09-06', to: '2026-09-01', today: '2026-09-06' }).code, 'FROM_AFTER_TO');
  assert.equal(validateRange({ from: '2026-09-01', to: '2026-09-07', today: '2026-09-06' }).code, 'FUTURE_RANGE');
  const ok = validateRange({ from: '2026-09-01', to: '2026-09-06', today: '2026-09-06' });
  assert.equal(ok.ok, true);
  assert.deepEqual(iterateLocalDates('2026-09-01', '2026-09-03'), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(countInclusiveDays('2026-01-01', '2026-01-01'), 1);
  assert.equal(addLocalCalendarDays('2026-12-31', 1), '2027-01-01');
});

test('timezone boundaries use local calendar date, not UTC substring', () => {
  const yek = localCalendarDateFromInstant('2026-09-05T21:00:00.000Z', 'Asia/Yekaterinburg');
  assert.equal(yek, '2026-09-06');
  assert.equal(utcSubstringDate('2026-09-05T21:00:00.000Z'), '2026-09-05');
  assert.notEqual(yek, utcSubstringDate('2026-09-05T21:00:00.000Z'));

  const ny = localCalendarDateFromInstant('2026-09-06T02:00:00.000Z', 'America/New_York');
  assert.equal(ny, '2026-09-05');

  const londonDst = localCalendarDateFromInstant('2026-03-29T00:30:00.000Z', 'Europe/London');
  assert.equal(londonDst, '2026-03-29');

  const bounds = localDayBounds('2026-09-06');
  assert.equal(localCalendarDateFromInstant(bounds.start), '2026-09-06');
  assert.equal(localCalendarDateFromInstant(new Date(bounds.end.getTime() - 1)), '2026-09-06');
  assert.match(bounds.startIso, /Z$/);
  assert.match(bounds.endIso, /Z$/);
});

test('steps/distance aggregates: present, absent, real zero', async () => {
  const hc = {
    async aggregateRecords({ type }) {
      if (type === 'Steps') return { aggregates: [{ value: 0 }] };
      if (type === 'Distance') return { aggregates: [{ value: 1234 }] };
      if (type === 'HeartRate') return { aggregates: [] };
      return { aggregates: [] };
    },
    async readRecords() { return { records: [] }; },
  };
  const scan = await scanRange({
    hc,
    from: '2026-09-06',
    to: '2026-09-06',
    today: '2026-09-06',
    familySelection: { steps: true, distance: true, heart: true },
    history: { featureAvailable: true, permissionGranted: true },
  });
  const types = Object.fromEntries(scan.rows.map(r => [r.metric_type, r.value]));
  assert.equal(types.steps, 0);
  assert.equal(types.distance_km, 1.23);
  assert.equal(types.avg_heart_rate, undefined);
  assert.equal(scan.byMetric.avg_heart_rate?.dates.length || 0, 0);
});

test('point metrics: latest same-day record, other days kept, invalid skipped', async () => {
  const hc = {
    async aggregateRecords() { return { aggregates: [] }; },
    async readRecords({ type, start }) {
      if (type !== 'Weight') return { records: [] };
      if (start === localDayBounds('2026-09-05').startIso) {
        return {
          records: [
            { time: '2026-09-05T07:00:00.000Z', weight: { inKilograms: 80 } },
            { time: '2026-09-05T18:00:00.000Z', weight: { inKilograms: 81.2 } },
            { time: 'not-a-date', weight: { inKilograms: 99 } },
          ],
        };
      }
      return {
        records: [
          { time: '2026-09-06T08:00:00.000Z', weight: { inKilograms: 82 } },
        ],
      };
    },
  };
  const scan = await scanRange({
    hc,
    from: '2026-09-05',
    to: '2026-09-06',
    today: '2026-09-06',
    familySelection: { body: true },
    history: { featureAvailable: true, permissionGranted: true },
  });
  const weights = scan.rows.filter(r => r.metric_type === 'weight_kg');
  assert.equal(weights.length, 2);
  assert.equal(weights.find(r => r.date === '2026-09-05').value, 81.2);
  assert.equal(weights.find(r => r.date === '2026-09-06').value, 82);
  assert.equal(pickLatestRecord([{ time: 'x' }, { time: '2026-01-01T00:00:00Z', value: 1 }]).value, 1);
  assert.equal(applyNumericPolicy(0, { zeroValid: false }), null);
  assert.equal(applyNumericPolicy(-1, { zeroValid: false }), null);
});

test('sleep: midnight-crossing session assigned to wake local date; no fake stages', () => {
  const session = {
    startTime: '2026-09-05T21:30:00+05:00',
    endTime: '2026-09-06T06:00:00+05:00',
  };
  const tz = 'Asia/Yekaterinburg';
  assert.equal(selectSleepForLocalDate([session], '2026-09-06', tz), session);
  assert.equal(selectSleepForLocalDate([session], '2026-09-05', tz), null);
  const extracted = extractSleepMetrics(session);
  assert.equal(extracted.metrics.sleep_duration_min, 510);
  assert.equal(extracted.metrics.sleep_deep_min, undefined);

  const withStages = {
    ...session,
    stages: [
      { stage: 'light', startTime: '2026-09-05T21:30:00+05:00', endTime: '2026-09-05T22:00:00+05:00' },
      { stage: 'deep', startTime: '2026-09-05T22:00:00+05:00', endTime: '2026-09-05T23:00:00+05:00' },
    ],
  };
  const staged = extractSleepMetrics(withStages);
  assert.equal(staged.metrics.sleep_light_min, 30);
  assert.equal(staged.metrics.sleep_deep_min, 60);
  assert.equal(staged.metrics.sleep_rem_min, undefined);
});

test('sleep scan uses wake date and latest session', async () => {
  const hc = {
    async aggregateRecords() { return { aggregates: [] }; },
    async readRecords() {
      return {
        records: [
          { startTime: '2026-09-05T20:00:00+05:00', endTime: '2026-09-06T05:00:00+05:00' },
          { startTime: '2026-09-05T23:00:00+05:00', endTime: '2026-09-06T07:00:00+05:00' },
        ],
      };
    },
  };
  const scan = await scanRange({
    hc,
    from: '2026-09-06',
    to: '2026-09-06',
    today: '2026-09-06',
    familySelection: { sleep: true },
    history: { featureAvailable: true, permissionGranted: true },
    timeZone: 'Asia/Yekaterinburg',
  });
  const sleep = scan.rows.find(r => r.metric_type === 'sleep_duration_min');
  assert.equal(sleep.date, '2026-09-06');
  assert.equal(sleep.value, 480);
});

test('metric filtering: only selected families; exercise import forbidden', async () => {
  const hc = {
    async aggregateRecords({ type }) {
      return { aggregates: [{ value: type === 'Steps' ? 10 : 99 }] };
    },
    async readRecords() { return { records: [] }; },
  };
  const scan = await scanRange({
    hc,
    from: '2026-09-06',
    to: '2026-09-06',
    today: '2026-09-06',
    familySelection: { steps: true, calories: false },
    history: { featureAvailable: true, permissionGranted: true },
  });
  assert.deepEqual(scan.rows.map(r => r.metric_type), ['steps']);
  await assert.rejects(
    () => scanRange({
      hc,
      from: '2026-09-06',
      to: '2026-09-06',
      today: '2026-09-06',
      familySelection: { steps: true, exercise: true },
      history: { featureAvailable: true, permissionGranted: true },
    }),
    /EXERCISE_IMPORT_FORBIDDEN/,
  );
  const defaults = defaultFamilySelection();
  assert.equal(defaults.calories, false);
  assert.equal(defaults.exercise, false);
  assert.ok(selectedMetrics(defaults).every(m => m.hcType !== 'ExerciseSession'));
});

test('idempotency: same range twice updates one natural key each', async () => {
  const hc = {
    async aggregateRecords() { return { aggregates: [{ value: 12 }] }; },
    async readRecords() { return { records: [] }; },
  };
  const opts = {
    hc,
    from: '2026-09-06',
    to: '2026-09-06',
    today: '2026-09-06',
    familySelection: { steps: true },
    history: { featureAvailable: true, permissionGranted: true },
  };
  const store = new Map();
  async function upsert(date, source, metric_type, value, metadata) {
    store.set(naturalKey(date, metric_type), { date, source, metric_type, value, metadata, sync_status: 'pending' });
  }
  const first = await scanRange(opts);
  await importScan(first, upsert);
  hc.aggregateRecords = async () => ({ aggregates: [{ value: 40 }] });
  const second = await scanRange(opts);
  const result = await importScan(second, upsert);
  assert.equal(store.size, 1);
  assert.equal(store.get(naturalKey('2026-09-06', 'steps')).value, 40);
  assert.equal(store.get(naturalKey('2026-09-06', 'steps')).source, SOURCE);
  assert.equal(result.unique_keys, 1);
  assert.equal(result.workouts_written, 0);
});

test('history permission: granted, denied, unavailable, old-range fails explicitly', () => {
  const today = '2026-09-06';
  const recent = addLocalCalendarDays(today, -7);
  const old = addLocalCalendarDays(today, -(HISTORY_WINDOW_DAYS + 1));
  assert.equal(earliestWithoutHistory(today), addLocalCalendarDays(today, -HISTORY_WINDOW_DAYS));

  const granted = evaluateHistoryAccess({
    featureAvailable: true, permissionGranted: true, from: old, to: today, today,
  });
  assert.equal(granted.ok, true);
  assert.equal(granted.historyRequired, true);

  const denied = evaluateHistoryAccess({
    featureAvailable: true, permissionGranted: false, from: old, to: today, today,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'HISTORY_DENIED');

  const unavailable = evaluateHistoryAccess({
    featureAvailable: false, permissionGranted: false, from: old, to: today, today,
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'HISTORY_UNAVAILABLE');

  const recentOk = evaluateHistoryAccess({
    featureAvailable: false, permissionGranted: false, from: recent, to: today, today,
  });
  assert.equal(recentOk.ok, true);
  assert.equal(recentOk.historyRequired, false);
});

test('scan refuses old range instead of silently clipping', async () => {
  const today = '2026-09-06';
  const old = addLocalCalendarDays(today, -(HISTORY_WINDOW_DAYS + 5));
  const hc = {
    async aggregateRecords() { return { aggregates: [{ value: 1 }] }; },
    async readRecords() { return { records: [] }; },
  };
  await assert.rejects(
    () => scanRange({
      hc,
      from: old,
      to: today,
      today,
      familySelection: { steps: true },
      history: { featureAvailable: false, permissionGranted: false },
    }),
    /HISTORY_UNAVAILABLE/,
  );
});

test('range too long is rejected', () => {
  const today = '2026-09-06';
  const from = addLocalCalendarDays(today, -(MAX_RANGE_DAYS + 2));
  assert.equal(validateRange({ from, to: today, today }).code, 'RANGE_TOO_LONG');
});

test('backfill APK identity, history permission, workers disabled, no workout import', () => {
  const historyJs = readFileSync('src/lib/health-connect-history.js', 'utf8');
  assert.doesNotMatch(historyJs, /dbUpsertWorkoutLocal/);
  assert.doesNotMatch(historyJs, /readExerciseSessions/);
  assert.match(historyJs, /ExerciseSession/);

  const flag = readFileSync('src/lib/backfill-flag.js', 'utf8');
  assert.match(flag, /BACKFILL_UTILITY = true/);

  const hcSync = readFileSync('src/lib/health-connect.js', 'utf8');
  assert.match(hcSync, /BACKFILL_UTILITY/);
  assert.match(hcSync, /do not import ExerciseSession as workouts/);

  const worker = readFileSync('android/app/src/main/java/com/nutritrace/app/WorkerScheduler.java', 'utf8');
  assert.match(worker, /backfill APK: workers disabled/);
  assert.doesNotMatch(worker, /enqueueHcWorker\(/);
  assert.doesNotMatch(worker, /enqueueReminderWorker\(/);

  const gradle = readFileSync('android/app/build.gradle', 'utf8');
  assert.match(gradle, /applicationId "com.nutritrace.app.backfill"/);

  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android.permission.health.READ_HEALTH_DATA_HISTORY/);

  const plugin = readFileSync('android/app/src/main/java/com/nutritrace/app/HealthConnectHistoryPlugin.kt', 'utf8');
  assert.match(plugin, /FEATURE_READ_HEALTH_DATA_HISTORY/);
  assert.match(plugin, /PERMISSION_READ_HEALTH_DATA_HISTORY/);
  assert.match(plugin, /FEATURE_STATUS_AVAILABLE/);
});

test('sanitize summary has counts not a values dump contract', async () => {
  const hc = {
    async aggregateRecords() { return { aggregates: [{ value: 9 }] }; },
    async readRecords() { return { records: [] }; },
  };
  const scan = await scanRange({
    hc,
    from: '2026-09-06',
    to: '2026-09-06',
    today: '2026-09-06',
    familySelection: { steps: true },
    history: { featureAvailable: true, permissionGranted: true },
  });
  const summary = summarizeScan(scan);
  assert.equal(summary.metrics.steps.dates_with_data, 1);
  assert.equal(summary.metrics.steps.earliest, '2026-09-06');
  assert.equal(summary.workouts_written, 0);
  assert.equal(summary.row_count, 1);
});
