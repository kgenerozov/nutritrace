/**
 * /api/v1/wellness — federation read of the token owner's wellness_data.
 *
 * GET /  inclusive date-only range of stored rows.
 *
 * Scope: read:wellness. mcp:read does not grant this endpoint.
 * See docs/federation.md for the wire contract.
 */
import { Router } from 'express';
import db from '../../../db.js';
import { wrap } from '../../../logger.js';
import { requireScope } from '../../../middleware/bearer-auth.js';

const router = Router();

/** Inclusive health-day range cap. from=to is 1 day. */
export const MAX_RANGE_DAYS = 366;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function _bad(res, status, error, code) {
  return res.status(status).json({ error, code });
}

/**
 * Date-only YYYY-MM-DD, calendar-valid. Not converted to a UTC datetime
 * boundary — this is the source health-day `wellness_data.date`.
 */
function _parseHealthDate(raw, field) {
  if (typeof raw !== 'string' || !DATE_ONLY.test(raw)) {
    return { error: `Invalid ${field}`, code: `bad_${field}` };
  }
  const [year, month, day] = raw.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return { error: `Invalid ${field}`, code: `bad_${field}` };
  }
  return { value: raw };
}

function _inclusiveDayCount(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Exact-match filters. Repeated query params are an OR-of-equals list
 * (`source=a&source=b`). A single value is exact equality. Values are
 * bound as parameters; SQL fragments are never interpolated.
 */
function _exactFilters(query, name) {
  const raw = query[name];
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    if (item === undefined || item === null) continue;
    const value = String(item);
    if (!value) continue;
    out.push(value);
  }
  return out;
}

/**
 * SQLite stores `datetime('now')` as `YYYY-MM-DD HH:MM:SS` UTC.
 * Normalize to ISO-8601 UTC for the wire. Stored values are not rewritten.
 */
function _isoUtc(s) {
  if (!s) return null;
  if (s.includes('T')) return s.endsWith('Z') ? s : `${s}Z`;
  return `${s.replace(' ', 'T')}Z`;
}

/**
 * metadata is TEXT JSON. Valid objects pass through (unknown keys kept).
 * Empty / missing / SQL NULL → {}. Malformed JSON, arrays, and primitives
 * → JSON null. No synthetic fields are invented.
 */
function _parseMetadata(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null) return {};
  if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return null;
}

function _toWire(row) {
  return {
    date: row.date,
    source: row.source,
    metric_type: row.metric_type,
    value: row.value,
    metadata: _parseMetadata(row.metadata),
    synced_at: _isoUtc(row.synced_at),
  };
}

router.get('/', requireScope('read:wellness'), wrap((req, res) => {
  const userId = req.apiUser.id;

  const fromParsed = _parseHealthDate(req.query.from, 'from');
  if (fromParsed.error) return _bad(res, 400, fromParsed.error, fromParsed.code);
  const toParsed = _parseHealthDate(req.query.to, 'to');
  if (toParsed.error) return _bad(res, 400, toParsed.error, toParsed.code);

  const from = fromParsed.value;
  const to = toParsed.value;
  if (from > to) {
    return _bad(res, 400, 'from must be on or before to', 'bad_range');
  }
  const days = _inclusiveDayCount(from, to);
  if (days > MAX_RANGE_DAYS) {
    return _bad(res, 400, `range exceeds ${MAX_RANGE_DAYS} inclusive days`, 'range_too_large');
  }

  const sources = _exactFilters(req.query, 'source');
  const metrics = _exactFilters(req.query, 'metric_type');

  const conds = ['user_id = ?', 'date >= ?', 'date <= ?'];
  const args = [userId, from, to];

  if (sources.length === 1) {
    conds.push('source = ?');
    args.push(sources[0]);
  } else if (sources.length > 1) {
    conds.push(`source IN (${sources.map(() => '?').join(', ')})`);
    args.push(...sources);
  }

  if (metrics.length === 1) {
    conds.push('metric_type = ?');
    args.push(metrics[0]);
  } else if (metrics.length > 1) {
    conds.push(`metric_type IN (${metrics.map(() => '?').join(', ')})`);
    args.push(...metrics);
  }

  const rows = db.prepare(
    `SELECT date, source, metric_type, value, metadata, synced_at
       FROM wellness_data
      WHERE ${conds.join(' AND ')}
      ORDER BY date ASC, source ASC, metric_type ASC`
  ).all(...args);

  res.json({
    from,
    to,
    rows: rows.map(_toWire),
  });
}));

export default router;
