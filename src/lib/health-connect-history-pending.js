/**
 * Backfill server-push workflow for already-queued wellness rows.
 *
 * Historical Import writes wellness_data with sync_status='pending'.
 * Delivery to the NutriTrace server is fullSync() → pushChanges() →
 * POST /api/sync/push. The Wellness Health Connect button does not do that.
 *
 * This module never reads Health Connect history and does not require lastScan.
 */

export const SERVER_PUSH_PASS = 'PASS';
export const SERVER_PUSH_FAIL = 'FAIL';

export function hasNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluatePushPreconditions({ serverUrl, authToken } = {}) {
  if (!hasNonEmpty(serverUrl)) {
    return {
      ok: false,
      code: 'not_connected',
      message: 'Not connected to server',
    };
  }
  if (!hasNonEmpty(authToken)) {
    return {
      ok: false,
      code: 'not_authenticated',
      message: 'Not authenticated — sign in to the personal NutriTrace account first.',
    };
  }
  return { ok: true, code: 'ready' };
}

export function sanitizeFailure(err) {
  const reason = err && typeof err === 'object' ? (err.reason || err.code || '') : '';
  const raw = err?.message || err?.error || (typeof err === 'string' ? err : '') || reason || 'unknown';
  return String(raw)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:token|password|authorization)\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|bpm|kcal(?:\/day)?|watts|%|mmHg)\b/gi, '[redacted]')
    .slice(0, 200);
}

export function summarizePendingWellness(rows) {
  const wellness = Array.isArray(rows) ? rows : [];
  const sources = {};
  const dates = [];
  const metricTypes = new Set();
  for (const row of wellness) {
    const source = row?.source || 'unknown';
    sources[source] = (sources[source] || 0) + 1;
    if (typeof row?.date === 'string' && row.date) dates.push(row.date);
    if (typeof row?.metric_type === 'string' && row.metric_type) metricTypes.add(row.metric_type);
  }
  dates.sort();
  return {
    pending_count: wellness.length,
    sources,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    distinct_metric_types: metricTypes.size,
  };
}

export function formatPendingDiagnostics(summary) {
  if (!summary) return 'Pending wellness rows: unknown';
  const sourceParts = Object.entries(summary.sources || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, n]) => `${source}: ${n}`);
  const lines = [
    `Pending wellness rows: ${summary.pending_count}`,
  ];
  if (sourceParts.length) lines.push(`Sources: ${sourceParts.join(', ')}`);
  if (summary.earliest || summary.latest) {
    lines.push(`Local dates: ${summary.earliest || '—'} … ${summary.latest || '—'}`);
  }
  lines.push(`Distinct metric types: ${summary.distinct_metric_types}`);
  return lines.join('\n');
}

export function classifyPushOutcome({
  preconditions,
  pendingBefore,
  syncResult,
  pendingAfter,
} = {}) {
  const before = pendingBefore?.pending_count ?? 0;
  const after = pendingAfter?.pending_count ?? 0;

  if (preconditions && preconditions.ok === false) {
    return {
      status: preconditions.code,
      server_push: SERVER_PUSH_FAIL,
      message: preconditions.message,
      retry_available: true,
    };
  }

  if (before === 0) {
    return {
      status: 'no_pending',
      server_push: null,
      message: 'No pending historical wellness rows',
      retry_available: false,
    };
  }

  if (!syncResult?.ok) {
    const detail = sanitizeFailure(syncResult?.error || syncResult || 'Sync failed');
    const reason = syncResult?.reason ? ` (${syncResult.reason})` : '';
    return {
      status: 'push_failed',
      server_push: SERVER_PUSH_FAIL,
      message: `Server push failed${reason}: ${detail}`,
      retry_available: true,
    };
  }

  if (after > 0) {
    return {
      status: 'incomplete',
      server_push: SERVER_PUSH_FAIL,
      message: `Server push incomplete: ${after} wellness rows still pending.`,
      retry_available: true,
    };
  }

  return {
    status: 'pass',
    server_push: SERVER_PUSH_PASS,
    message: `Server push PASS. Pending before: ${before}. Pending after: 0.`,
    retry_available: false,
  };
}

/**
 * Push already-queued wellness rows with the real fullSync path.
 * Does not scan Health Connect. Does not re-import. Does not require lastScan.
 */
export async function pushPendingToServer(deps = {}) {
  const getPendingChanges = deps.getPendingChanges;
  const getServerUrl = deps.getServerUrl;
  const getAuthToken = deps.getAuthToken;
  const fullSync = deps.fullSync;
  if (typeof getPendingChanges !== 'function' || typeof fullSync !== 'function') {
    throw new Error('pushPendingToServer requires getPendingChanges and fullSync');
  }

  const pending = await getPendingChanges();
  const pendingBefore = summarizePendingWellness(pending?.wellness || []);
  const preconditions = evaluatePushPreconditions({
    serverUrl: typeof getServerUrl === 'function' ? getServerUrl() : null,
    authToken: typeof getAuthToken === 'function' ? getAuthToken() : null,
  });

  if (pendingBefore.pending_count === 0) {
    const outcome = classifyPushOutcome({
      pendingBefore,
      pendingAfter: pendingBefore,
    });
    return {
      ...outcome,
      pendingBefore,
      pendingAfter: pendingBefore,
      scanned: false,
      imported: false,
    };
  }

  if (!preconditions.ok) {
    const outcome = classifyPushOutcome({
      preconditions,
      pendingBefore,
      pendingAfter: pendingBefore,
    });
    return {
      ...outcome,
      pendingBefore,
      pendingAfter: pendingBefore,
      scanned: false,
      imported: false,
    };
  }

  let syncResult;
  try {
    syncResult = await fullSync(false, true, true);
  } catch (err) {
    syncResult = { ok: false, reason: 'error', error: sanitizeFailure(err) };
  }

  const afterPending = await getPendingChanges();
  const pendingAfter = summarizePendingWellness(afterPending?.wellness || []);
  const outcome = classifyPushOutcome({
    pendingBefore,
    syncResult,
    pendingAfter,
  });

  return {
    ...outcome,
    pendingBefore,
    pendingAfter,
    sync_ok: !!syncResult?.ok,
    scanned: false,
    imported: false,
  };
}
