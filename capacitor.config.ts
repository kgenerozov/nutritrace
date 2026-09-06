import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nutritrace.app.backfill',
  appName: 'NutriTrace Backfill',
  webDir: 'dist',
  // In dev, point to your local Vite dev server for live-reload on device
  // Uncomment and set your machine's LAN IP when doing native dev builds:
  // server: { url: 'http://192.168.1.x:5173', cleartext: true },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
    // Allow the HTTPS WebView to load HTTP resources (images, fetches) from
    // the user's server. Self-hosted deployments overwhelmingly run over
    // plain HTTP on LAN; without this, Chromium's mixed-content block
    // refuses to load uploaded food photos, meal images, etc. from an
    // http:// server. It worked before the hostname flip only because
    // Chromium special-cases https://localhost as a "potentially
    // trustworthy" origin exempt from mixed-content rules — .local
    // doesn't get that exemption. Setting this to true configures the
    // Android WebView with setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW),
    // which is safe here because the WebView origin is a local virtual URL
    // served by Capacitor's AssetLoader — no network attacker can inject
    // into it. Keeping the WebView on HTTPS (androidScheme below) preserves
    // secure-context status, which the html5-qrcode barcode scanner needs
    // for getUserMedia. NOTE: this option lives under `android`, NOT
    // `server` — Capacitor reads it from either `android.allowMixedContent`
    // or the top-level `allowMixedContent`. Putting it under `server` is
    // silently ignored.
    allowMixedContent: true,
  },
  server: {
    // WebView identity for Android autofill. Without an explicit hostname
    // Capacitor serves from https://localhost/, which is what password
    // managers like Bitwarden read as the site name — so saved
    // credentials show up as "localhost". Setting a hostname makes the
    // WebView report https://app.nutritrace.local/ instead, which reads
    // as a real app identifier.
    //
    // .local is the RFC 6762 TLD reserved for local/private use — nobody
    // can register it, no collision risk. If we ever buy a real domain
    // we can swap this for it in a future release and add Digital Asset
    // Links to associate saved web credentials with the app.
    //
    // ONE-TIME UPGRADE COST: changing the hostname changes the WebView's
    // origin, which orphans localStorage / sessionStorage / IndexedDB /
    // cookies tied to the old localhost origin. SQLite via
    // @capacitor-community/sqlite lives in the app data directory and is
    // origin-independent — food/meal/diary data is safe. Users on a
    // linked server will need to re-enter their server URL + credentials
    // once; native-standalone users will see their theme / prefs default
    // once. Called out in the CHANGELOG.
    hostname: 'app.nutritrace.local',
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0A0B0F',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'native',
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0A0B0F',
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};

export default config;
