import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BODY_WATER_MASS_RECORD,
  JOULES_PER_KILOCALORIE,
  SECONDS_PER_DAY,
  applyHealthConnectBodyDerivations,
  classifyBodyCompositionParse,
  deriveBodyWaterPct,
  deriveFatMassKg,
  parseBasalMetabolicRateKcalDay,
  parseMassKg,
  parsePercentage,
  parsePositiveNumber,
  wattsToKcalPerDay,
} from '../src/lib/health-connect-body-composition.js';
import {
  DESIRED_READ_RECORD_TYPES,
  PINNED_PLUGIN_READ_RECORD_TYPES,
  missingPluginReadRecords,
  pluginReadRecordType,
} from '../src/lib/health-connect-permissions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const META =
  "Metadata(id='00000000-0000-0000-0000-000000000001', dataOrigin=Package(com.example.app), lastModifiedTime=2026-01-15T12:00:00Z, clientRecordId=null, clientRecordVersion=1, device=null, recordingMethod=3)";

function androidXMassRecord(typeName, kg) {
  return `${typeName}(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, mass=${kg} kilograms, metadata=${META})`;
}

function androidXWeightString(kg) {
  return `WeightRecord(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, weight=${kg} kilograms, metadata=${META})`;
}

function androidXBodyFatString(pct) {
  return `BodyFatRecord(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, percentage=${pct}%, metadata=${META})`;
}

function androidXBmrWattsString(watts) {
  return `BasalMetabolicRateRecord(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, basalMetabolicRate=${watts} Watts, metadata=${META})`;
}

function androidXBmrKcalString(kcal) {
  return `BasalMetabolicRateRecord(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, basalMetabolicRate=${kcal} kcal/day, metadata=${META})`;
}

const WEIGHT_PLUGIN_OBJECT = Object.freeze({
  time: '2026-01-15T12:00:00Z',
  zoneOffset: '+00:00',
  value: 61.0,
  unit: 'kg',
  metadata: { id: 'synthetic-weight' },
});

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

test('A: parseMassKg object mass.inKilograms', () => {
  assert.equal(parseMassKg({ mass: { inKilograms: 34.2 } }), 34.2);
});

test('B: parseMassKg Weight plugin JSON object', () => {
  assert.equal(parseMassKg(WEIGHT_PLUGIN_OBJECT), 61.0);
  assert.equal(parseMassKg(androidXWeightString(61.0)), 61.0);
});

test('C: parseMassKg BoneMass AndroidX toString', () => {
  assert.equal(parseMassKg(androidXMassRecord('BoneMassRecord', 2.5)), 2.5);
});

test('D: parseMassKg LeanBodyMass AndroidX toString', () => {
  assert.equal(parseMassKg(androidXMassRecord('LeanBodyMassRecord', 50.0)), 50.0);
});

test('E: parseMassKg BodyWaterMass AndroidX toString', () => {
  assert.equal(parseMassKg(androidXMassRecord('BodyWaterMassRecord', 34.0)), 34.0);
});

test('F/G/H: malformed or missing mass returns null, never 0', () => {
  const failures = [
    'LeanBodyMassRecord(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, metadata=Metadata(id=abc, clientRecordVersion=1))',
    'not a record',
    '',
    androidXMassRecord('BoneMassRecord', 0.0),
    { mass: { inKilograms: 0 } },
    { value: 0, unit: 'kg' },
    null,
    undefined,
  ];
  for (const record of failures) {
    const parsed = parseMassKg(record);
    assert.equal(parsed, null, `expected null for ${String(record).slice(0, 80)}`);
    assert.notEqual(parsed, 0);
  }
});

test('mass parser does not capture metadata ids or timestamps', () => {
  const parsed = parseMassKg(
    'LeanBodyMassRecord(time=2026-01-15T12:00:00Z, zoneOffset=+00:00, metadata=Metadata(id=12345, clientRecordVersion=9))',
  );
  assert.equal(parsed, null);
});

test('BodyFat percentage object and AndroidX string', () => {
  assert.equal(parsePercentage({ percentage: { value: 18.0 } }), 18.0);
  assert.equal(parsePercentage(androidXBodyFatString(18.0)), 18.0);
  assert.equal(parsePercentage('BodyFatRecord(time=2026-01-15T12:00:00Z, metadata=Metadata(id=1))'), null);
  assert.notEqual(parsePercentage('nope'), 0);
});

test('I/J: pinned BMR Watts string converts to kcal/day', () => {
  const watts = 80.0;
  const expected = watts * SECONDS_PER_DAY / JOULES_PER_KILOCALORIE;
  assert.equal(wattsToKcalPerDay(watts), expected);
  assert.equal(parseBasalMetabolicRateKcalDay(androidXBmrWattsString(watts)), expected);
  assert.equal(Math.round(expected), 1652);
});

test('BMR kcal/day string is used as-is and object kcal path works', () => {
  assert.equal(parseBasalMetabolicRateKcalDay(androidXBmrKcalString(1652.0)), 1652.0);
  assert.equal(parseBasalMetabolicRateKcalDay({
    basalMetabolicRate: { inKilocaloriesPerDay: 1652 },
  }), 1652);
  assert.equal(parseBasalMetabolicRateKcalDay({
    basalMetabolicRate: { inWatts: 80 },
  }), wattsToKcalPerDay(80));
});

