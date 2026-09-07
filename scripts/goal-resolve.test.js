import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  remainingCaloriesForLocalDate,
  resolveGoalForLocalDate,
  weekdayFromLocalDate,
} from '../src/lib/goal-resolve.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WEEKDAY_GOAL = Object.freeze({
  sharedGoal: false,
  days: Object.freeze([2400, 2400, 2700, 2400, 2400, 2400, 2400]),
  max: 2700,
});

const SUNDAY = '2026-09-06';
const TUESDAY = '2026-09-08';
const CONSUMED = 2296;

test('weekdayFromLocalDate uses calendar components, not UTC YYYY-MM-DD parsing', () => {
  assert.equal(weekdayFromLocalDate(SUNDAY), 0);
  assert.equal(weekdayFromLocalDate(TUESDAY), 2);
  assert.equal(weekdayFromLocalDate('2026-03-01'), 0);
  assert.equal(weekdayFromLocalDate('2026-03-03'), 2);
  assert.equal(weekdayFromLocalDate('2026-02-28'), 6);
  assert.equal(weekdayFromLocalDate('not-a-date'), null);
  assert.equal(weekdayFromLocalDate('2026-02-31'), null);
});

test('weekdayFromLocalDate is stable across timezones', () => {
  const script = `
    import { weekdayFromLocalDate } from ${JSON.stringify(join(ROOT, 'src/lib/goal-resolve.js'))};
    console.log(JSON.stringify({
      sun: weekdayFromLocalDate('2026-09-06'),
      tue: weekdayFromLocalDate('2026-09-08'),
      boundarySun: weekdayFromLocalDate('2026-03-01'),
      utcParse: new Date('2026-09-06').getDay(),
    }));
  `;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: tz },
    });
    assert.equal(result.status, 0, result.stderr || `TZ=${tz} failed`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.sun, 0, `Sunday drifted under TZ=${tz}`);
    assert.equal(out.tue, 2, `Tuesday drifted under TZ=${tz}`);
    assert.equal(out.boundarySun, 0, `March 1 drifted under TZ=${tz}`);
  }
});

test('per-weekday Diary remaining uses the selected date, not weekly peak', () => {
  assert.equal(resolveGoalForLocalDate(WEEKDAY_GOAL, SUNDAY), 2400);
  assert.equal(remainingCaloriesForLocalDate(WEEKDAY_GOAL, SUNDAY, CONSUMED), 104);
  assert.equal(resolveGoalForLocalDate(WEEKDAY_GOAL, TUESDAY), 2700);
  assert.equal(remainingCaloriesForLocalDate(WEEKDAY_GOAL, TUESDAY, CONSUMED), 404);
});

test('Sunday → Tuesday → Sunday navigation does not mutate stored goals', () => {
  const goal = {
    sharedGoal: false,
    days: [2400, 2400, 2700, 2400, 2400, 2400, 2400],
    max: 2700,
  };
  const snapshot = JSON.stringify(goal);
  assert.equal(resolveGoalForLocalDate(goal, SUNDAY), 2400);
  assert.equal(resolveGoalForLocalDate(goal, TUESDAY), 2700);
  assert.equal(resolveGoalForLocalDate(goal, SUNDAY), 2400);
  assert.equal(JSON.stringify(goal), snapshot);
});

test('shared calorie target applies on every viewed date', () => {
  const goal = { sharedGoal: true, max: 2400, days: [2400, 2400, 2400, 2400, 2400, 2400, 2400] };
  assert.equal(resolveGoalForLocalDate(goal, SUNDAY), 2400);
  assert.equal(resolveGoalForLocalDate(goal, TUESDAY), 2400);
});

test('legacy shared goals that omit sharedGoal still use max/min', () => {
  const goal = { max: 2400 };
  assert.equal(resolveGoalForLocalDate(goal, TUESDAY), 2400);
});

test('missing per-day value falls back to stored max/min, not Math.max(days)', () => {
  const goal = {
    sharedGoal: false,
    days: [2400, 2400, null, 2400, 2400, 2400, 2400],
    max: 2700,
  };
  assert.equal(resolveGoalForLocalDate(goal, TUESDAY), 2700);
});

test('min-goal shared semantics remain max ?? min', () => {
  const goal = { sharedGoal: true, isMin: true, min: 1800 };
  assert.equal(resolveGoalForLocalDate(goal, SUNDAY), 1800);
});

test('min-goal per-weekday uses that day, then min fallback', () => {
  const goal = {
    sharedGoal: false,
    isMin: true,
    days: [1800, 1800, 2000, 1800, 1800, 1800, 1800],
    min: 2000,
  };
  assert.equal(resolveGoalForLocalDate(goal, SUNDAY), 1800);
  assert.equal(resolveGoalForLocalDate(goal, TUESDAY), 2000);
  const incomplete = {
    sharedGoal: false,
    isMin: true,
    days: [1800, 1800, null, 1800, 1800, 1800, 1800],
    min: 2000,
  };
  assert.equal(resolveGoalForLocalDate(incomplete, TUESDAY), 2000);
});

test('zero and invalid day values follow existing saveGoal validity (value > 0)', () => {
  const goal = {
    sharedGoal: false,
    days: [0, 2400, -50, 2400, 2400, 2400, 2400],
    max: 2700,
  };
  assert.equal(resolveGoalForLocalDate(goal, SUNDAY), 2700);
  assert.equal(resolveGoalForLocalDate(null, SUNDAY), 2000);
  assert.equal(resolveGoalForLocalDate({ sharedGoal: false, days: [], max: 0, min: 0 }, SUNDAY), 2000);
});

test('Diary wires selected-date resolution into the fixed calorie goal', () => {
  const diary = readFileSync(join(ROOT, 'src/routes/Diary.svelte'), 'utf8');
  assert.match(diary, /import \{ resolveGoalForLocalDate \} from '\.\.\/lib\/goal-resolve\.js'/);
  assert.match(diary, /_fixedGoal = resolveGoalForLocalDate\(\$goals\?\.calories, \$currentDate, 2000\)/);
  assert.doesNotMatch(
    diary,
    /\$goals\.calories\.max \|\| \$goals\.calories\.min \|\| 2000/,
  );
  assert.doesNotMatch(
    diary,
    /const calGoal = \$goals\.calories\?\.max \?\? \$goals\.calories\?\.min \?\? 2000/,
  );
});
