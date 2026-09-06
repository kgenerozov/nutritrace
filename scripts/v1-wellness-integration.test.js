/**
 * Integration tests for GET /api/v1/wellness against a temp SQLite DB.
 *
 * Sets DB_PATH before importing server modules so db.js opens the scratch
 * file. Skips with a diagnostic if better-sqlite3 is ABI-mismatched.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test, { after, before } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));

const TMP_DB = path.join(os.tmpdir(), `wellness-int-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = 'test';
process.env.API_RATE_LIMIT_PER_MIN = '10000';

let db, createToken, express, apiV1;
try {
  ({ default: db } = await import('../server/db.js'));
  ({ createToken } = await import('../server/lib/api-tokens.js'));
  express = requireFromServer('express');
  ({ default: apiV1 } = await import('../server/routes/api/v1/index.js'));
} catch (e) {
  test('wellness integration suite skipped (native module unavailable)', { skip: true }, () => {});
  const msg = e?.message || String(e);
  console.warn(`[v1-wellness-integration] skipping: ${msg.split('\n')[0]}`);
  if (/better_sqlite3\.node/i.test(msg)) {
    console.warn('[v1-wellness-integration] Node ABI mismatch on better-sqlite3. Run inside the Docker image, or `cd server && npm rebuild better-sqlite3`.');
  }
  process.exit(0);
}

let userA;
let userB;
let wellnessRaw;
let mcpRaw;
let server;
let port;

function insertWellness({ userId, date, source, metricType, value, metadata = '{}', syncedAt }) {
  db.prepare(
    `INSERT INTO wellness_data (user_id, date, source, metric_type, value, metadata, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, date, source, metricType, value, metadata, syncedAt);
}

async function call(pathname, { token, method = 'GET' } = {}) {
  const headers = { accept: 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  userA = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')")
    .run('wellness-user-a', 'x').lastInsertRowid;
  userB = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')")
    .run('wellness-user-b', 'x').lastInsertRowid;

  insertWellness({
    userId: userA, date: '2026-09-06', source: 'health_connect', metricType: 'steps',
    value: 123, metadata: JSON.stringify({ device: 'watch', extra: 'keep-me' }),
    syncedAt: '2026-09-06 14:33:59',
  });
  insertWellness({
    userId: userA, date: '2026-09-06', source: 'health_connect', metricType: 'distance_km',
    value: 1.5, metadata: '{}', syncedAt: '2026-09-06 14:33:59',
  });
  insertWellness({
    userId: userA, date: '2026-09-06', source: 'health_connect', metricType: 'calories_out',
    value: 0, metadata: '{}', syncedAt: '2026-09-06 14:33:59',
  });
  insertWellness({
    userId: userA, date: '2026-09-05', source: 'fitbit', metricType: 'steps',
    value: 10, metadata: '{}', syncedAt: '2026-09-05 08:00:00',
  });
  insertWellness({
    userId: userA, date: '2026-09-06', source: 'health_connect', metricType: 'future_metric',
    value: 7, metadata: '{not-json', syncedAt: '2026-09-06 14:33:59',
  });
  insertWellness({
    userId: userB, date: '2026-09-06', source: 'health_connect', metricType: 'steps',
    value: 9999, metadata: '{}', syncedAt: '2026-09-06 14:33:59',
  });

  wellnessRaw = createToken({
    userId: userA, name: 'wellness-read', scopes: ['read:wellness'],
  }).raw;
  mcpRaw = createToken({
    userId: userA, name: 'mcp-read', scopes: ['mcp:read'],
  }).raw;

  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiV1);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

test('missing bearer → 401', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'auth_missing');
});

test('invalid bearer → 401', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', {
    token: 'nt_pat_this_is_not_a_real_token_value_xxxx',
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'auth_invalid');
});

test('mcp:read PAT → 403 on wellness', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', { token: mcpRaw });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'auth_scope');
});

test('read:wellness PAT → 200 on valid range', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', { token: wellnessRaw });
  assert.equal(res.status, 200);
  assert.equal(res.body.from, '2026-09-01');
  assert.equal(res.body.to, '2026-09-06');
  assert.ok(Array.isArray(res.body.rows));
});

test('token A does not see user B rows', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', { token: wellnessRaw });
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.some((row) => row.value === 9999), false);
  assert.equal(
    res.body.rows.every((row) => !('user_id' in row) && !('username' in row)),
    true,
  );
  const bToken = createToken({
    userId: userB, name: 'b-wellness', scopes: ['read:wellness'],
  }).raw;
  const bRes = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', { token: bToken });
  assert.equal(bRes.status, 200);
  assert.equal(bRes.body.rows.length, 1);
  assert.equal(bRes.body.rows[0].metric_type, 'steps');
  assert.equal(bRes.body.rows[0].value, 9999);
});

test('query user_id does not change owner scope', async () => {
  const res = await call(
    `/api/v1/wellness?from=2026-09-01&to=2026-09-06&user_id=${userB}`,
    { token: wellnessRaw },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.some((row) => row.value === 9999), false);
});

test('bad from → 400', async () => {
  const res = await call('/api/v1/wellness?from=2026-13-01&to=2026-09-06', { token: wellnessRaw });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'bad_from');
});

test('bad to → 400', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=not-a-date', { token: wellnessRaw });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'bad_to');
});

test('from > to → 400', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-06&to=2026-09-01', { token: wellnessRaw });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'bad_range');
});

test('range larger than 366 inclusive days → 400', async () => {
  const res = await call('/api/v1/wellness?from=2024-01-01&to=2025-01-02', { token: wellnessRaw });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'range_too_large');
});

test('source filter is exact and does not invent a whitelist', async () => {
  const hc = await call(
    '/api/v1/wellness?from=2026-09-01&to=2026-09-06&source=health_connect',
    { token: wellnessRaw },
  );
  assert.equal(hc.status, 200);
  assert.ok(hc.body.rows.length >= 1);
  assert.equal(hc.body.rows.every((row) => row.source === 'health_connect'), true);

  const fitbit = await call(
    '/api/v1/wellness?from=2026-09-01&to=2026-09-06&source=fitbit',
    { token: wellnessRaw },
  );
  assert.equal(fitbit.status, 200);
  assert.equal(fitbit.body.rows.length, 1);
  assert.equal(fitbit.body.rows[0].source, 'fitbit');
  assert.equal(fitbit.body.rows[0].metric_type, 'steps');
});

test('metric_type filter is exact and allows unknown names', async () => {
  const steps = await call(
    '/api/v1/wellness?from=2026-09-01&to=2026-09-06&metric_type=steps',
    { token: wellnessRaw },
  );
  assert.equal(steps.status, 200);
  assert.equal(steps.body.rows.every((row) => row.metric_type === 'steps'), true);
  assert.ok(steps.body.rows.some((row) => row.source === 'health_connect'));
  assert.ok(steps.body.rows.some((row) => row.source === 'fitbit'));

  const future = await call(
    '/api/v1/wellness?from=2026-09-01&to=2026-09-06&metric_type=future_metric',
    { token: wellnessRaw },
  );
  assert.equal(future.status, 200);
  assert.equal(future.body.rows.length, 1);
  assert.equal(future.body.rows[0].metric_type, 'future_metric');
});

test('source + metric_type combined filter', async () => {
  const res = await call(
    '/api/v1/wellness?from=2026-09-01&to=2026-09-06&source=health_connect&metric_type=steps',
    { token: wellnessRaw },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.length, 1);
  assert.equal(res.body.rows[0].source, 'health_connect');
  assert.equal(res.body.rows[0].metric_type, 'steps');
  assert.equal(res.body.rows[0].value, 123);
});

test('absent metric is omitted; stored zero is returned as zero', async () => {
  const res = await call(
    '/api/v1/wellness?from=2026-09-06&to=2026-09-06&source=health_connect',
    { token: wellnessRaw },
  );
  assert.equal(res.status, 200);
  const types = res.body.rows.map((row) => row.metric_type);
  assert.equal(types.includes('sleep_duration_min'), false);
  const calories = res.body.rows.find((row) => row.metric_type === 'calories_out');
  assert.ok(calories);
  assert.equal(calories.value, 0);
});

test('valid metadata object is parsed; malformed metadata becomes null', async () => {
  const res = await call(
    '/api/v1/wellness?from=2026-09-06&to=2026-09-06&source=health_connect&metric_type=steps',
    { token: wellnessRaw },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows[0].metadata, { device: 'watch', extra: 'keep-me' });

  const malformed = await call(
    '/api/v1/wellness?from=2026-09-06&to=2026-09-06&metric_type=future_metric',
    { token: wellnessRaw },
  );
  assert.equal(malformed.status, 200);
  assert.equal(malformed.body.rows[0].metadata, null);
});

test('synced_at is ISO8601 UTC and ordering is date, source, metric_type', async () => {
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', { token: wellnessRaw });
  assert.equal(res.status, 200);
  const keys = res.body.rows.map((row) => `${row.date}|${row.source}|${row.metric_type}`);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
  const steps = res.body.rows.find((row) => row.source === 'health_connect' && row.metric_type === 'steps');
  assert.equal(steps.synced_at, '2026-09-06T14:33:59Z');
});

test('GET does not mutate wellness rows', async () => {
  const before = db.prepare(
    'SELECT COUNT(*) AS c, MAX(synced_at) AS latest FROM wellness_data WHERE user_id = ?'
  ).get(userA);
  const snapshot = db.prepare(
    'SELECT date, source, metric_type, value, metadata, synced_at FROM wellness_data WHERE user_id = ? ORDER BY id'
  ).all(userA);
  const res = await call('/api/v1/wellness?from=2026-09-01&to=2026-09-06', { token: wellnessRaw });
  assert.equal(res.status, 200);
  const after = db.prepare(
    'SELECT COUNT(*) AS c, MAX(synced_at) AS latest FROM wellness_data WHERE user_id = ?'
  ).get(userA);
  assert.equal(after.c, before.c);
  assert.equal(after.latest, before.latest);
  const again = db.prepare(
    'SELECT date, source, metric_type, value, metadata, synced_at FROM wellness_data WHERE user_id = ? ORDER BY id'
  ).all(userA);
  assert.deepEqual(again, snapshot);
});
