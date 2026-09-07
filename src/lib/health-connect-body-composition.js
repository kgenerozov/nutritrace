/**
 * Deterministic Health Connect body-composition mapping for NutriTrace.
 *
 * Pinned @devmaxime/capacitor-health-connect 1.1.0 RecordConverter:
 *   WeightRecord → custom JSON { value: kg, unit: "kg" }
 *   most other body types → androidx.health.connect.client.records.*.toString()
 *
 * Pinned androidx.health.connect:connect-client:1.1.0 toString shapes:
 *   Mass: "$value ${type.name.lowercase()}"  e.g. "50.0 kilograms"
 *   Percentage: "$value%"                     e.g. "18.0%"
 *   Power: "$value ${type.title}"             e.g. "80.0 Watts" or "1500.0 kcal/day"
 *   LeanBodyMassRecord / BoneMassRecord / BodyWaterMassRecord:
 *     "... mass=$mass, metadata=..."
 *   WeightRecord: "... weight=$weight, metadata=..."
 *   BodyFatRecord: "... percentage=$percentage, metadata=..."
 *   BasalMetabolicRateRecord: "... basalMetabolicRate=$basalMetabolicRate, metadata=..."
 *
 * Health Connect is the source. ScaleBridge is not a NutriTrace source label.
 * HydrationRecord (drunk fluid) is unrelated to BodyWaterMassRecord.
 * Zero is not a valid body-composition measurement: parse failure → null, never 0.
 */

export const BODY_WATER_MASS_RECORD = 'BodyWaterMass';

/** Thermochemical kilocalorie, matching AndroidX Power kcal/day ↔ watts. */
export const JOULES_PER_KILOCALORIE = 4184;
export const SECONDS_PER_DAY = 86400;

const GRAMS_PER_MASS_UNIT = Object.freeze({
  kilograms: 1000,
  kg: 1000,
  grams: 1,
  g: 1,
  milligrams: 0.001,
  mg: 0.001,
  micrograms: 0.000001,
  ounces: 28.34952,
  pounds: 453.59237,
});

export const BODY_COMPOSITION_DIAGNOSTIC_TYPES = Object.freeze([
  { desired: 'Weight', metric: 'weight_kg', kind: 'mass' },
  { desired: 'BodyFat', metric: 'body_fat_pct', kind: 'percentage' },
  { desired: 'LeanBodyMass', metric: 'lean_mass_kg', kind: 'mass' },
  { desired: 'BoneMass', metric: 'bone_mass_kg', kind: 'mass' },
  { desired: 'BodyWaterMass', metric: 'body_water_kg', kind: 'mass' },
  { desired: 'BasalMetabolicRate', metric: 'basal_metabolic_rate', kind: 'bmr' },
]);

export function parsePositiveNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function wattsToKcalPerDay(watts) {
  const w = parsePositiveNumber(watts);
  if (w == null) return null;
  return w * SECONDS_PER_DAY / JOULES_PER_KILOCALORIE;
}

function massKgFromValueAndUnit(rawValue, rawUnit) {
  const value = parsePositiveNumber(rawValue);
  if (value == null) return null;
  const unit = String(rawUnit || 'kilograms').trim().toLowerCase();
  const gramsPer = GRAMS_PER_MASS_UNIT[unit];
  if (gramsPer == null) return null;
  return parsePositiveNumber((value * gramsPer) / 1000);
}

function textBeforeMetadata(text) {
  const idx = String(text).search(/,\s*metadata=/);
  return idx >= 0 ? String(text).slice(0, idx) : String(text);
}

