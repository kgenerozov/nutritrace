/**
 * Deterministic Health Connect body-composition mapping for NutriTrace.
 *
 * Health Connect is the source. ScaleBridge is not a NutriTrace source label.
 * HydrationRecord (drunk fluid) is unrelated to BodyWaterMassRecord.
 */

export const BODY_WATER_MASS_RECORD = 'BodyWaterMass';

export function parsePositiveNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseMassKg(record) {
  if (record == null) return null;
  if (typeof record === 'string') {
    const match = record.match(/(?:mass|weight)=(?:Mass)?(?:\[)?(?:inKilograms=)?([\d.]+)/i)
      || record.match(/value=([\d.]+)/);
    return match ? parsePositiveNumber(match[1]) : null;
  }
  const kg = record.mass?.inKilograms
    ?? record.weight?.inKilograms
    ?? record.value
    ?? null;
  if (kg && typeof kg === 'object') {
    return parsePositiveNumber(kg.inKilograms ?? kg.value);
  }
  return parsePositiveNumber(kg);
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
