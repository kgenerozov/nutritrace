# Temporary Health Connect historical backfill

This branch is a **one-time** Android utility. It is not a production NutriTrace
release and is **not** a required AIHealth source extension.

Parent production extension: `c2f455ee0581b1b57c4101901b17405c33647fb9`
(`GET /api/v1/wellness`, `read:wellness`). That commit must stay the production
server identity.

This APK owns SCAN → LOCAL IMPORT → `fullSync()` server push. Do **not** use
the Wellness Health Connect button to deliver historical rows; that button only
re-reads today.

Temp tested commit: *filled after commit*


APK (outside git):
`/root/nutritrace-apk-artifacts/nutritrace-v1.2.0-aihealth-hc-history-backfill.apk`
SHA256 `b5046b72d28f4e0c2075626341030ad45ae4a16917ed684f473c7b39fa1547cc`
applicationId `com.nutritrace.app.backfill`

See AIHealth `docs/ops/NUTRITRACE_HEALTH_CONNECT_HISTORY_BACKFILL.md`.
