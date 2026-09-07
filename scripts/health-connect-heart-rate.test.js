import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  classifyHeartRateRead,
  heartRateFromAggregates,
  heartRateFromRecords,
  localMetricPresence,
  sanitizeHealthConnectError,
} from '../src/lib/health-connect-heart-rate.js';
import {
  DESIRED_READ_RECORD_TYPES,
  PINNED_PLUGIN_READ_RECORD_TYPES,
  grantedReadSet,
  missingPluginReadRecords,
  pluginReadRecordType,
  reconcileReadPermissions,
  replaceInvalidPluginRecords,
  supportedDesiredReadRecords,
} from '../src/lib/health-connect-permissions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fakePlugin({ granted = [], afterGranted = null, invalidOn = [] } = {}) {
  let current = { read: [...granted], write: [] };
  const requests = [];
  return {
    requests,
    async getGrantedPermissions() {
      return { read: [...current.read], write: [...current.write] };
    },
    async requestPermissions({ read }) {
      requests.push([...read]);
      const invalid = (read || []).filter((name) => invalidOn.includes(name));
      if (invalid.length) {
        throw new Error(`Invalid records specified: ${invalid.join(', ')}`);
      }
      if (afterGranted) current = { read: [...afterGranted], write: [] };
      else current = { read: [...new Set([...current.read, ...(read || [])])], write: [] };
      return { read: [...(read || [])], write: [] };
    },
  };
}

