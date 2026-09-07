<script>
  import Toggle from './Toggle.svelte';
  import { onMount } from 'svelte';
  import { isNative } from '../../lib/platform.js';
  import { HealthConnect } from '@devmaxime/capacitor-health-connect';
  import { requestPermissions } from '../../lib/health-connect.js';
  import { getHistoryAccessStatus, requestHistoryAccess } from '../../lib/health-connect-history-plugin.js';
  import {
    defaultFamilySelection,
    evaluateHistoryAccess,
    formatLocalYmd,
    importScan,
    METRIC_FAMILIES,
    scanRange,
    summarizeScan,
  } from '../../lib/health-connect-history.js';
  import {
    formatPendingDiagnostics,
    pushPendingToServer,
    summarizePendingWellness,
  } from '../../lib/health-connect-history-pending.js';
  import { showError, showSuccess } from '../../stores/toast.js';

  function todayLocal() {
    return formatLocalYmd(new Date());
  }
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return formatLocalYmd(d);
  }

  let fromDate = daysAgo(365);
  let toDate = todayLocal();
  let families = defaultFamilySelection();
  let history = { featureAvailable: false, permissionGranted: false, feature: 'unknown', permission: 'unknown' };
  let busy = false;
  let statusText = '';
  let scanSummary = null;
  let lastScan = null;
  let importResult = null;
  let pendingDiag = null;
  let pushResult = null;

  const familyLabels = {
    steps: 'Steps (core)',
    distance: 'Distance',
    heart: 'Heart rate (average)',
    resting_hr: 'Resting HR',
    sleep: 'Sleep duration + stages if present',
    body: 'Weight / body composition',
    spo2: 'SpO2',
    bmr: 'Basal metabolic rate',
    vitals: 'BP, respiratory rate, temperature, VO2 max',
    activity_extra: 'Floors climbed, hydration',
    calories: 'Calories (observational only, off by default)',
  };

  async function refreshHistory() {
    if (!isNative) return;
    try {
      history = await getHistoryAccessStatus();
    } catch (e) {
      history = { featureAvailable: false, permissionGranted: false, feature: 'unavailable', permission: 'unavailable' };
      statusText = e.message || 'History access status failed';
    }
  }

  async function refreshPendingDiagnostics() {
    try {
      const { dbGetPendingChanges } = await import('../../lib/db-native.js');
      const pending = await dbGetPendingChanges();
      pendingDiag = summarizePendingWellness(pending.wellness || []);
    } catch (e) {
      pendingDiag = { pending_count: 0, sources: {}, earliest: null, latest: null, distinct_metric_types: 0 };
      statusText = e.message || 'Could not read pending wellness rows';
    }
  }

  function pushDeps() {
    return import('../../lib/db-native.js').then(async (db) => {
      const { fullSync } = await import('../../lib/sync.js');
      const { getServerUrl, getAuthToken } = await import('../../lib/platform.js');
      return {
        getPendingChanges: db.dbGetPendingChanges,
        getServerUrl,
        getAuthToken,
        fullSync,
      };
    });
  }

  function applyPushResult(result, { afterImport = false } = {}) {
    pushResult = result;
    pendingDiag = result.pendingAfter || pendingDiag;
    const pendingLine = formatPendingDiagnostics(result.pendingAfter || result.pendingBefore);
    if (result.status === 'pass') {
      statusText = [
        afterImport ? 'Local import complete.' : null,
        `Server push: ${result.server_push}`,
        `Pending before: ${result.pendingBefore.pending_count}`,
        `Pending after: ${result.pendingAfter.pending_count}`,
      ].filter(Boolean).join(' ');
      showSuccess(result.message);
      return;
    }
    if (result.status === 'no_pending') {
      statusText = afterImport
        ? `Local import complete. ${result.message}`
        : result.message;
      return;
    }
    if (result.status === 'not_connected' || result.status === 'not_authenticated') {
      const imported = afterImport
        ? `Imported locally. ${result.pendingBefore.pending_count} rows remain pending. `
        : '';
      statusText = `${imported}${result.message} Then tap Push pending to server.`;
      showError(result.message);
      return;
    }
    statusText = [
      afterImport ? `Imported locally. ${result.pendingBefore.pending_count} rows remain pending.` : null,
      result.message,
      pendingLine,
    ].filter(Boolean).join('\n');
    showError(result.message);
  }

  async function grantReads() {
    busy = true;
    try {
      await requestPermissions();
      statusText = 'Requested Health Connect read permissions. Confirm in the system dialog if shown.';
    } catch (e) {
      showError(e.message || 'Permission request failed');
    } finally {
      busy = false;
    }
  }

  async function grantHistory() {
    busy = true;
    try {
      await requestHistoryAccess();
      await refreshHistory();
      statusText = history.permissionGranted ? 'Past-data access granted.' : 'Past-data access not granted.';
    } catch (e) {
      statusText = e.message || 'History permission request failed';
      showError(statusText);
      await refreshHistory();
    } finally {
      busy = false;
    }
  }

  function hcAdapter() {
    return {
      aggregateRecords: (opts) => HealthConnect.aggregateRecords(opts),
      readRecords: (opts) => HealthConnect.readRecords(opts),
    };
  }

  async function runScan() {
    busy = true;
    scanSummary = null;
    lastScan = null;
    importResult = null;
    statusText = 'Health Connect historical scan…';
    try {
      await refreshHistory();
      const today = todayLocal();
      const access = evaluateHistoryAccess({
        featureAvailable: history.featureAvailable,
        permissionGranted: history.permissionGranted,
        from: fromDate,
        to: toDate,
        today,
      });
      if (!access.ok) {
        throw Object.assign(new Error(access.code), access);
      }
      lastScan = await scanRange({
        hc: hcAdapter(),
        from: fromDate,
        to: toDate,
        today,
        familySelection: families,
        history,
      });
      scanSummary = summarizeScan(lastScan);
      statusText = `Health Connect historical scan complete. ${scanSummary.row_count} local rows would be written. Exercise/workout import is off.`;
    } catch (e) {
      const code = e.code || e.message;
      if (code === 'HISTORY_DENIED' || code === 'HISTORY_UNAVAILABLE') {
        statusText = `Refusing to import a truncated range. Historical access is ${code === 'HISTORY_DENIED' ? 'denied' : 'unavailable'}. Grant Additional access → Access past data, or choose a range within 30 local days.`;
      } else {
        statusText = String(code || e.message || 'Scan failed');
      }
      showError(statusText);
    } finally {
      busy = false;
    }
  }

  async function runImport() {
    if (!lastScan) {
      showError('Scan first');
      return;
    }
    busy = true;
    statusText = 'Local import…';
    try {
      const { dbUpsertWellness } = await import('../../lib/db-native.js');
      importResult = await importScan(lastScan, dbUpsertWellness);
      await refreshPendingDiagnostics();
      statusText = `Local import wrote ${importResult.unique_keys} wellness keys as source=health_connect. Attempting server push…`;
      const result = await pushPendingToServer(await pushDeps());
      applyPushResult(result, { afterImport: true });
    } catch (e) {
      showError(e.message || 'Import failed');
      statusText = e.message || 'Import failed';
      await refreshPendingDiagnostics();
    } finally {
      busy = false;
    }
  }

  async function runPushPending() {
    busy = true;
    statusText = 'Server push…';
    try {
      await refreshPendingDiagnostics();
      const result = await pushPendingToServer(await pushDeps());
      applyPushResult(result);
    } catch (e) {
      showError(e.message || 'Server push failed');
      statusText = e.message || 'Server push failed';
      await refreshPendingDiagnostics();
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    refreshHistory();
    refreshPendingDiagnostics();
  });
