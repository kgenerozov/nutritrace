<script>
  import Toggle from './Toggle.svelte';
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
    statusText = 'Scanning…';
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
      statusText = `Scan complete. ${scanSummary.row_count} local rows would be written. Exercise/workout import is off.`;
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
    statusText = 'Importing…';
    try {
      const { dbUpsertWellness } = await import('../../lib/db-native.js');
      importResult = await importScan(lastScan, dbUpsertWellness);
      statusText = `Imported ${importResult.unique_keys} wellness keys as source=health_connect. Open Wellness and tap Sync to push to the server. Uninstall this Backfill app after a successful sync.`;
      showSuccess('Historical import wrote pending wellness rows');
    } catch (e) {
      showError(e.message || 'Import failed');
      statusText = e.message || 'Import failed';
    } finally {
      busy = false;
    }
  }

  refreshHistory();
</script>

{#if isNative}
  <div class="setting-divider"></div>
  <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:10px">
    <span class="setting-label">Health Connect Historical Import</span>
    <p class="setting-desc" style="line-height:1.5">
      One-time operational tool. Reads historical Health Connect data into local wellness rows
      with source <code>health_connect</code>, then uses normal NutriTrace sync. Exercise sessions
      are never imported as workouts. Calories are observational and off by default.
      Missing data is not written as zero. Uninstall this Backfill app after a successful import.
    </p>
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
      <button class="btn btn-secondary" style="height:40px;font-size:13px" disabled={busy} on:click={refreshHistory}>
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
      <button class="btn btn-primary" style="height:40px;font-size:13px" disabled={busy || !lastScan} on:click={runImport}>Import</button>
    </div>
    {#if statusText}
      <p class="setting-desc" style="line-height:1.5">{statusText}</p>
    {/if}
    {#if scanSummary}
      <div class="setting-desc" style="width:100%;font-family:monospace;font-size:12px;line-height:1.5;white-space:pre-wrap">
Range {scanSummary.from} … {scanSummary.to}
Rows {scanSummary.row_count}
Workouts written {scanSummary.workouts_written}
{#each Object.entries(scanSummary.metrics) as [metric, info]}
{metric}: {info.dates_with_data} dates, {info.earliest || '—'} … {info.latest || '—'}
{/each}
      </div>
    {/if}
    {#if importResult}
      <p class="setting-desc">Wrote {importResult.unique_keys} keys. After Sync, uninstall NutriTrace Backfill.</p>
    {/if}
  </div>
{/if}