test('canonical desired list includes HeartRate and RestingHeartRate', () => {
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('HeartRate'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('RestingHeartRate'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('OxygenSaturation'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('Steps'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('SleepSession'));
});

test('A: no permissions granted requests desired supported reads including HeartRate', async () => {
  const plugin = fakePlugin({ granted: [] });
  const result = await reconcileReadPermissions(plugin);
  assert.ok(plugin.requests.length >= 1);
  const requested = plugin.requests[0];
  assert.ok(requested.includes('HeartRateSeries') || requested.includes('HeartRate'));
  assert.ok(requested.includes('RestingHeartRate'));
  assert.ok(requested.includes('OxygenSaturation'));
  assert.ok(requested.includes('Steps'));
  assert.ok(requested.includes('ActivitySession'));
  assert.ok(!requested.includes('ExerciseSession'));
  assert.ok(result.read.includes('HeartRateSeries') || result.read.includes('HeartRate'));
});

test('B: Steps granted and HeartRate missing does not return early', async () => {
  const plugin = fakePlugin({ granted: ['Steps', 'SleepSession', 'OxygenSaturation'] });
  const result = await reconcileReadPermissions(plugin);
  assert.equal(plugin.requests.length, 1);
  const requested = plugin.requests[0];
  assert.ok(requested.includes('HeartRateSeries') || requested.includes('HeartRate'));
  assert.ok(!requested.includes('Steps'));
  assert.ok(result.read.includes('Steps'));
  assert.ok(result.read.includes('HeartRateSeries') || result.read.includes('HeartRate'));
});

test('C: HeartRate already granted is not requested again', async () => {
  const granted = missingPluginReadRecords(new Set()).concat(['HeartRateSeries']);
  const uniqueGranted = [...new Set(granted)];
  const allDesiredGranted = DESIRED_READ_RECORD_TYPES.flatMap((name) => {
    if (name === 'HeartRate') return ['HeartRateSeries'];
    if (name === 'ExerciseSession') return ['ExerciseSession'];
    return [name];
  });
  const plugin = fakePlugin({ granted: allDesiredGranted });
  await reconcileReadPermissions(plugin);
  assert.equal(plugin.requests.length, 0);

  const partial = fakePlugin({ granted: ['Steps', 'HeartRateSeries'] });
  await reconcileReadPermissions(partial);
  assert.ok(partial.requests.length >= 1);
  assert.ok(!partial.requests[0].includes('HeartRate'));
  assert.ok(!partial.requests[0].includes('HeartRateSeries'));
  assert.ok(uniqueGranted.length > 0);
});

test('D: some but not all permissions granted reconciles the missing set', async () => {
  const plugin = fakePlugin({ granted: ['Steps', 'Weight'] });
  await reconcileReadPermissions(plugin);
  const requested = plugin.requests[0];
  assert.ok(requested.includes('SleepSession'));
  assert.ok(requested.includes('HeartRateSeries') || requested.includes('HeartRate'));
  assert.ok(!requested.includes('Steps'));
  assert.ok(!requested.includes('Weight'));
});

test('E: RestingHeartRate missing is requested when supported', () => {
  const missing = missingPluginReadRecords(new Set(['Steps']));
  assert.ok(missing.includes('RestingHeartRate'));
});

test('F: unsupported optional record does not block HeartRate', async () => {
  const desired = [...DESIRED_READ_RECORD_TYPES, 'NotARealRecord'];
  const plugin = fakePlugin({
    granted: ['Steps'],
    invalidOn: ['NotARealRecord'],
  });
  const result = await reconcileReadPermissions(plugin, { desired });
  const requested = plugin.requests[0];
  assert.ok(requested.includes('HeartRateSeries') || requested.includes('HeartRate'));
  assert.ok(!requested.includes('NotARealRecord'));
  assert.ok(result.read.includes('HeartRateSeries') || result.read.includes('HeartRate'));
});

test('F2: plugin invalid HeartRate name falls back to HeartRateSeries', () => {
  assert.deepEqual(
    replaceInvalidPluginRecords(['Steps', 'HeartRate', 'OxygenSaturation'], ['HeartRate']),
    ['Steps', 'HeartRateSeries', 'OxygenSaturation'],
  );
});

test('G: post-dialog state comes from getGrantedPermissions, not the dialog payload', async () => {
  const plugin = fakePlugin({
    granted: ['Steps'],
    afterGranted: ['Steps', 'HeartRateSeries', 'RestingHeartRate'],
  });
  const result = await reconcileReadPermissions(plugin);
  assert.deepEqual(result.read.sort(), ['HeartRateSeries', 'RestingHeartRate', 'Steps'].sort());
  assert.ok(!result.read.includes('Weight'));
});

test('H: HeartRate aggregate success emits avg_heart_rate', () => {
  const metrics = {};
  const avg = heartRateFromAggregates([{ value: 72, min: 54, max: 110, unit: 'bpm' }]);
  if (avg != null) metrics.avg_heart_rate = avg;
  assert.equal(metrics.avg_heart_rate, 72);
});

test('I: HeartRate absent (plugin zero default) does not emit zero', () => {
  const metrics = {};
  const avg = heartRateFromAggregates([{ value: 0, min: 0, max: 0, unit: 'bpm' }]);
  if (avg != null) metrics.avg_heart_rate = avg;
  assert.equal(metrics.avg_heart_rate, undefined);
  assert.equal(heartRateFromAggregates([]), undefined);
  assert.equal(localMetricPresence({ '2026-09-07': { avg_heart_rate: 0 } }, '2026-09-07', 'avg_heart_rate'), 'absent');
});

test('J: HeartRate permission/read failure is sanitized', () => {
  assert.equal(classifyHeartRateRead({ permissionGranted: false }), 'permission_denied');
  assert.equal(classifyHeartRateRead({
    permissionGranted: true,
    error: new Error('SecurityException'),
  }), 'read_error');
  assert.equal(
    sanitizeHealthConnectError(new Error('aggregate failed 84 bpm avg=84')),
    'aggregate failed [redacted] [redacted]',
  );
  assert.equal(classifyHeartRateRead({
    permissionGranted: true,
    aggregates: [{ value: 0, min: 0, max: 0 }],
  }), 'no_records');
});

test('K: Steps / Sleep / SpO2 Health Connect paths remain in the sync reader', () => {
  const src = readFileSync(join(ROOT, 'src/lib/health-connect.js'), 'utf8');
  assert.match(src, /type: 'Steps'/);
  assert.match(src, /type: 'SleepSession'/);
  assert.match(src, /type: 'OxygenSaturation'/);
  assert.match(src, /type: 'HeartRate'/);
  assert.doesNotMatch(src, /type: 'ExerciseSession'/);
  assert.match(src, /pluginReadRecordType\('ExerciseSession'\)/);
  assert.doesNotMatch(src, /if \(existing\.read\?\.length > 0\) return existing/);
  assert.match(src, /reconcileReadPermissions/);
  assert.match(src, /heartRateFromAggregates/);
});

test('weekday calorie goal fix is still wired in Diary', () => {
  const diary = readFileSync(join(ROOT, 'src/routes/Diary.svelte'), 'utf8');
  assert.match(diary, /resolveGoalForLocalDate\(\$goals\?\.calories, \$currentDate, 2000\)/);
});

test('granted HeartRateSeries covers desired HeartRate', () => {
  const granted = grantedReadSet({ read: ['HeartRateSeries', 'Steps'] });
  const missing = missingPluginReadRecords(granted);
  assert.ok(!missing.includes('HeartRate'));
  assert.ok(!missing.includes('HeartRateSeries'));
});

test('unsupported names are filtered from the supported desired list', () => {
  const supported = new Set(['Steps', 'HeartRateSeries']);
  const filtered = supportedDesiredReadRecords(['Steps', 'HeartRate', 'NotARealRecord'], supported);
  assert.deepEqual(filtered, ['Steps', 'HeartRate']);
  assert.ok(PINNED_PLUGIN_READ_RECORD_TYPES.has('HeartRateSeries'));
  assert.ok(PINNED_PLUGIN_READ_RECORD_TYPES.has('OxygenSaturation'));
});

test('ExerciseSession is never sent to the pinned plugin', async () => {
  const plugin = fakePlugin({ granted: [] });
  await reconcileReadPermissions(plugin);
  for (const requested of plugin.requests) {
    assert.ok(!requested.includes('ExerciseSession'), requested.join(','));
    assert.ok(requested.includes('ActivitySession'));
  }
  assert.equal(pluginReadRecordType('ExerciseSession'), 'ActivitySession');
  assert.equal(pluginReadRecordType('HeartRate'), 'HeartRateSeries');
  assert.ok(!PINNED_PLUGIN_READ_RECORD_TYPES.has('ExerciseSession'));
});

test('HeartRate records can supply avg when aggregate is the plugin zero default', () => {
  assert.equal(heartRateFromAggregates([{ value: 0, min: 0, max: 0 }]), undefined);
  const fromString = heartRateFromRecords([
    'HeartRateRecord(samples=[Sample(beatsPerMinute=64), Sample(beatsPerMinute=72)])',
  ]);
  assert.equal(fromString, 68);
  assert.equal(classifyHeartRateRead({
    permissionGranted: true,
    aggregates: [{ value: 0, min: 0, max: 0 }],
    records: ['HeartRateRecord(samples=[Sample(beatsPerMinute=70)])'],
  }), 'available');
});