</script>

{#if isNative}
  <div class="setting-divider"></div>
  <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:10px">
    <span class="setting-label">Health Connect Historical Import</span>
    <p class="setting-desc" style="line-height:1.5">
      One-time operational tool. Scan Health Connect history, import local wellness
      rows with source <code>health_connect</code>, then this screen pushes pending
      rows to the personal NutriTrace server. Do not use the Wellness Health Connect
      button for this delivery — that only re-reads today. Exercise sessions
      are never imported as workouts. Calories are observational and off by default.
      Missing data is not written as zero. Uninstall this Backfill app only after
      Server push PASS and pending after 0.
    </p>
    <div class="setting-desc" style="width:100%;font-family:monospace;font-size:12px;line-height:1.5;white-space:pre-wrap">
{pendingDiag ? formatPendingDiagnostics(pendingDiag) : 'Pending wellness rows: loading…'}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;width:100%">
      <label class="form-label" style="flex:1;min-width:140px">From
        <input class="input" type="date" bind:value={fromDate} disabled={busy} />
      </label>
      <label class="form-label" style="flex:1;min-width:140px">To
        <input class="input" type="date" bind:value={toDate} disabled={busy} />
      </label>
    </div>
    <p class="setting-desc">
      Historical access: feature {history.feature}; permission {history.permission}.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-secondary" style="height:40px;font-size:13px" disabled={busy} on:click={grantReads}>
        Grant Health Connect reads
      </button>
      <button class="btn btn-secondary" style="height:40px;font-size:13px" disabled={busy} on:click={grantHistory}>
        Access past data
      </button>
      <button class="btn btn-secondary" style="height:40px;font-size:13px" disabled={busy} on:click={() => { refreshHistory(); refreshPendingDiagnostics(); }}>
        Refresh status
      </button>
    </div>
    <div style="width:100%;display:flex;flex-direction:column;gap:6px">
      {#each Object.keys(METRIC_FAMILIES) as id}
        <div class="setting-row" style="padding:4px 0">
          <div>
            <span class="setting-label" style="font-size:13px">{familyLabels[id] || id}</span>
            {#if METRIC_FAMILIES[id].observational}
              <div class="setting-desc">Not canonical energy expenditure.</div>
            {/if}
          </div>
          <Toggle checked={families[id]} on:change={e => families[id] = e.detail} disabled={busy} />
        </div>
      {/each}
      <p class="setting-desc">Exercise / workout import is permanently unavailable in this tool.</p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-secondary" style="height:40px;font-size:13px" disabled={busy} on:click={runScan}>Scan</button>
      <button class="btn btn-primary" style="height:40px;font-size:13px" disabled={busy || !lastScan} on:click={runImport}>Import &amp; Push</button>
      <button class="btn btn-primary" style="height:40px;font-size:13px" disabled={busy} on:click={runPushPending}>
        Push pending to server
      </button>
    </div>
    {#if statusText}
      <p class="setting-desc" style="line-height:1.5;white-space:pre-wrap">{statusText}</p>
    {/if}
    {#if pushResult}
      <div class="setting-desc" style="width:100%;font-family:monospace;font-size:12px;line-height:1.5;white-space:pre-wrap">
Server push: {pushResult.server_push || '—'}
Pending before: {pushResult.pendingBefore?.pending_count ?? '—'}
Pending after: {pushResult.pendingAfter?.pending_count ?? '—'}
{#if pushResult.retry_available}
Retry available without Scan or Import.
{/if}
      </div>
    {/if}
    {#if scanSummary}
      <div class="setting-desc" style="width:100%;font-family:monospace;font-size:12px;line-height:1.5;white-space:pre-wrap">
Health Connect historical scan
Range {scanSummary.from} … {scanSummary.to}
Rows {scanSummary.row_count}
Workouts written {scanSummary.workouts_written}
{#each Object.entries(scanSummary.metrics) as [metric, info]}
{metric}: {info.dates_with_data} dates, {info.earliest || '—'} … {info.latest || '—'}
{/each}
{#if scanSummary.warnings?.length}
Warnings:
{#each scanSummary.warnings as w}
{w.hcType || w.metric_type}: {w.error_class}
{/each}
{/if}
      </div>
    {/if}
    {#if importResult}
      <p class="setting-desc">Local import wrote {importResult.unique_keys} keys.</p>
    {/if}
  </div>
{/if}
