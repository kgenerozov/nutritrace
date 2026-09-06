/**
 * Static-analysis tests for GET /api/v1/wellness wiring.
 *
 * Guards against unmounting the route, missing read:wellness registration,
 * expanding mcp:read, or dropping requireScope. Behavior is covered by
 * scripts/v1-wellness-integration.test.js.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const v1Index   = readFileSync(new URL('../server/routes/api/v1/index.js', import.meta.url), 'utf8');
const wellnessJs = readFileSync(new URL('../server/routes/api/v1/wellness.js', import.meta.url), 'utf8');
const apiTokens = readFileSync(new URL('../server/lib/api-tokens.js', import.meta.url), 'utf8');
const mcpTools  = readFileSync(new URL('../server/lib/mcp/tools/index.js', import.meta.url), 'utf8');

test('v1 index imports and mounts the wellness router at /wellness', () => {
  assert.match(v1Index, /import wellnessRouter[\s\S]*from '\.\/wellness\.js'/);
  assert.match(v1Index, /router\.use\('\/wellness',\s*wellnessRouter\)/);
});

test('read:wellness scope is registered in KNOWN_SCOPES', () => {
  assert.match(apiTokens, /'read:wellness'/);
});

test('read:wellness has a SCOPE_DESCRIPTIONS entry so the Settings UI can label it', () => {
  assert.match(apiTokens, /'read:wellness':\s*"[^"]+"/);
});

test('GET /api/v1/wellness requires the read:wellness scope', () => {
  assert.match(wellnessJs, /router\.get\('\/',\s*requireScope\('read:wellness'\)/);
});

test('wellness GET is owner-scoped to req.apiUser.id and ignores query user_id', () => {
  assert.match(wellnessJs, /req\.apiUser\.id/);
  assert.doesNotMatch(wellnessJs, /req\.query\.user_id/);
});

test('mcp:read is not expanded to grant wellness', () => {
  assert.doesNotMatch(wellnessJs, /requireScope\('mcp:read'\)/);
  assert.doesNotMatch(wellnessJs, /requireAnyMcpScope/);
});

test('MCP tool registrar is unchanged by the wellness REST patch', () => {
  assert.doesNotMatch(mcpTools, /wellness/);
  assert.doesNotMatch(mcpTools, /get_sleep/);
  assert.doesNotMatch(mcpTools, /get_steps/);
});

test('wellness GET does not write wellness_data', () => {
  assert.doesNotMatch(wellnessJs, /INSERT INTO wellness_data/);
  assert.doesNotMatch(wellnessJs, /UPDATE wellness_data/);
  assert.doesNotMatch(wellnessJs, /DELETE FROM wellness_data/);
});
