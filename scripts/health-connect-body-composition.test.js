import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BODY_WATER_MASS_RECORD,
  applyHealthConnectBodyDerivations,
  deriveBodyWaterPct,
  deriveFatMassKg,
  parseMassKg,
} from '../src/lib/health-connect-body-composition.js';
import {
  DESIRED_READ_RECORD_TYPES,
  PINNED_PLUGIN_READ_RECORD_TYPES,
  missingPluginReadRecords,
  pluginReadRecordType,
} from '../src/lib/health-connect-permissions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('BodyWaterMass is a desired and plugin-accepted read type', () => {
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('BodyWaterMass'));
  assert.ok(PINNED_PLUGIN_READ_RECORD_TYPES.has('BodyWaterMass'));
  assert.equal(pluginReadRecordType('BodyWaterMass'), BODY_WATER_MASS_RECORD);
  assert.equal(BODY_WATER_MASS_RECORD, 'BodyWaterMass');
});

test('missing permissions request BodyWaterMass without replacing Hydration', () => {
  const pending = missingPluginReadRecords(new Set(['Hydration', 'Steps']));
  assert.ok(pending.includes('BodyWaterMass'));
  assert.ok(!pending.includes('Hydration'));
});

test('manifest declares READ_BODY_WATER_MASS and keeps Hydration separate', () => {
  const manifest = readFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const rationale = readFileSync(join(ROOT, 'android/app/src/main/res/values/health_permissions.xml'), 'utf8');
  assert.ok(manifest.includes('android.permission.health.READ_BODY_WATER_MASS'));
  assert.ok(manifest.includes('android.permission.health.READ_HYDRATION'));
  assert.ok(rationale.includes('android.permission.health.READ_BODY_WATER_MASS'));
  assert.ok(rationale.includes('android.permission.health.READ_HYDRATION'));
});

test('positive BodyWaterMass maps to body_water_kg', () => {
  const kg = parseMassKg({ mass: { inKilograms: 34.2 } });
  assert.equal(kg, 34.2);
});

test('body_water_pct is derived only with valid weight', () => {
  const derived = applyHealthConnectBodyDerivations({
    body_water_kg: 34.2,
    weight_kg: 61.3,
  });
  assert.equal(derived.metrics.body_water_pct, +((34.2 / 61.3) * 100).toFixed(1));
  assert.equal(derived.metadata.body_water_pct.derived, true);
  assert.deepEqual(derived.metadata.body_water_pct.sources, ['BodyWaterMassRecord', 'WeightRecord']);
});

test('no weight means no fabricated body_water_pct', () => {
  const derived = applyHealthConnectBodyDerivations({ body_water_kg: 34.2 });
  assert.equal(derived.metrics.body_water_pct, undefined);
  assert.equal(deriveBodyWaterPct({ bodyWaterKg: 34.2, weightKg: null }), null);
});

test('missing body water does not store zero', () => {
  const derived = applyHealthConnectBodyDerivations({ weight_kg: 61.3 });
  assert.equal(derived.metrics.body_water_kg, undefined);
  assert.equal(derived.metrics.body_water_pct, undefined);
  assert.equal(derived.metrics.body_water_pct === 0, false);
});

test('fat_mass_kg is derived from weight and body fat and marked derived', () => {
  const derived = applyHealthConnectBodyDerivations({
    weight_kg: 61.3,
    body_fat_pct: 18.4,
  });
  assert.equal(derived.metrics.fat_mass_kg, deriveFatMassKg({ weightKg: 61.3, bodyFatPct: 18.4 }));
  assert.equal(derived.metadata.fat_mass_kg.derived, true);
});

test('existing fat_mass_kg is not overwritten', () => {
  const derived = applyHealthConnectBodyDerivations({
    weight_kg: 61.3,
    body_fat_pct: 18.4,
    fat_mass_kg: 12.5,
  });
  assert.equal(derived.metrics.fat_mass_kg, 12.5);
  assert.equal(derived.metadata.fat_mass_kg, undefined);
});

test('lean body mass is never mapped to muscle_mass_kg', () => {
  const derived = applyHealthConnectBodyDerivations({ lean_mass_kg: 50 });
  assert.equal(derived.metrics.muscle_mass_kg, undefined);
  assert.equal(derived.metrics.lean_mass_kg, 50);
});

test('HeartRate and Hydration remain in the desired Health Connect set', () => {
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('HeartRate'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('Hydration'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('Weight'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('BodyFat'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('LeanBodyMass'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('BoneMass'));
  assert.ok(DESIRED_READ_RECORD_TYPES.includes('BasalMetabolicRate'));
});
