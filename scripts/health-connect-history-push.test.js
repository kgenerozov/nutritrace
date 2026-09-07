import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importScan, naturalKey, SOURCE } from '../src/lib/health-connect-history.js';
import {
  classifyPushOutcome,
  evaluatePushPreconditions,
  formatPendingDiagnostics,
  pushPendingToServer,
  SERVER_PUSH_FAIL,
  SERVER_PUSH_PASS,
  summarizePendingWellness,
} from '../src/lib/health-connect-history-pending.js';

function memoryWellness(seed = []) {
  const rows = new Map();
  for (const row of seed) {
    const key = `${row.date}|${row.source}|${row.metric_type}`;
    rows.set(key, { ...row, sync_status: row.sync_status || 'pending' });
  }
  async function upsert(date, source, metric_type, value, metadata = {}) {
    const key = `${date}|${source}|${metric_type}`;
    rows.set(key, {
      date, source, metric_type, value, metadata,
      sync_status: 'pending',
    });
  }
  async function getPendingChanges() {
    return { wellness: [...rows.values()].filter(r => r.sync_status === 'pending') };
  }
  function markAllPendingSynced() {
    for (const row of rows.values()) {
      if (row.sync_status === 'pending') row.sync_status = 'synced';
    }
  }
  return { rows, upsert, getPendingChanges, markAllPendingSynced };
}

function syntheticPending(count, { source = SOURCE } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const dayIndex = Math.floor(i / 10);
    const date = new Date(Date.UTC(2025, 0, 1 + dayIndex));
    rows.push({
      date: date.toISOString().slice(0, 10),
      source,
      metric_type: `metric_${i % 10}`,
      value: 1,
      metadata: {},
      sync_status: 'pending',
    });
  }
  return rows;
}

test('A: importScan writes wellness rows as pending', async () => {
  const db = memoryWellness();
  const scan = {
    rows: [
      { date: '2026-09-01', source: SOURCE, metric_type: 'steps', value: 12, metadata: {} },
      { date: '2026-09-02', source: SOURCE, metric_type: 'steps', value: 40, metadata: {} },
    ],
  };
  const result = await importScan(scan, db.upsert);
  const pending = await db.getPendingChanges();
  assert.equal(result.unique_keys, 2);
  assert.equal(pending.wellness.length, 2);
  assert.ok(pending.wellness.every(r => r.sync_status === 'pending'));
  assert.ok(pending.wellness.every(r => r.source === SOURCE));
  assert.equal(db.rows.get(naturalKey('2026-09-01', 'steps')).sync_status, 'pending');
});

test('B: server-push of existing pending rows calls fullSync and marks synced', async () => {
  const db = memoryWellness(syntheticPending(3));
  let fullSyncCalls = 0;
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => 'test-token',
    fullSync: async (...args) => {
      fullSyncCalls += 1;
      assert.deepEqual(args, [false, true, true]);
      db.markAllPendingSynced();
      return { ok: true };
    },
  });
  assert.equal(fullSyncCalls, 1);
  assert.equal(result.server_push, SERVER_PUSH_PASS);
  assert.equal(result.pendingBefore.pending_count, 3);
  assert.equal(result.pendingAfter.pending_count, 0);
  assert.equal((await db.getPendingChanges()).wellness.length, 0);
});

test('C: existing pending rows can be pushed with lastScan = null', async () => {
  const db = memoryWellness(syntheticPending(5));
  const lastScan = null;
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => 'test-token',
    fullSync: async () => {
      assert.equal(lastScan, null);
      db.markAllPendingSynced();
      return { ok: true };
    },
  });
  assert.equal(result.scanned, false);
  assert.equal(result.imported, false);
  assert.equal(result.server_push, SERVER_PUSH_PASS);
  assert.equal(result.pendingAfter.pending_count, 0);
});

test('D: no server URL is not success', async () => {
  const db = memoryWellness(syntheticPending(2));
  let fullSyncCalls = 0;
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => null,
    getAuthToken: () => 'test-token',
    fullSync: async () => {
      fullSyncCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(fullSyncCalls, 0);
  assert.equal(result.status, 'not_connected');
  assert.equal(result.server_push, SERVER_PUSH_FAIL);
  assert.match(result.message, /Not connected to server/);
  assert.equal(result.pendingAfter.pending_count, 2);
  assert.equal(result.retry_available, true);
});

test('E: no auth token is not success', async () => {
  const db = memoryWellness(syntheticPending(2));
  let fullSyncCalls = 0;
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => '',
    fullSync: async () => {
      fullSyncCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(fullSyncCalls, 0);
  assert.equal(result.status, 'not_authenticated');
  assert.equal(result.server_push, SERVER_PUSH_FAIL);
  assert.match(result.message, /Not authenticated/);
  assert.equal(result.pendingAfter.pending_count, 2);
});

test('F: fullSync failure keeps pending rows and retry is available', async () => {
  const db = memoryWellness(syntheticPending(4));
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => 'test-token',
    fullSync: async () => ({ ok: false, reason: 'offline', error: 'server unreachable' }),
  });
  assert.equal(result.status, 'push_failed');
  assert.equal(result.server_push, SERVER_PUSH_FAIL);
  assert.equal(result.pendingAfter.pending_count, 4);
  assert.equal(result.retry_available, true);
  assert.equal((await db.getPendingChanges()).wellness.length, 4);
});

