# Temporary Health Connect historical backfill

This branch is a **one-time** Android utility. It is not a production NutriTrace
release and is **not** a required AIHealth source extension.

Parent production extension: `c2f455ee0581b1b57c4101901b17405c33647fb9`
(`GET /api/v1/wellness`, `read:wellness`). That commit must stay the production
server identity.

This APK owns SCAN → LOCAL IMPORT → `fullSync()` server push. Do **not** use
the Wellness Health Connect button to deliver historical rows; that button only
re-reads today. Existing pending `wellness_data` rows can be pushed without a
rescan via **Push pending to server**.

Temp tested commit: `f821fc8cff33c4421d4d928b15762c6a393fd996`

APK (outside git):
`/root/nutritrace-apk-artifacts/nutritrace-v1.2.0-aihealth-hc-history-backfill.apk`
SHA256 `ebf2ba43057cf1db35d83f1ac6801d61e07b2da186e34a7f982c94ac3446e290`
applicationId `com.nutritrace.app.backfill`
versionName `1.2.0-hc-backfill.2`
versionCode `2`
Signing certificate SHA-256 `682fcc5ffbdf3530db6ee2d43cf0f373557adcd5f06fbc7173c0c2a441394348` (Android Debug; same as installed Backfill)
DB_NAME `nutritrace_local` (unchanged; in-place update)

See AIHealth `docs/ops/NUTRITRACE_HEALTH_CONNECT_HISTORY_BACKFILL.md`.
