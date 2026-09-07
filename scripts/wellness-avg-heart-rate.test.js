/**
 * Contract tests for the Wellness Average Heart Rate card.
 *
 * Health Connect can store avg_heart_rate while the Heart tab still hid it
 * because ALL_METRICS had no definition. These tests pin the display path
 * without asserting BPM in product copy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AVG_HEART_RATE_METRIC,
  avgHeartRateCardFromLocalRow,
  formatAvgHeartRate,
} from '../src/lib/wellness-heart-metrics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('avg_heart_rate metric definition is Heart group bpm, distinct from resting_hr', () => {
  assert.equal(AVG_HEART_RATE_METRIC.id, 'avg_heart_rate');
  assert.equal(AVG_HEART_RATE_METRIC.group, 'heart');
  assert.equal(AVG_HEART_RATE_METRIC.unit, 'bpm');
  assert.equal(AVG_HEART_RATE_METRIC.label, 'Average Heart Rate');
  assert.deepEqual([...AVG_HEART_RATE_METRIC.sources], ['fitbit']);
  assert.ok(AVG_HEART_RATE_METRIC.id !== 'resting_hr');
  assert.match(AVG_HEART_RATE_METRIC.desc, /Average heart rate measured across the selected day/);
  assert.doesNotMatch(AVG_HEART_RATE_METRIC.desc, /resting/i);
  assert.doesNotMatch(AVG_HEART_RATE_METRIC.desc, /workout/i);
  assert.doesNotMatch(AVG_HEART_RATE_METRIC.desc, /maximum/i);
});

test('positive local avg_heart_rate renders; missing and zero stay missing', () => {
  const shown = avgHeartRateCardFromLocalRow({ avg_heart_rate: 72 });
  assert.equal(shown.visible, true);
  assert.equal(shown.showsValue, true);
  assert.deepEqual(shown.formatted, { value: '72', unit: 'bpm' });
  assert.equal(shown.restingShowsValue, false);

  const missing = avgHeartRateCardFromLocalRow({});
  assert.equal(missing.showsValue, false);
  assert.equal(missing.formatted, null);
  assert.equal(formatAvgHeartRate(0), null);
  assert.equal(formatAvgHeartRate(null), null);
  assert.equal(formatAvgHeartRate(undefined), null);
});

test('missing resting_hr does not hide avg_heart_rate', () => {
  const card = avgHeartRateCardFromLocalRow({ avg_heart_rate: 64 });
  assert.equal(card.showsValue, true);
  assert.equal(card.restingShowsValue, false);
  assert.equal(card.distinctFromRestingHr, true);
});

test('avg_heart_rate and resting_hr render independently', () => {
  const both = avgHeartRateCardFromLocalRow({ avg_heart_rate: 70, resting_hr: 52 });
  assert.equal(both.showsValue, true);
  assert.equal(both.restingShowsValue, true);

  const onlyResting = avgHeartRateCardFromLocalRow({ resting_hr: 52 });
  assert.equal(onlyResting.showsValue, false);
  assert.equal(onlyResting.restingShowsValue, true);
});

test('Wellness ALL_METRICS includes avg_heart_rate in the Heart group', () => {
  const src = readFileSync(join(ROOT, 'src/routes/Wellness.svelte'), 'utf8');
  assert.match(src, /AVG_HEART_RATE_METRIC/);
  assert.match(src, /\{\s*\.\.\.AVG_HEART_RATE_METRIC,\s*fmt:\s*v\s*=>\s*Math\.round\(v\)\s*\}/);
  assert.match(src, /if \(m\.id === 'avg_heart_rate'\) return formatAvgHeartRate/);
  assert.match(src, /avg_heart_rate:\s+'wl_avg_hr'/);
  const heartEach = src.match(/ALL_METRICS\.filter\(m => m\.group === 'heart'/g) || [];
  assert.ok(heartEach.length >= 1);
});

test('Health Connect fitbit-family source bucket still covers avg_heart_rate', () => {
  const src = readFileSync(join(ROOT, 'src/routes/Wellness.svelte'), 'utf8');
  assert.match(src, /The 'fitbit' bucket covers the whole fitbit family/);
  assert.match(src, /Health Connect/);
  assert.deepEqual([...AVG_HEART_RATE_METRIC.sources], ['fitbit']);
});

test('Statistics maps avg_heart_rate onto the existing fitgarm bpm chart', () => {
  const stats = readFileSync(join(ROOT, 'src/routes/Statistics.svelte'), 'utf8');
  const settingsStats = readFileSync(join(ROOT, 'src/routes/settings/Statistics.svelte'), 'utf8');
  assert.match(stats, /apiField: 'avg_heart_rate'/);
  assert.match(stats, /value: 'wl_avg_hr'/);
  assert.match(stats, /'wl_avg_hr'/);
  assert.match(settingsStats, /key:'wl_avg_hr'/);
});

test('server wellness push accepts metric_type generically including avg_heart_rate', () => {
  const sync = readFileSync(join(ROOT, 'server/routes/sync.js'), 'utf8');
  assert.match(sync, /for \(const w of wellness\)/);
  assert.match(sync, /if \(!w\.date \|\| !w\.source \|\| !w\.metric_type\) continue;/);
  assert.match(sync, /w\.metric_type/);
  assert.doesNotMatch(sync, /metric_type\s*===?\s*'resting_hr'/);
  assert.doesNotMatch(sync, /ALLOWED_.*METRIC/);
});

test('diagnostics distinguish aggregate source from fallback record count', () => {
  const help = readFileSync(join(ROOT, 'src/routes/settings/HelpImprove.svelte'), 'utf8');
  assert.match(help, /HeartRate source:/);
  assert.match(help, /HeartRate fallback records:/);
  assert.doesNotMatch(help, /HeartRate records: \{/);
});
