/**
 * Health Connect permission reconciliation for the pinned
 * @devmaxime/capacitor-health-connect 1.1.0 plugin.
 *
 * The plugin rejects the entire requestPermissions() call if any supplied
 * record name is missing from androidx RECORDS_TYPE_NAME_MAP. That map uses
 * legacy aliases for some types:
 *   HeartRate  → HeartRateSeries
 *   ExerciseSession → ActivitySession (ExerciseSession is invalid on the
 *   pinned plugin and rejects the whole permission request)
 */

export const DESIRED_READ_RECORD_TYPES = Object.freeze([
  'Steps',
  'Weight',
  'SleepSession',
  'HeartRate',
  'RestingHeartRate',
  'ExerciseSession',
  'BloodPressure',
  'OxygenSaturation',
  'BodyFat',
  'RespiratoryRate',
  'FloorsClimbed',
  'Hydration',
  'BoneMass',
  'LeanBodyMass',
  'BodyTemperature',
  'BasalMetabolicRate',
  'Vo2Max',
  'BodyWaterMass',
]);

/**
 * Names the pinned plugin / androidx map is known to accept.
 * Live v1.2.0 device logs: `ExerciseSession` is Invalid/Unexpected;
 * `ActivitySession` is the map key for ExerciseSessionRecord.
 * HeartRate permission/readRecords key is `HeartRateSeries`; aggregate
 * still uses the plugin switch name `HeartRate`.
 */
export const PINNED_PLUGIN_READ_RECORD_TYPES = Object.freeze(new Set([
  ...DESIRED_READ_RECORD_TYPES.filter((name) => name !== 'ExerciseSession'),
  'HeartRateSeries',
  'ActivitySession',
]));

/**
 * Permission-dialog names for a NutriTrace desired type.
 * First entry is the name we send to the plugin.
 */
export const PERMISSION_RECORD_ALIASES = Object.freeze({
  HeartRate: Object.freeze(['HeartRateSeries', 'HeartRate']),
  ExerciseSession: Object.freeze(['ActivitySession', 'ExerciseSession']),
});

export const RECORD_TYPE_FALLBACKS = Object.freeze({
  HeartRate: 'HeartRateSeries',
  HeartRateSeries: 'HeartRate',
  ExerciseSession: 'ActivitySession',
  ActivitySession: 'ExerciseSession',
});

export function grantedReadSet(existing) {
  const read = existing?.read;
  return new Set(Array.isArray(read) ? read.filter(Boolean) : []);
}

export function aliasesForRecord(name) {
  return PERMISSION_RECORD_ALIASES[name] || [name];
}

/** Record type string for plugin readRecords(). */
export function pluginReadRecordType(desiredName) {
  if (desiredName === 'ExerciseSession') return 'ActivitySession';
  if (desiredName === 'HeartRate') return 'HeartRateSeries';
  return desiredName;
}

export function grantedCoversDesired(desiredName, grantedSet) {
  return aliasesForRecord(desiredName).some((alias) => grantedSet.has(alias));
}

export function supportedDesiredReadRecords(
  desired = DESIRED_READ_RECORD_TYPES,
  supported = PINNED_PLUGIN_READ_RECORD_TYPES,
) {
  return desired.filter((name) => aliasesForRecord(name).some((alias) => supported.has(alias)));
}

/**
 * Plugin record names to request for still-missing desired types.
 * Already-granted aliases are skipped. Unsupported names are omitted.
 */
export function missingPluginReadRecords(
  grantedSet,
  desired = DESIRED_READ_RECORD_TYPES,
  supported = PINNED_PLUGIN_READ_RECORD_TYPES,
) {
  const pending = [];
  const seen = new Set();
  for (const name of desired) {
    if (grantedCoversDesired(name, grantedSet)) continue;
    const aliases = aliasesForRecord(name).filter((alias) => supported.has(alias));
    const pick = aliases[0];
    if (!pick || seen.has(pick)) continue;
    seen.add(pick);
    pending.push(pick);
  }
  return pending;
}

export function extractInvalidRecordsFromError(message) {
  const match = String(message || '').match(/Invalid records specified:\s*(.*)$/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * After the plugin rejects a list that contained invalid names, drop those
 * names and substitute a known alias when one exists so HeartRate is not lost.
 */
export function replaceInvalidPluginRecords(pending, invalidNames) {
  const invalid = new Set(invalidNames || []);
  const next = [];
  const seen = new Set();
  for (const name of pending) {
    if (!invalid.has(name)) {
      if (!seen.has(name)) {
        seen.add(name);
        next.push(name);
      }
      continue;
    }
    const fallback = RECORD_TYPE_FALLBACKS[name];
    if (fallback && !invalid.has(fallback) && !seen.has(fallback)) {
      seen.add(fallback);
      next.push(fallback);
    }
  }
  return next;
}

export async function reconcileReadPermissions(plugin, options = {}) {
  const desired = options.desired || DESIRED_READ_RECORD_TYPES;
  const supported = options.supported || PINNED_PLUGIN_READ_RECORD_TYPES;
  const empty = { read: [], write: [] };

  if (!plugin?.getGrantedPermissions) return empty;

  const existing = await plugin.getGrantedPermissions().catch(() => empty);
  const granted = grantedReadSet(existing);
  let pending = missingPluginReadRecords(granted, desired, supported);

  if (pending.length === 0) {
    return {
      read: [...granted],
      write: existing.write || [],
      requested: [],
    };
  }

  if (typeof plugin.requestPermissions !== 'function') {
    const after = await plugin.getGrantedPermissions().catch(() => existing);
    return { read: after.read || [], write: after.write || [], requested: pending };
  }

  const requested = [...pending];
  while (pending.length > 0) {
    try {
      await plugin.requestPermissions({ read: pending, write: [] });
      break;
    } catch (err) {
      const invalid = extractInvalidRecordsFromError(err?.message);
      if (invalid.length === 0) {
        console.warn('[health-connect] Permission dialog failed:', err?.message || err);
        break;
      }
      console.warn('[health-connect] Dropping unsupported Health Connect record types:', invalid.join(', '));
      const next = replaceInvalidPluginRecords(pending, invalid);
      if (next.length === pending.length && next.every((name, i) => name === pending[i])) {
        break;
      }
      pending = next;
    }
  }

  const after = await plugin.getGrantedPermissions().catch(() => existing);
  return {
    read: after.read || [],
    write: after.write || [],
    requested,
  };
}