test('K/L: malformed BMR returns null, never 0', () => {
  assert.equal(parseBasalMetabolicRateKcalDay('BasalMetabolicRateRecord(time=2026-01-15T12:00:00Z, metadata=Metadata(id=1))'), null);
  assert.equal(parseBasalMetabolicRateKcalDay({ basalMetabolicRate: 80 }), null);
  assert.equal(parseBasalMetabolicRateKcalDay({ value: 80 }), null);
  assert.notEqual(parseBasalMetabolicRateKcalDay('nope'), 0);
});

test('M: valid water + weight → percentage', () => {
  const derived = applyHealthConnectBodyDerivations({
    body_water_kg: 34.0,
    weight_kg: 61.0,
  });
  assert.equal(derived.metrics.body_water_pct, +((34.0 / 61.0) * 100).toFixed(1));
  assert.equal(derived.metadata.body_water_pct.derived, true);
});

test('N: missing water → no percentage', () => {
  const derived = applyHealthConnectBodyDerivations({ weight_kg: 61.0 });
  assert.equal(derived.metrics.body_water_kg, undefined);
  assert.equal(derived.metrics.body_water_pct, undefined);
});

test('O: missing weight → no percentage', () => {
  const derived = applyHealthConnectBodyDerivations({ body_water_kg: 34.0 });
  assert.equal(derived.metrics.body_water_pct, undefined);
  assert.equal(deriveBodyWaterPct({ bodyWaterKg: 34.0, weightKg: null }), null);
});

test('P: valid weight + fat% → fat mass', () => {
  const derived = applyHealthConnectBodyDerivations({
    weight_kg: 61.0,
    body_fat_pct: 18.0,
  });
  assert.equal(derived.metrics.fat_mass_kg, deriveFatMassKg({ weightKg: 61.0, bodyFatPct: 18.0 }));
  assert.equal(derived.metadata.fat_mass_kg.derived, true);
});

test('Q: parse-failure zeros are never fed into derivation', () => {
  const weight = parseMassKg('malformed') ?? undefined;
  const water = parseMassKg('malformed') ?? undefined;
  const fat = parsePercentage('malformed') ?? undefined;
  assert.equal(weight, undefined);
  const derived = applyHealthConnectBodyDerivations({
    weight_kg: weight,
    body_water_kg: water,
    body_fat_pct: fat,
  });
  assert.equal(derived.metrics.fat_mass_kg, undefined);
  assert.equal(derived.metrics.body_water_pct, undefined);
  assert.equal(derived.metrics.body_water_kg, undefined);
});

test('zero placeholders are not valid derivation inputs', () => {
  const derived = applyHealthConnectBodyDerivations({
    weight_kg: 0,
    body_fat_pct: 0,
    body_water_kg: 0,
  });
  assert.equal(derived.metrics.fat_mass_kg, undefined);
  assert.equal(derived.metrics.body_water_pct, undefined);
  assert.equal(parsePositiveNumber(0), null);
});

test('lean body mass is never mapped to muscle_mass_kg', () => {
  const derived = applyHealthConnectBodyDerivations({ lean_mass_kg: 50 });
  assert.equal(derived.metrics.muscle_mass_kg, undefined);
  assert.equal(derived.metrics.lean_mass_kg, 50);
});

test('existing fat_mass_kg is not overwritten', () => {
  const derived = applyHealthConnectBodyDerivations({
    weight_kg: 61.0,
    body_fat_pct: 18.0,
    fat_mass_kg: 12.5,
  });
  assert.equal(derived.metrics.fat_mass_kg, 12.5);
  assert.equal(derived.metadata.fat_mass_kg, undefined);
});

test('classifyBodyCompositionParse distinguishes empty vs parse_error', () => {
  assert.equal(classifyBodyCompositionParse(null, null), 'no_records');
  assert.equal(classifyBodyCompositionParse(androidXMassRecord('LeanBodyMassRecord', 50.0), 50.0), 'available');
  assert.equal(classifyBodyCompositionParse('LeanBodyMassRecord(no mass here)', null), 'parse_error');
});

test('Health Connect JS readers use shared parsers and never fallback to 0', () => {
  const src = readFileSync(join(ROOT, 'src/lib/health-connect.js'), 'utf8');
  assert.match(src, /parseMassKg\(latest\)/);
  assert.match(src, /parsePercentage\(latest\)/);
  assert.match(src, /parseBasalMetabolicRateKcalDay\(latest\)/);
  assert.match(src, /checkBodyCompositionStatus/);
  assert.doesNotMatch(src, /bone_mass_kg = \+\(latest\.mass/);
  assert.doesNotMatch(src, /lean_mass_kg = \+\(latest\.mass/);
  assert.doesNotMatch(src, /basal_metabolic_rate = Math\.round\(latest\.basalMetabolicRate/);
  assert.doesNotMatch(src, /latest\.mass\?\.inKilograms \|\| latest\.value \|\| 0/);
});

test('Diagnostics expose a Body Composition check', () => {
  const help = readFileSync(join(ROOT, 'src/routes/settings/HelpImprove.svelte'), 'utf8');
  assert.match(help, /Health Connect Body Composition Check/);
  assert.match(help, /checkBodyCompositionStatus/);
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