function parseMassKgFromString(text) {
  const body = textBeforeMetadata(text);
  const match = body.match(
    /(?:^|[(,]\s*)(?:mass|weight)=(-?\d+(?:[.,]\d+)?)(?:[eE][+-]?\d+)?\s+(kilograms|grams|milligrams|micrograms|ounces|pounds)\b/i,
  );
  if (!match) return null;
  return massKgFromValueAndUnit(match[1], match[2]);
}

function parseMassKgFromObject(record) {
  const nested = [record.mass, record.weight];
  for (const node of nested) {
    if (node == null) continue;
    if (typeof node === 'object') {
      const fromKg = parsePositiveNumber(node.inKilograms ?? node.inKg);
      if (fromKg != null) return fromKg;
      const fromUnit = massKgFromValueAndUnit(node.value, node.unit ?? node.type);
      if (fromUnit != null) return fromUnit;
    } else {
      const fromKg = parsePositiveNumber(node);
      if (fromKg != null) return fromKg;
    }
  }
  if (record.value != null && typeof record.value === 'object') {
    const fromKg = parsePositiveNumber(record.value.inKilograms ?? record.value.value);
    if (fromKg != null) return fromKg;
  }
  // Plugin WeightRecord JSON: { value: kg, unit: "kg" }
  return massKgFromValueAndUnit(record.value, record.unit || 'kg');
}

export function parseMassKg(record) {
  if (record == null) return null;
  if (typeof record === 'string') return parseMassKgFromString(record);
  if (typeof record !== 'object') return null;
  return parseMassKgFromObject(record);
}

function parsePercentageFromString(text) {
  const body = textBeforeMetadata(text);
  const match = body.match(/(?:^|[(,]\s*)percentage=(-?\d+(?:[.,]\d+)?)(?:[eE][+-]?\d+)?%/i);
  if (!match) return null;
  const pct = parsePositiveNumber(match[1]);
  if (pct == null || pct > 100) return null;
  return pct;
}

function parsePercentageFromObject(record) {
  const node = record.percentage;
  if (node != null && typeof node === 'object') {
    const pct = parsePositiveNumber(node.value);
    if (pct != null && pct <= 100) return pct;
    return null;
  }
  const pct = parsePositiveNumber(node ?? record.value);
  if (pct == null || pct > 100) return null;
  return pct;
}

export function parsePercentage(record) {
  if (record == null) return null;
  if (typeof record === 'string') return parsePercentageFromString(record);
  if (typeof record !== 'object') return null;
  return parsePercentageFromObject(record);
}

function parseBmrFromString(text) {
  const body = textBeforeMetadata(text);
  const match = body.match(
    /(?:^|[(,]\s*)basalMetabolicRate=(-?\d+(?:[.,]\d+)?)(?:[eE][+-]?\d+)?\s+(Watts|kcal\/day)\b/i,
  );
  if (!match) return null;
  const magnitude = parsePositiveNumber(match[1]);
  if (magnitude == null) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'watts') return parsePositiveNumber(wattsToKcalPerDay(magnitude));
  if (unit === 'kcal/day') return magnitude;
  return null;
}

function parseBmrFromObject(record) {
  const node = record.basalMetabolicRate;
  if (node != null && typeof node === 'object') {
    const kcal = parsePositiveNumber(node.inKilocaloriesPerDay);
    if (kcal != null) return kcal;
    const fromWatts = wattsToKcalPerDay(node.inWatts);
    if (fromWatts != null) return fromWatts;
    return null;
  }
  if (typeof node === 'number') {
    // Bare number has unknown units — do not guess watts vs kcal/day.
    return null;
  }
  if (record.unit && /kcal/i.test(String(record.unit))) {
    return parsePositiveNumber(record.value);
  }
  if (record.unit && /watt/i.test(String(record.unit))) {
    return wattsToKcalPerDay(record.value);
  }
  return null;
}

export function parseBasalMetabolicRateKcalDay(record) {
  if (record == null) return null;
  if (typeof record === 'string') return parseBmrFromString(record);
  if (typeof record !== 'object') return null;
  return parseBmrFromObject(record);
}

export function parserForBodyKind(kind) {
  if (kind === 'percentage') return parsePercentage;
  if (kind === 'bmr') return parseBasalMetabolicRateKcalDay;
  return parseMassKg;
}

export function classifyBodyCompositionParse(record, parsed) {
  if (record == null) return 'no_records';
  if (parsed != null) return 'available';
  return 'parse_error';
}

export function roundBodyMetric(kind, value) {
  const n = parsePositiveNumber(value);
  if (n == null) return null;
  if (kind === 'bmr') return Math.round(n);
  if (kind === 'percentage') return +n.toFixed(1);
  if (kind === 'mass') return n;
  return n;
}

export function deriveBodyWaterPct({ bodyWaterKg, weightKg }) {
  const water = parsePositiveNumber(bodyWaterKg);
  const weight = parsePositiveNumber(weightKg);
  if (water == null || weight == null) return null;
  return +(water / weight * 100).toFixed(1);
}

export function deriveFatMassKg({ weightKg, bodyFatPct }) {
  const weight = parsePositiveNumber(weightKg);
  const fatPct = parsePositiveNumber(bodyFatPct);
  if (weight == null || fatPct == null) return null;
  return +(weight * fatPct / 100).toFixed(2);
}

/**
 * Apply derivations onto a Health Connect metrics object.
 * Never fabricates zeros. Never maps LeanBodyMass → muscle_mass_kg.
 */
export function applyHealthConnectBodyDerivations(metrics = {}) {
  const next = { ...metrics };
  const metadata = {};

  if (parsePositiveNumber(next.body_water_kg) != null) {
    metadata.body_water_kg = {
      derived: false,
      health_connect_record: 'BodyWaterMassRecord',
    };
  }

  const waterPct = deriveBodyWaterPct({
    bodyWaterKg: next.body_water_kg,
    weightKg: next.weight_kg,
  });
  if (waterPct != null) {
    next.body_water_pct = waterPct;
    metadata.body_water_pct = {
      derived: true,
      derivation: 'body_water_kg / weight_kg * 100',
      sources: ['BodyWaterMassRecord', 'WeightRecord'],
    };
  }

  if (parsePositiveNumber(next.fat_mass_kg) == null) {
    const fatMass = deriveFatMassKg({
      weightKg: next.weight_kg,
      bodyFatPct: next.body_fat_pct,
    });
    if (fatMass != null) {
      next.fat_mass_kg = fatMass;
      metadata.fat_mass_kg = {
        derived: true,
        derivation: 'weight_kg * body_fat_pct / 100',
        sources: ['WeightRecord', 'BodyFatRecord'],
      };
    }
  }

  return { metrics: next, metadata };
}