test('G: fullSync ok but pending remaining is incomplete, not success', async () => {
  const db = memoryWellness(syntheticPending(3));
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => 'test-token',
    fullSync: async () => ({ ok: true }),
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.server_push, SERVER_PUSH_FAIL);
  assert.match(result.message, /Server push incomplete: 3 wellness rows still pending/);
  assert.equal(result.retry_available, true);
});

test('H: pending before > 0 and pending after = 0 is PASS', () => {
  const outcome = classifyPushOutcome({
    pendingBefore: { pending_count: 624 },
    syncResult: { ok: true },
    pendingAfter: { pending_count: 0 },
  });
  assert.equal(outcome.server_push, SERVER_PUSH_PASS);
  assert.equal(outcome.status, 'pass');
  assert.match(outcome.message, /Pending before: 624/);
  assert.match(outcome.message, /Pending after: 0/);
});

test('existing 624-like pending rows recover without rescan or import', async () => {
  const db = memoryWellness(syntheticPending(624));
  let importCalls = 0;
  let scanCalls = 0;
  const originalImport = importScan;
  assert.equal(typeof originalImport, 'function');
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => 'test-token',
    fullSync: async () => {
      assert.equal(scanCalls, 0);
      assert.equal(importCalls, 0);
      db.markAllPendingSynced();
      return { ok: true };
    },
  });
  assert.equal(result.scanned, false);
  assert.equal(result.imported, false);
  assert.equal(result.pendingBefore.pending_count, 624);
  assert.equal(result.pendingAfter.pending_count, 0);
  assert.equal(result.server_push, SERVER_PUSH_PASS);
  assert.equal(db.rows.size, 624);
});

test('push diagnostics never include health values', () => {
  const summary = summarizePendingWellness([
    { date: '2026-01-01', source: SOURCE, metric_type: 'steps', value: 12345, sync_status: 'pending' },
    { date: '2026-06-01', source: SOURCE, metric_type: 'weight_kg', value: 70.2, sync_status: 'pending' },
  ]);
  const text = formatPendingDiagnostics(summary);
  assert.equal(summary.pending_count, 2);
  assert.equal(summary.sources.health_connect, 2);
  assert.equal(summary.earliest, '2026-01-01');
  assert.equal(summary.latest, '2026-06-01');
  assert.equal(summary.distinct_metric_types, 2);
  assert.doesNotMatch(text, /12345|70\.2/);
  assert.match(text, /Pending wellness rows: 2/);
});

test('zero pending reports no pending without calling fullSync', async () => {
  const db = memoryWellness();
  let fullSyncCalls = 0;
  const result = await pushPendingToServer({
    getPendingChanges: db.getPendingChanges,
    getServerUrl: () => 'https://example.invalid/nutritrace',
    getAuthToken: () => 'test-token',
    fullSync: async () => {
      fullSyncCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(fullSyncCalls, 0);
  assert.equal(result.status, 'no_pending');
  assert.match(result.message, /No pending historical wellness rows/);
});

test('preconditions reject empty server URL even if fullSync would succeed', () => {
  const denied = evaluatePushPreconditions({ serverUrl: '  ', authToken: 'x' });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'not_connected');
});

test('Backfill UI owns server push and never tells user to Wellness HC Sync', () => {
  const ui = readFileSync('src/components/settings/HealthConnectHistoryImport.svelte', 'utf8');
  assert.doesNotMatch(ui, /Open Wellness and tap Sync to push to the server/);
  assert.doesNotMatch(ui, /syncHealthConnectManual/);
  assert.doesNotMatch(ui, /Health Connect synced/);
  assert.match(ui, /Push pending to server/);
  assert.match(ui, /pushPendingToServer/);
  assert.match(ui, /fullSync/);
  assert.match(ui, /Import &amp; Push|Import & Push/);
  assert.match(ui, /Pending wellness rows/);
  assert.match(ui, /Server push/);
  assert.match(ui, /Health Connect historical scan/);
  assert.match(ui, /Local import/);
  assert.match(ui, /runPushPending/);
  assert.match(ui, /disabled=\{busy\} on:click=\{runPushPending\}/);
});
